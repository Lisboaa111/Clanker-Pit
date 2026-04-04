/**
 * Match Manager — server-side authoritative game loop.
 *
 * Each active match has its own game loop running at TICK_MS intervals.
 * Agents submit commands via POST /game/command → queued here.
 * Agents/frontend poll or stream via GET /game/state and GET /game/stream.
 * When the match ends the manager auto-settles via the matches route.
 */

import type { Response as ExpressResponse } from 'express'
import { GameState, AgentCommand, SerializedState } from './types.js'
import { initGameState } from './init.js'
import { gameTick, applyCommands } from './tick.js'
import { serializeForPlayer } from './serialize.js'
import { ruleBasedDecide } from './ai.js'
import { q, type AgentRow, type MatchRow } from '../db.js'
import { TICK_MS, SNAPSHOT_EVERY } from './constants.js'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SSEClient {
  playerId: number | null  // null = spectator (gets both players' data merged)
  res: ExpressResponse
}

interface ActiveMatch {
  matchId:   string
  agentIds:  [string, string]
  state:     GameState
  pendingCmds:    [AgentCommand[], AgentCommand[]]
  reasonings:     [string, string]
  lastExternalCmd:[number, number]  // tick of last external command per player
  sseClients:  Set<SSEClient>
  intervalId:  ReturnType<typeof setInterval>
  ticks:       number   // ticks elapsed in THIS interval (for snapshot freq)
}

// ── Manager singleton ──────────────────────────────────────────────────────────

const active = new Map<string, ActiveMatch>()

// ── Start a match ──────────────────────────────────────────────────────────────

export function startMatch(matchId: string, agent0Id: string, agent1Id: string): void {
  if (active.has(matchId)) {
    console.warn(`[GameManager] Match ${matchId} already running`)
    return
  }

  const match: ActiveMatch = {
    matchId,
    agentIds:        [agent0Id, agent1Id],
    state:           initGameState(),
    pendingCmds:     [[], []],
    reasonings:      ['', ''],
    lastExternalCmd: [-999, -999],
    sseClients:      new Set(),
    ticks:           0,
    intervalId:      null as any,
  }

  match.intervalId = setInterval(() => tickMatch(match), TICK_MS)
  active.set(matchId, match)

  console.log(`[GameManager] ▶ Match ${matchId} started (${agent0Id} vs ${agent1Id})`)
}

// ── Stop / cleanup ─────────────────────────────────────────────────────────────

export function stopMatch(matchId: string): void {
  const m = active.get(matchId)
  if (!m) return
  clearInterval(m.intervalId)
  // Close all SSE connections
  for (const client of m.sseClients) {
    try { client.res.end() } catch {}
  }
  active.delete(matchId)
  console.log(`[GameManager] ■ Match ${matchId} stopped`)
}

// ── Submit a command ───────────────────────────────────────────────────────────

export function submitCommand(
  matchId:   string,
  agentId:   string,
  command:   AgentCommand,
  reasoning?: string,
): { ok: boolean; error?: string } {
  const m = active.get(matchId)
  if (!m) return { ok: false, error: 'Match not active' }

  const pid = m.agentIds[0] === agentId ? 0 : m.agentIds[1] === agentId ? 1 : -1
  if (pid === -1) return { ok: false, error: 'Agent not in this match' }

  if (m.state.winnerId !== null) return { ok: false, error: 'Match already over' }

  m.pendingCmds[pid].push(command)
  m.lastExternalCmd[pid] = m.state.tick  // track last external command
  if (reasoning) m.reasonings[pid] = reasoning
  return { ok: true }
}

// ── Get state ──────────────────────────────────────────────────────────────────

export function getState(matchId: string, agentId: string): SerializedState | null {
  const m = active.get(matchId)
  if (!m) return null
  const pid = m.agentIds[0] === agentId ? 0 : 1
  return serializeForPlayer(m.state, pid)
}

export function getStateByPid(matchId: string, pid: number): SerializedState | null {
  const m = active.get(matchId)
  if (!m) return null
  return serializeForPlayer(m.state, pid)
}

export function getActiveMatch(matchId: string): ActiveMatch | undefined {
  return active.get(matchId)
}

export function isActive(matchId: string): boolean {
  return active.has(matchId)
}

// ── SSE subscription ───────────────────────────────────────────────────────────

export function subscribeSSE(matchId: string, pid: number | null, res: ExpressResponse): void {
  const m = active.get(matchId)
  if (!m) { res.status(404).end(); return }

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const client: SSEClient = { playerId: pid, res }
  m.sseClients.add(client)

  // Send initial state immediately
  sendSSEState(m, client)

  // Clean up on disconnect
  res.on('close', () => m.sseClients.delete(client))
}

// ── Internal game tick ─────────────────────────────────────────────────────────

function tickMatch(m: ActiveMatch): void {
  try {
    // 1a. Built-in AI fallback — runs every 5 ticks for players with no recent external commands
    //     External agents override this by submitting their own commands (tracked via lastExternalCmd)
    const AI_INTERVAL  = 5   // ticks between AI decisions
    const AI_IDLE_TICKS = 3  // ticks of silence before AI kicks in
    if (m.state.tick % AI_INTERVAL === 0) {
      for (const pid of [0, 1] as const) {
        const ticksSinceExt = m.state.tick - m.lastExternalCmd[pid]
        if (ticksSinceExt >= AI_IDLE_TICKS) {
          const { commands, reasoning } = ruleBasedDecide(m.state, pid)
          if (commands.length) m.pendingCmds[pid].push(...commands)
          if (reasoning) m.reasonings[pid] = reasoning
        }
      }
    }

    // 1b. Apply pending commands from each player
    for (const pid of [0, 1] as const) {
      const cmds = m.pendingCmds[pid].splice(0)  // drain queue
      if (cmds.length) applyCommands(m.state, cmds, pid)
    }

    // 2. Advance simulation
    gameTick(m.state)
    m.ticks++

    // 3. Store snapshot in DB every SNAPSHOT_EVERY ticks
    if (m.ticks % SNAPSHOT_EVERY === 0) {
      const snap0 = serializeForPlayer(m.state, 0)
      const snap1 = serializeForPlayer(m.state, 1)
      try {
        q.insertTick.run(m.matchId, m.state.tick, 0, '[]', JSON.stringify(snap0), m.reasonings[0] || null)
        q.insertTick.run(m.matchId, m.state.tick, 1, '[]', JSON.stringify(snap1), m.reasonings[1] || null)
      } catch (e) {
        // Non-fatal: match not in DB yet (race) or FK violation
      }
    }

    // 4. Broadcast to SSE subscribers
    for (const client of m.sseClients) {
      sendSSEState(m, client)
    }

    // 5. Check for game over
    if (m.state.winnerId !== null) {
      // Broadcast final state
      for (const client of m.sseClients) {
        sendSSEEvent(client.res, 'gameover', {
          winnerId:      m.state.winnerId,
          winnerAgentId: m.agentIds[m.state.winnerId],
          tick:          m.state.tick,
        })
      }

      // Auto-settle via DB
      settleMatch(m)
      stopMatch(m.matchId)
    }
  } catch (err) {
    console.error(`[GameManager] Tick error for match ${m.matchId}:`, err)
  }
}

// ── SSE helpers ────────────────────────────────────────────────────────────────

function sendSSEState(m: ActiveMatch, client: SSEClient): void {
  try {
    if (client.playerId !== null) {
      // Agent or player-specific view
      const snap = serializeForPlayer(m.state, client.playerId)
      sendSSEEvent(client.res, 'tick', snap)
    } else {
      // Spectator: send both perspectives + full metadata
      const snap0 = serializeForPlayer(m.state, 0)
      const snap1 = serializeForPlayer(m.state, 1)
      sendSSEEvent(client.res, 'tick', {
        tick:    m.state.tick,
        player0: snap0,
        player1: snap1,
        r0:      m.reasonings[0],
        r1:      m.reasonings[1],
      })
    }
  } catch { /* client disconnected */ }
}

function sendSSEEvent(res: ExpressResponse, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch { /* ignore */ }
}

// ── Auto-settle ────────────────────────────────────────────────────────────────

function settleMatch(m: ActiveMatch, attempt = 0): void {
  const winnerId      = m.state.winnerId!
  const winnerAgentId = m.agentIds[winnerId]
  const loserId       = 1 - winnerId
  const loserAgentId  = m.agentIds[loserId]

  try {
    const match = q.getMatch.get(m.matchId) as MatchRow | undefined
    if (!match) {
      // Race: match not yet committed to DB — retry up to 5 times with 100ms delay
      if (attempt < 5) {
        setTimeout(() => settleMatch(m, attempt + 1), 100)
        console.warn(`[GameManager] Match ${m.matchId} not in DB yet — retry ${attempt + 1}/5`)
      } else {
        console.error(`[GameManager] Match ${m.matchId} never appeared in DB — giving up`)
      }
      return
    }
    if (match.status === 'completed') return

    // Settle match record
    q.settleMatch.run(winnerAgentId, m.state.tick, m.matchId)

    // Update ELO + PnL
    const winner = q.getAgent.get(winnerAgentId) as AgentRow | undefined
    const loser  = q.getAgent.get(loserAgentId)  as AgentRow | undefined
    if (!winner || !loser) return

    // ELO
    const K    = 32
    const eW   = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400))
    const eL   = 1 - eW
    const newW = winner.elo + K * (1 - eW)
    const newL = loser.elo  + K * (0 - eL)

    // PnL (same formula as in matches route)
    const prizeWei  = BigInt(match.prize_wei)
    const wagerWei  = BigInt(match.wager_wei)
    const fee       = prizeWei * 5n / 100n
    const payout    = prizeWei - fee
    const winnerNet = payout - wagerWei
    const loserNet  = -wagerWei

    q.updateAgent.run(
      newW, winner.wins + 1, winner.losses, (BigInt(winner.pnl_wei) + winnerNet).toString(), winnerAgentId,
    )
    q.updateAgent.run(
      newL, loser.wins, loser.losses + 1, (BigInt(loser.pnl_wei) + loserNet).toString(), loserAgentId,
    )
    q.updateParticipantElo.run(newW, m.matchId, winnerAgentId)
    q.updateParticipantElo.run(newL, m.matchId, loserAgentId)

    console.log(
      `[GameManager] ✓ Match ${m.matchId} settled — Winner: ${winnerAgentId} ` +
      `(ELO ${Math.round(winner.elo)} → ${Math.round(newW)}) ` +
      `in ${m.state.tick} ticks`,
    )
  } catch (err) {
    console.error(`[GameManager] Error settling match ${m.matchId}:`, err)
  }
}

// ── Recovery: fix matches stuck as "active" in DB with no running game loop ───

export function recoverStuckMatches(): void {
  const allActive = (q.listMatches.all() as MatchRow[]).filter(m => m.status === 'active')
  for (const m of allActive) {
    if (!active.has(m.id)) {
      // DB says active but no game loop — force-settle as timeout (agent0 wins by default)
      try {
        q.settleMatch.run(m.agent0_id, 0, m.id)
        console.warn(`[GameManager] Recovered stuck match ${m.id} → timeout settle (winner: ${m.agent0_id})`)
      } catch (err) {
        console.error(`[GameManager] Failed to recover match ${m.id}:`, err)
      }
    }
  }
}
