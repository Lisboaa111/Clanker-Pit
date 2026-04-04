import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { z } from 'zod'
import { ensureAgentWallet, signAgentPayload, listAgentWallets } from './ows.js'
import { agentsRouter } from './routes/agents.js'
import { matchesRouter } from './routes/matches.js'
import { gameRouter } from './routes/game.js'
import { recoverStuckMatches } from './game/manager.js'
import { leaderboardRouter } from './routes/leaderboard.js'
import { matchmakingRouter } from './routes/matchmaking.js'
import { q, type MatchRow, type AgentRow } from './db.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'clanker-pit', uptime: process.uptime() })
})

// ── Arena routes ──────────────────────────────────────────────────────────────
app.use('/agents',      agentsRouter)
app.use('/match',       matchesRouter)
app.use('/game',        gameRouter)
app.use('/leaderboard', leaderboardRouter)
app.use('/matchmaking', matchmakingRouter)

// Alias: GET /matches (same as GET /match/ but easier to call)
app.get('/matches', (_req, res) => {
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

// ── Legacy wallet + skill endpoints (backwards compat) ───────────────────────
const unitOrders: unknown[] = []
const buildOrders: unknown[] = []

function send400(res: express.Response, msg: string) {
  res.status(400).json({ ok: false, error: msg })
}

app.post('/wallet/provision', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    chain: z.enum(['evm', 'solana', 'bitcoin', 'cosmos']).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)
  const wallet = await ensureAgentWallet(parsed.data.agentId, parsed.data.chain)
  res.json({ ok: true, wallet })
})

app.get('/wallet/list', (_req, res) => {
  res.json({ ok: true, wallets: listAgentWallets() })
})

const skillSchema = z.object({
  agentId:  z.string().min(1),
  unitIds:  z.array(z.string()).min(1),
  x: z.number(),
  z: z.number(),
})

async function skillHandler(skill: string, req: express.Request, res: express.Response) {
  const parsed = skillSchema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)
  const { agentId, unitIds, x, z: zCoord } = parsed.data
  const p   = JSON.stringify({ skill, agentId, unitIds, x, z: zCoord, ts: Date.now() })
  const sig = await signAgentPayload(agentId, p)
  const order = { agentId, unitIds, action: skill, target: { x, z: zCoord }, timestamp: Date.now(), signature: sig }
  unitOrders.push(order)
  res.json({ ok: true, order })
}

app.post('/skills/move-units', (req, res) => skillHandler('move', req, res))
app.post('/skills/attack',     (req, res) => skillHandler('attack', req, res))
app.post('/skills/gather',     (req, res) => skillHandler('gather', req, res))

app.post('/skills/build', async (req, res) => {
  const schema = z.object({
    agentId: z.string().min(1),
    unitIds: z.array(z.string()).min(1),
    buildingType: z.enum(['barracks', 'farm', 'tower', 'townhall']),
    x: z.number(),
    z: z.number(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return send400(res, parsed.error.message)
  const { agentId, unitIds, buildingType, x, z: zCoord } = parsed.data
  const p   = JSON.stringify({ skill: 'build', agentId, unitIds, buildingType, x, z: zCoord, ts: Date.now() })
  const sig = await signAgentPayload(agentId, p)
  const order = { agentId, buildingType, x, z: zCoord, timestamp: Date.now(), signature: sig }
  buildOrders.push(order)
  unitOrders.push({ agentId, unitIds, action: 'build', target: { buildingType }, timestamp: Date.now(), signature: sig })
  res.json({ ok: true, buildOrder: order })
})

app.get('/skills/orders',    (_req, res) => res.json({ ok: true, unitOrders, buildOrders }))
app.delete('/skills/orders', (_req, res) => { unitOrders.length = 0; buildOrders.length = 0; res.json({ ok: true, cleared: true }) })

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001
app.listen(PORT, () => {
  console.log(`Clanker Pit backend running on http://localhost:${PORT}`)
  recoverStuckMatches()
})
