/**
 * Clanker Pit RTS — Agent Skills Backend
 * Minimal Express server exposing RTS game skills for OWS-backed agents.
 */
import express from 'express'
import cors from 'cors'
import { z } from 'zod'
import { ensureAgentWallet, signAgentPayload, listAgentWallets } from './ows.js'

const app = express()
app.use(cors())
app.use(express.json())

// ---------------------------------------------------------------------------
// In-memory game state (single-game demo; replace with real state sync later)
// ---------------------------------------------------------------------------
interface UnitOrder {
  agentId: string
  unitIds: string[]
  action: 'move' | 'attack' | 'gather' | 'build'
  target: { x: number; z: number } | { buildingType: string }
  timestamp: number
  signature: string
}

interface BuildOrder {
  agentId: string
  buildingType: string
  x: number
  z: number
  timestamp: number
  signature: string
}

const unitOrders: UnitOrder[] = []
const buildOrders: BuildOrder[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function payload(obj: object): string {
  return JSON.stringify({ ...obj, ts: Date.now() })
}

function send400(res: express.Response, msg: string) {
  res.status(400).json({ ok: false, error: msg })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Health check */
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'clanker-pit-agent-skills', uptime: process.uptime() })
})

// --- Wallet ---

/**
 * POST /wallet/provision
 * Body: { agentId: string, chain?: 'evm'|'solana'|'bitcoin'|'cosmos' }
 * Ensures the agent has a wallet and returns its descriptor.
 */
app.post('/wallet/provision', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    chain: z.enum(['evm', 'solana', 'bitcoin', 'cosmos']).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)

  const { agentId, chain } = parsed.data
  const wallet = await ensureAgentWallet(agentId, chain)
  res.json({ ok: true, wallet })
})

/**
 * GET /wallet/list
 * Returns all provisioned agent wallets.
 */
app.get('/wallet/list', (_req, res) => {
  res.json({ ok: true, wallets: listAgentWallets() })
})

// --- Skills ---

/**
 * POST /skills/move-units
 * Body: { agentId, unitIds: string[], x: number, z: number }
 * Signs and enqueues a move order.
 */
app.post('/skills/move-units', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    unitIds: z.array(z.string()).min(1),
    x: z.number(),
    z: z.number(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)

  const { agentId, unitIds, x, z: zCoord } = parsed.data
  const p = payload({ skill: 'move-units', agentId, unitIds, x, z: zCoord })
  const signature = await signAgentPayload(agentId, p)

  const order: UnitOrder = {
    agentId,
    unitIds,
    action: 'move',
    target: { x, z: zCoord },
    timestamp: Date.now(),
    signature,
  }
  unitOrders.push(order)
  res.json({ ok: true, order })
})

/**
 * POST /skills/attack
 * Body: { agentId, unitIds: string[], x: number, z: number }
 * Signs and enqueues an attack-move order.
 */
app.post('/skills/attack', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    unitIds: z.array(z.string()).min(1),
    x: z.number(),
    z: z.number(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)

  const { agentId, unitIds, x, z: zCoord } = parsed.data
  const p = payload({ skill: 'attack', agentId, unitIds, x, z: zCoord })
  const signature = await signAgentPayload(agentId, p)

  const order: UnitOrder = {
    agentId,
    unitIds,
    action: 'attack',
    target: { x, z: zCoord },
    timestamp: Date.now(),
    signature,
  }
  unitOrders.push(order)
  res.json({ ok: true, order })
})

/**
 * POST /skills/gather
 * Body: { agentId, unitIds: string[], x: number, z: number }
 * Directs workers to gather resources at position.
 */
app.post('/skills/gather', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    unitIds: z.array(z.string()).min(1),
    x: z.number(),
    z: z.number(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)

  const { agentId, unitIds, x, z: zCoord } = parsed.data
  const p = payload({ skill: 'gather', agentId, unitIds, x, z: zCoord })
  const signature = await signAgentPayload(agentId, p)

  const order: UnitOrder = {
    agentId,
    unitIds,
    action: 'gather',
    target: { x, z: zCoord },
    timestamp: Date.now(),
    signature,
  }
  unitOrders.push(order)
  res.json({ ok: true, order })
})

/**
 * POST /skills/build
 * Body: { agentId, unitIds: string[], buildingType: string, x: number, z: number }
 * Queues a build order at the given map position.
 */
app.post('/skills/build', async (req, res) => {
  const VALID_BUILDINGS = ['barracks', 'farm', 'tower', 'townhall'] as const
  const schema = z.object({
    agentId: z.string().min(1),
    unitIds: z.array(z.string()).min(1),
    buildingType: z.enum(VALID_BUILDINGS),
    x: z.number(),
    z: z.number(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)

  const { agentId, unitIds, buildingType, x, z: zCoord } = parsed.data
  const p = payload({ skill: 'build', agentId, unitIds, buildingType, x, z: zCoord })
  const signature = await signAgentPayload(agentId, p)

  const order: BuildOrder = {
    agentId,
    buildingType,
    x,
    z: zCoord,
    timestamp: Date.now(),
    signature,
  }
  buildOrders.push(order)

  // Also enqueue the unit move-to-build order
  const moveOrder: UnitOrder = {
    agentId,
    unitIds,
    action: 'build',
    target: { buildingType },
    timestamp: Date.now(),
    signature,
  }
  unitOrders.push(moveOrder)

  res.json({ ok: true, buildOrder: order })
})

/**
 * GET /skills/orders
 * Returns all pending skill orders (unit + build).
 * The game client polls this to apply agent commands to game state.
 */
app.get('/skills/orders', (_req, res) => {
  res.json({ ok: true, unitOrders, buildOrders })
})

/**
 * DELETE /skills/orders
 * Clears all pending orders (call after the game has consumed them).
 */
app.delete('/skills/orders', (_req, res) => {
  unitOrders.length = 0
  buildOrders.length = 0
  res.json({ ok: true, cleared: true })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log(`Clanker Pit agent-skills backend running on http://localhost:${PORT}`)
})
