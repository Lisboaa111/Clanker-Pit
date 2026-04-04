/**
 * Matchmaking pool — agents pay the wager via x402 to join, becoming available
 * to play for up to N minutes. When a match is created, the platform forwards
 * both agents' wagers to the on-chain escrow contract.
 *
 * This is purely in-memory (no DB persistence) — it's a volatile signal, not a record.
 */
import { Router } from 'express'
import { z } from 'zod'
import { q, type AgentRow } from '../db.js'
import { requirePayment } from '../x402.js'

export const matchmakingRouter = Router()

const DEFAULT_TTL_MS = 5 * 60 * 1000   // 5 minutes
const MAX_TTL_MS     = 30 * 60 * 1000  // 30 minutes cap

export interface PoolEntry {
  agentId:     string
  name:        string
  ownerAddr:   string   // payment sender = prize recipient
  elo:         number
  wagerWei:    string   // wei as string
  wagerTxHash: string
  joinedAt:    number   // unix ms
  expiresAt:   number   // unix ms
}

const pool = new Map<string, PoolEntry>()

function pruneExpired() {
  const now = Date.now()
  for (const [id, entry] of pool) {
    if (entry.expiresAt <= now) pool.delete(id)
  }
}

export function getPoolEntry(agentId: string): PoolEntry | undefined {
  pruneExpired()
  return pool.get(agentId)
}

export function removeFromPool(agentId: string) {
  pool.delete(agentId)
}

// ── POST /matchmaking/join ────────────────────────────────────────────────────
// Pay the wager via x402 to enter the matchmaking pool.
// When a match is created the platform forwards this ETH to the contract escrow.
// Body: { agentId, ttlMinutes? }
matchmakingRouter.post('/join', requirePayment('matchmaking_join'), async (req, res) => {
  const schema = z.object({
    agentId:    z.string().min(1),
    ttlMinutes: z.number().positive().max(30).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const { agentId, ttlMinutes } = parsed.data
  const agent = q.getAgent.get(agentId) as AgentRow | undefined
  if (!agent) return res.status(404).json({ error: 'Agent not registered — register first' })

  const payment = res.locals.payment as { txHash: string; fromAddr: string; amountWei: bigint }

  // Record payment for replay protection
  q.insertPayment.run(payment.txHash, payment.fromAddr, payment.amountWei.toString(), 'matchmaking_join', null)

  pruneExpired()

  const ttlMs     = ttlMinutes ? Math.min(ttlMinutes * 60_000, MAX_TTL_MS) : DEFAULT_TTL_MS
  const now       = Date.now()
  const expiresAt = now + ttlMs

  pool.set(agentId, {
    agentId,
    name:        agent.name,
    ownerAddr:   payment.fromAddr,   // x402 sender = prize recipient on-chain
    elo:         agent.elo,
    wagerWei:    payment.amountWei.toString(),
    wagerTxHash: payment.txHash,
    joinedAt:    now,
    expiresAt,
  })

  res.json({
    ok: true,
    agentId,
    wagerWei:         payment.amountWei.toString(),
    expiresAt:        new Date(expiresAt).toISOString(),
    expiresInSeconds: Math.round(ttlMs / 1000),
  })
})

// ── GET /matchmaking/active ───────────────────────────────────────────────────
// List all agents currently in the pool, sorted by ELO descending.
matchmakingRouter.get('/active', (req, res) => {
  pruneExpired()

  const now    = Date.now()
  const active = [...pool.values()]
    .sort((a, b) => b.elo - a.elo)
    .map(e => ({
      agentId:          e.agentId,
      name:             e.name,
      elo:              e.elo,
      wagerWei:         e.wagerWei,
      expiresAt:        new Date(e.expiresAt).toISOString(),
      remainingSeconds: Math.max(0, Math.round((e.expiresAt - now) / 1000)),
    }))

  res.json({ ok: true, count: active.length, agents: active })
})

// ── DELETE /matchmaking/leave ─────────────────────────────────────────────────
// Voluntarily leave the pool.
// Body: { agentId }
matchmakingRouter.delete('/leave', (req, res) => {
  const schema = z.object({ agentId: z.string().min(1) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const removed = pool.delete(parsed.data.agentId)
  res.json({ ok: true, removed })
})

// ── GET /matchmaking/active/:agentId ─────────────────────────────────────────
// Check if a specific agent is currently in the pool.
matchmakingRouter.get('/active/:agentId', (req, res) => {
  pruneExpired()
  const entry = pool.get(req.params.agentId)
  if (!entry) return res.json({ ok: true, active: false })

  const now = Date.now()
  res.json({
    ok: true,
    active:           true,
    agentId:          entry.agentId,
    wagerWei:         entry.wagerWei,
    expiresAt:        new Date(entry.expiresAt).toISOString(),
    remainingSeconds: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
  })
})
