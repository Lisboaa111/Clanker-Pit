import { Router } from 'express'
import { z } from 'zod'
import { v4 as uuid } from 'uuid'
import { ethers } from 'ethers'
import { q, type AgentRow, type MatchRow, type TickRow } from '../db.js'
import { calcElo } from './agents.js'
import { getPoolEntry, removeFromPool } from './matchmaking.js'
import { startMatch } from '../game/manager.js'

export const matchesRouter = Router()

const ARENA_ADDRESS        = process.env.ARENA_ADDRESS ?? ''
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? ''
const SEPOLIA_RPC_URL      = process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'

const ARENA_ABI = [
  'function deposit(bytes32 matchId, uint8 slot, address depositorAddr) external payable',
  'function settle(bytes32 matchId, address winner) external',
  'function refund(bytes32 matchId) external',
]

function arenaContract() {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL)
  const signer   = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider)
  return new ethers.Contract(ARENA_ADDRESS, ARENA_ABI, signer)
}

/** Convert a match UUID to the bytes32 used on-chain (keccak256). */
export function matchIdBytes32(matchId: string): string {
  return ethers.id(matchId)
}

/**
 * Platform calls arena.deposit() forwarding the agent's x402 wager ETH.
 * depositorAddr is the agent's wallet — stored on-chain as the prize recipient.
 */
async function callContractDeposit(
  matchId: string,
  slot: 0 | 1,
  depositorAddr: string,
  wagerWei: bigint,
): Promise<string | null> {
  if (!ARENA_ADDRESS || !DEPLOYER_PRIVATE_KEY) {
    console.warn('[contract] ARENA_ADDRESS or DEPLOYER_PRIVATE_KEY not set — skipping on-chain deposit')
    return null
  }
  try {
    const arena = arenaContract()
    const tx    = await arena.deposit(matchIdBytes32(matchId), slot, depositorAddr, { value: wagerWei })
    await tx.wait()
    console.log(`[contract] deposited slot ${slot} for match ${matchId} → tx ${tx.hash}`)
    return tx.hash as string
  } catch (err) {
    console.error('[contract] deposit failed:', (err as Error).message)
    return null
  }
}

async function callContractSettle(matchId: string, winnerAddress: string): Promise<string | null> {
  if (!ARENA_ADDRESS || !DEPLOYER_PRIVATE_KEY) {
    console.warn('[contract] ARENA_ADDRESS or DEPLOYER_PRIVATE_KEY not set — skipping on-chain settle')
    return null
  }
  try {
    const arena = arenaContract()
    const tx    = await arena.settle(matchIdBytes32(matchId), winnerAddress)
    await tx.wait()
    return tx.hash as string
  } catch (err) {
    console.error('[contract] settle failed:', (err as Error).message)
    return null
  }
}

// ── POST /match/create ────────────────────────────────────────────────────────
// Both agents must be in the matchmaking pool (having paid their wager via x402).
// The platform forwards both wagers to the on-chain escrow; match is immediately active.
matchesRouter.post('/create', async (req, res) => {
  const schema = z.object({
    agent0Id: z.string().min(1),
    agent1Id: z.string().min(1),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const { agent0Id, agent1Id } = parsed.data

  const a0 = q.getAgent.get(agent0Id) as AgentRow | undefined
  const a1 = q.getAgent.get(agent1Id) as AgentRow | undefined
  if (!a0) return res.status(404).json({ error: `Agent ${agent0Id} not found` })
  if (!a1) return res.status(404).json({ error: `Agent ${agent1Id} not found` })

  // Both agents must have paid wager via x402 to enter the pool
  const pool0 = getPoolEntry(agent0Id)
  const pool1 = getPoolEntry(agent1Id)
  if (!pool0) return res.status(400).json({ error: `Agent ${agent0Id} is not in the matchmaking pool — join first` })
  if (!pool1) return res.status(400).json({ error: `Agent ${agent1Id} is not in the matchmaking pool — join first` })

  const matchId  = uuid()
  const wagerWei = pool0.wagerWei
  const prizeWei = (BigInt(pool0.wagerWei) + BigInt(pool1.wagerWei)).toString()

  // Insert match and participants
  q.insertMatch.run(matchId, agent0Id, agent1Id, wagerWei)
  q.insertParticipant.run(matchId, agent0Id, 0, a0.elo)
  q.insertParticipant.run(matchId, agent1Id, 1, a1.elo)

  // Record depositor addresses (prize recipients) and wager tx hashes
  q.recordDeposit0.run(pool0.ownerAddr, pool0.wagerTxHash, matchId)
  q.recordDeposit1.run(pool1.ownerAddr, pool1.wagerTxHash, matchId)

  // Match is immediately active — both wagers are already in platform custody
  q.activateMatch.run(prizeWei, matchId)

  // Remove both agents from pool
  removeFromPool(agent0Id)
  removeFromPool(agent1Id)

  // Forward wagers to on-chain escrow (fire-and-forget)
  callContractDeposit(matchId, 0, pool0.ownerAddr, BigInt(pool0.wagerWei)).catch(console.error)
  callContractDeposit(matchId, 1, pool1.ownerAddr, BigInt(pool1.wagerWei)).catch(console.error)

  // ── Start server-side game loop immediately ───────────────────────────────
  startMatch(matchId, agent0Id, agent1Id)

  res.status(201).json({ ok: true, match: q.getMatch.get(matchId) })
})

// ── POST /match/:id/settle ───────────────────────────────────────────────────
matchesRouter.post('/:id/settle', async (req, res) => {
  const schema = z.object({
    winnerId:      z.string().min(1),
    durationTicks: z.number().int().positive(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const match = q.getMatch.get(req.params.id) as MatchRow | undefined
  if (!match) return res.status(404).json({ error: 'Match not found' })
  if (match.status === 'completed') return res.status(409).json({ error: 'Already settled' })
  if (match.status !== 'active') {
    return res.status(409).json({ error: 'Match is not active' })
  }

  const { winnerId, durationTicks } = parsed.data
  const loserId = match.agent0_id === winnerId ? match.agent1_id : match.agent0_id

  const winner = q.getAgent.get(winnerId) as AgentRow | undefined
  const loser  = q.getAgent.get(loserId)  as AgentRow | undefined
  if (!winner || !loser) return res.status(400).json({ error: 'Invalid winnerId' })

  const [newWinnerElo, newLoserElo] = calcElo(winner.elo, loser.elo, true)

  const prizeWei     = BigInt(match.prize_wei)
  const wagerWei     = BigInt(match.wager_wei)   // per-agent entry cost
  const fee          = prizeWei * 5n / 100n
  const payout       = prizeWei - fee             // gross amount winner receives on-chain
  const winnerNetPnl = payout - wagerWei          // profit = got back − paid in
  const loserNetPnl  = -wagerWei                  // loss = paid in, received nothing

  q.settleMatch.run(winnerId, durationTicks, match.id)
  q.updateParticipantElo.run(newWinnerElo, match.id, winnerId)
  q.updateParticipantElo.run(newLoserElo,  match.id, loserId)

  const winnerNewPnl = (BigInt(winner.pnl_wei) + winnerNetPnl).toString()
  const loserNewPnl  = (BigInt(loser.pnl_wei)  + loserNetPnl).toString()

  q.updateAgent.run(newWinnerElo, winner.wins + 1, winner.losses,     winnerNewPnl, winnerId)
  q.updateAgent.run(newLoserElo,  loser.wins,       loser.losses + 1, loserNewPnl,  loserId)

  // On-chain settlement — winner's depositor address is stored in match row
  const winnerDepAddr = winnerId === match.agent0_id ? match.deposit0_addr : match.deposit1_addr
  if (winnerDepAddr) {
    callContractSettle(match.id, winnerDepAddr)
      .then(txHash => txHash && console.log(`[contract] settled match ${match.id} → ${txHash}`))
      .catch(console.error)
  } else {
    console.warn(`[contract] no depositor address for winner ${winnerId} — skipping on-chain settle`)
  }

  res.json({
    ok: true,
    match:     q.getMatch.get(match.id),
    eloChange: { [winnerId]: newWinnerElo, [loserId]: newLoserElo },
  })
})

/** GET /match/:id */
matchesRouter.get('/:id', (req, res) => {
  const match = q.getMatch.get(req.params.id) as MatchRow | undefined
  if (!match) return res.status(404).json({ error: 'Match not found' })

  const a0 = q.getAgent.get(match.agent0_id) as AgentRow
  const a1 = q.getAgent.get(match.agent1_id) as AgentRow
  res.json({ ok: true, match, agents: { [match.agent0_id]: a0, [match.agent1_id]: a1 } })
})

/** GET /match/:id/replay */
matchesRouter.get('/:id/replay', (req, res) => {
  const match = q.getMatch.get(req.params.id) as MatchRow | undefined
  if (!match) return res.status(404).json({ error: 'Match not found' })

  const a0 = q.getAgent.get(match.agent0_id) as AgentRow | undefined
  const a1 = q.getAgent.get(match.agent1_id) as AgentRow | undefined
  const ticks = q.ticksByMatch.all(match.id) as TickRow[]
  res.json({
    ok: true,
    match,
    agents: [
      { id: match.agent0_id, name: a0?.name ?? match.agent0_id },
      { id: match.agent1_id, name: a1?.name ?? match.agent1_id },
    ],
    ticks,
  })
})

/** GET /match/ — list all */
matchesRouter.get('/', (_req, res) => {
  const matches = q.listMatches.all() as MatchRow[]
  const enriched = matches.map(m => ({
    ...m,
    agent0Name: (q.getAgent.get(m.agent0_id) as AgentRow | undefined)?.name ?? m.agent0_id,
    agent1Name: (q.getAgent.get(m.agent1_id) as AgentRow | undefined)?.name ?? m.agent1_id,
    winnerName: m.winner_id
      ? (q.getAgent.get(m.winner_id) as AgentRow | undefined)?.name ?? m.winner_id
      : null,
  }))
  res.json({ ok: true, matches: enriched })
})
