import { Router } from 'express'
import { z } from 'zod'
import { q, type TickRow } from '../db.js'
import {
  submitCommand, getState, getStateByPid, subscribeSSE, isActive,
} from '../game/manager.js'
import type { AgentCommand } from '../game/types.js'

export const gameRouter = Router()

/**
 * GET /game/state/:matchId?agentId=xxx
 * Agents poll this to get current game state from their perspective.
 * If match is still active, returns live state from manager.
 * If match is over, returns last recorded snapshot from DB.
 */
gameRouter.get('/state/:matchId', (req, res) => {
  const { matchId } = req.params
  const agentId  = req.query.agentId  as string | undefined
  const playerIdQ = req.query.playerId as string | undefined

  // Live: resolve perspective
  if (isActive(matchId)) {
    let snap = null
    if (agentId) {
      snap = getState(matchId, agentId)
    } else if (playerIdQ !== undefined) {
      snap = getStateByPid(matchId, Number(playerIdQ))
    } else {
      snap = getStateByPid(matchId, 0)  // default: P0 view
    }
    if (!snap) return res.status(404).json({ error: 'Match not found or agent not in match' })
    return res.json({ ok: true, live: true, tick: snap.tick, state: snap })
  }

  // Finished: serve latest snapshot from DB
  const allTicks = q.ticksByMatch.all(matchId) as TickRow[]
  const snapped  = [...allTicks].reverse().find(t => t.state_snap !== null)
  if (!snapped) return res.status(404).json({ error: 'No state found for match' })

  return res.json({
    ok: true, live: false,
    tick: snapped.tick,
    state: snapped.state_snap ? JSON.parse(snapped.state_snap) : null,
  })
})

/**
 * GET /game/stream/:matchId?agentId=xxx  OR  ?playerId=0|1  OR  (no param = spectator)
 * Server-Sent Events stream — pushed every server tick.
 * Agents use this to receive state without polling.
 * Frontend spectator view uses this with no agentId.
 */
gameRouter.get('/stream/:matchId', (req, res) => {
  const { matchId } = req.params
  const agentId   = req.query.agentId   as string | undefined
  const playerIdQ = req.query.playerId  as string | undefined

  if (!isActive(matchId)) {
    return res.status(410).json({ error: 'Match not active — use replay endpoint for finished matches' })
  }

  // Resolve perspective
  let pid: number | null = null
  if (agentId) {
    // We'd need to look up which player this agent is — just parse from manager
    // Handled inside subscribeSSE when pid=null but agentId is set:
    // For now, require explicit playerId or agentId resolves inside subscribeSSE
    pid = agentId ? null : null  // spectator unless playerId given
  }
  if (playerIdQ !== undefined) {
    pid = Number(playerIdQ)
  }

  subscribeSSE(matchId, pid, res)
})

/**
 * POST /game/command
 * Agents submit commands. Server validates ownership and queues.
 * Body: { matchId, agentId, command, reasoning? }
 */
gameRouter.post('/command', (req, res) => {
  const schema = z.object({
    matchId:   z.string().min(1),
    agentId:   z.string().min(1),
    command:   z.record(z.unknown()),
    reasoning: z.string().optional(),
    // Legacy fields (ignored)
    playerId:  z.number().optional(),
    signature: z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const { matchId, agentId, command, reasoning } = parsed.data

  // Verify agent is registered
  const agent = q.getAgent.get(agentId)
  if (!agent) return res.status(403).json({ error: 'Unknown agent' })

  const result = submitCommand(matchId, agentId, command as AgentCommand, reasoning)
  if (!result.ok) return res.status(400).json({ error: result.error })

  res.json({ ok: true })
})

/**
 * POST /game/state  (legacy — kept for backwards compat with browser GameView)
 * Frontend can still push state; stored in DB for replay.
 * Not used by the authoritative server loop.
 */
gameRouter.post('/state', (req, res) => {
  const schema = z.object({
    matchId:      z.string().min(1),
    tick:         z.number().int().min(0),
    playerId:     z.number().int().min(0).max(1),
    stateJson:    z.string(),
    commandsJson: z.string().optional(),
    reasoning:    z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const { matchId, tick, playerId, stateJson, commandsJson, reasoning } = parsed.data
  q.insertTick.run(matchId, tick, playerId, commandsJson ?? '[]', stateJson, reasoning ?? null)

  res.json({ ok: true })
})
