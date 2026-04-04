/**
 * Backend API tests — uses in-memory SQLite and mocked x402/OWS.
 * Run: npm test
 */
import './setup.js'

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import cors from 'cors'

const { agentsRouter }     = await import('../routes/agents.js')
const { matchesRouter }    = await import('../routes/matches.js')
const { gameRouter }       = await import('../routes/game.js')
const { leaderboardRouter }= await import('../routes/leaderboard.js')
const { matchmakingRouter }= await import('../routes/matchmaking.js')
const { q }                = await import('../db.js')

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use('/agents',      agentsRouter)
app.use('/match',       matchesRouter)
app.use('/game',        gameRouter)
app.use('/leaderboard', leaderboardRouter)
app.use('/matchmaking', matchmakingRouter)

// ── Helpers ────────────────────────────────────────────────────────────────────

async function registerAgent(id: string, name: string) {
  return request(app).post('/agents/register').send({ id, name })
}

/** Join matchmaking pool (mock x402 always accepts). */
async function joinMatchmaking(agentId: string) {
  return request(app).post('/matchmaking/join')
    .set('X-Payment', '0x' + agentId.padEnd(64, '0').slice(0, 64))
    .set('X-From-Address', '0x' + '01'.repeat(20))
    .send({ agentId })
}

/**
 * Create an active match — joins both agents to pool first, then creates match.
 * Both agents must already be registered.
 */
async function createActiveMatch(agent0Id: string, agent1Id: string) {
  await joinMatchmaking(agent0Id)
  await joinMatchmaking(agent1Id)
  return request(app).post('/match/create').send({ agent0Id, agent1Id })
}

// ── /leaderboard ───────────────────────────────────────────────────────────────
describe('GET /leaderboard', () => {
  it('returns empty array when no agents', async () => {
    const res = await request(app).get('/leaderboard')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.leaderboard).toEqual([])
  })

  it('ranks agents by ELO descending', async () => {
    await registerAgent('lb-hi', 'Alpha')
    await registerAgent('lb-lo', 'Beta')

    for (let i = 0; i < 3; i++) {
      const cr = await createActiveMatch('lb-hi', 'lb-lo')
      await request(app).post(`/match/${cr.body.match.id}/settle`).send({ winnerId: 'lb-hi', durationTicks: 100 })
    }

    const res = await request(app).get('/leaderboard')
    const lb = res.body.leaderboard as Array<{ id: string; elo: number; rank: number }>
    const hi = lb.find(e => e.id === 'lb-hi')!
    const lo = lb.find(e => e.id === 'lb-lo')!
    expect(hi.rank).toBeLessThan(lo.rank)
    expect(hi.elo).toBeGreaterThan(lo.elo)
  })
})

// ── /agents ────────────────────────────────────────────────────────────────────
describe('POST /agents/register', () => {
  it('registers a new agent', async () => {
    const res = await registerAgent('agent-reg-1', 'Registered One')
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.agent.id).toBe('agent-reg-1')
    expect(res.body.agent.elo).toBe(1200)
  })

  it('rejects duplicate agent ID', async () => {
    await registerAgent('dup-agent', 'First')
    const res = await registerAgent('dup-agent', 'Second')
    expect(res.status).toBe(409)
  })

  it('rejects invalid agent ID (spaces)', async () => {
    const res = await request(app).post('/agents/register').send({ id: 'bad id', name: 'X' })
    expect(res.status).toBe(400)
  })

  it('rejects missing name', async () => {
    const res = await request(app).post('/agents/register').send({ id: 'no-name' })
    expect(res.status).toBe(400)
  })
})

describe('GET /agents', () => {
  it('returns list of agents', async () => {
    const res = await request(app).get('/agents')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.agents)).toBe(true)
  })
})

describe('GET /agents/:id', () => {
  it('returns agent with match history', async () => {
    const res = await request(app).get('/agents/agent-reg-1')
    expect(res.status).toBe(200)
    expect(res.body.agent.id).toBe('agent-reg-1')
    expect(Array.isArray(res.body.matches)).toBe(true)
  })

  it('returns 404 for unknown agent', async () => {
    const res = await request(app).get('/agents/nobody')
    expect(res.status).toBe(404)
  })
})

// ── /matchmaking ───────────────────────────────────────────────────────────────
describe('matchmaking pool', () => {
  beforeAll(async () => {
    await registerAgent('mm-a', 'MM Agent A')
    await registerAgent('mm-b', 'MM Agent B')
  })

  it('allows registered agent to join pool (x402 gated)', async () => {
    const res = await joinMatchmaking('mm-a')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.expiresInSeconds).toBe(300)
    expect(res.body.wagerWei).toBeTruthy()
  })

  it('rejects unregistered agent', async () => {
    const res = await request(app).post('/matchmaking/join')
      .set('X-Payment', '0x' + 'ff'.repeat(32))
      .send({ agentId: 'ghost' })
    expect(res.status).toBe(404)
  })

  it('lists active agents with wager info', async () => {
    await joinMatchmaking('mm-b')
    const res = await request(app).get('/matchmaking/active')
    expect(res.status).toBe(200)
    const ids = res.body.agents.map((a: any) => a.agentId)
    expect(ids).toContain('mm-a')
    expect(ids).toContain('mm-b')
    expect(res.body.agents[0].wagerWei).toBeTruthy()
  })

  it('checks specific agent active status', async () => {
    const res = await request(app).get('/matchmaking/active/mm-a')
    expect(res.body.active).toBe(true)
    expect(res.body.wagerWei).toBeTruthy()
  })

  it('removes agent from pool on leave', async () => {
    await request(app).delete('/matchmaking/leave').send({ agentId: 'mm-a' })
    const res = await request(app).get('/matchmaking/active/mm-a')
    expect(res.body.active).toBe(false)
  })
})

// ── /match ─────────────────────────────────────────────────────────────────────
describe('POST /match/create', () => {
  beforeAll(async () => {
    await registerAgent('match-a', 'Match A')
    await registerAgent('match-b', 'Match B')
  })

  it('creates a match (immediately active) when both agents are in pool', async () => {
    await joinMatchmaking('match-a')
    await joinMatchmaking('match-b')
    const res = await request(app).post('/match/create')
      .send({ agent0Id: 'match-a', agent1Id: 'match-b' })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.match.agent0_id).toBe('match-a')
    expect(res.body.match.status).toBe('active')
    expect(res.body.match.prize_wei).toBeTruthy()
  })

  it('rejects if agent not in matchmaking pool', async () => {
    // match-a and match-b were removed from pool by previous test
    const res = await request(app).post('/match/create')
      .send({ agent0Id: 'match-a', agent1Id: 'match-b' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/pool/)
  })

  it('rejects unknown agent', async () => {
    const res = await request(app).post('/match/create')
      .send({ agent0Id: 'ghost', agent1Id: 'match-b' })
    expect(res.status).toBe(404)
  })
})

describe('GET /match/:id', () => {
  beforeAll(async () => {
    await registerAgent('get-match-a', 'Get Match A')
    await registerAgent('get-match-b', 'Get Match B')
  })

  it('returns match with agent names', async () => {
    const cr = await createActiveMatch('get-match-a', 'get-match-b')
    const res = await request(app).get(`/match/${cr.body.match.id}`)
    expect(res.status).toBe(200)
    expect(res.body.agents['get-match-a'].name).toBe('Get Match A')
  })

  it('returns 404 for unknown match', async () => {
    const res = await request(app).get('/match/fake-id')
    expect(res.status).toBe(404)
  })
})

describe('POST /match/:id/settle', () => {
  beforeAll(async () => {
    await registerAgent('settle-a', 'Settle A')
    await registerAgent('settle-b', 'Settle B')
  })

  it('settles active match, updates ELO', async () => {
    const cr = await createActiveMatch('settle-a', 'settle-b')
    const matchId = cr.body.match.id

    const res = await request(app).post(`/match/${matchId}/settle`)
      .send({ winnerId: 'settle-a', durationTicks: 500 })

    expect(res.status).toBe(200)
    expect(res.body.match.status).toBe('completed')
    expect(res.body.match.winner_id).toBe('settle-a')
    expect(res.body.eloChange['settle-a']).toBeGreaterThan(1200)
    expect(res.body.eloChange['settle-b']).toBeLessThan(1200)
  })

  it('rejects double settle', async () => {
    const cr = await createActiveMatch('settle-a', 'settle-b')
    const matchId = cr.body.match.id
    await request(app).post(`/match/${matchId}/settle`).send({ winnerId: 'settle-a', durationTicks: 100 })
    const res = await request(app).post(`/match/${matchId}/settle`).send({ winnerId: 'settle-a', durationTicks: 100 })
    expect(res.status).toBe(409)
  })

  it('rejects invalid winnerId', async () => {
    const cr = await createActiveMatch('settle-a', 'settle-b')
    const res = await request(app).post(`/match/${cr.body.match.id}/settle`)
      .send({ winnerId: 'ghost', durationTicks: 100 })
    expect(res.status).toBe(400)
  })
})

describe('GET /match/:id/replay', () => {
  beforeAll(async () => {
    await registerAgent('replay-a', 'Replay A')
    await registerAgent('replay-b', 'Replay B')
  })

  it('returns empty ticks for new match', async () => {
    const cr = await createActiveMatch('replay-a', 'replay-b')
    const res = await request(app).get(`/match/${cr.body.match.id}/replay`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.ticks)).toBe(true)
    expect(res.body.ticks).toHaveLength(0)
  })
})

// ── /game ───────────────────────────────────────────────────────────────────────
describe('POST /game/state', () => {
  it('stores game state tick', async () => {
    const res = await request(app).post('/game/state').send({
      matchId: 'game-match-1', tick: 10, playerId: 0,
      stateJson: JSON.stringify({ tick: 10, gold: 300 }),
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('rejects missing matchId', async () => {
    const res = await request(app).post('/game/state').send({ tick: 1 })
    expect(res.status).toBe(400)
  })
})

describe('GET /game/state/:matchId', () => {
  it('returns latest tick state', async () => {
    await request(app).post('/game/state').send({
      matchId: 'game-match-2', tick: 5, playerId: 0,
      stateJson: JSON.stringify({ tick: 5, gold: 200 }),
    })
    const res = await request(app).get('/game/state/game-match-2')
    expect(res.status).toBe(200)
    expect(res.body.tick).toBe(5)
  })

  it('stores snapshot every 10th tick', async () => {
    await request(app).post('/game/state').send({
      matchId: 'game-match-snap', tick: 10, playerId: 0,
      stateJson: JSON.stringify({ tick: 10, gold: 400 }),
    })
    const res = await request(app).get('/game/state/game-match-snap')
    expect(res.body.state).not.toBeNull()
    expect(res.body.state.gold).toBe(400)
  })

  it('returns 404 for unknown match', async () => {
    const res = await request(app).get('/game/state/nobody')
    expect(res.status).toBe(404)
  })
})

describe('POST /game/command', () => {
  beforeAll(async () => {
    await registerAgent('cmd-agent', 'Command Agent')
  })

  it('queues a command for a known agent', async () => {
    const res = await request(app).post('/game/command').send({
      matchId: 'cmd-match-1', agentId: 'cmd-agent', playerId: 0,
      command: { type: 'ATTACK_MOVE', unitIds: ['u1'], tx: 40, tz: 40 },
      signature: '0xdeadbeef',
    })
    expect(res.status).toBe(200)
    expect(res.body.queued).toBe(1)
  })

  it('rejects command from unknown agent', async () => {
    const res = await request(app).post('/game/command').send({
      matchId: 'cmd-match-1', agentId: 'ghost-agent', playerId: 0,
      command: { type: 'MOVE' }, signature: '0xdeadbeef',
    })
    expect(res.status).toBe(403)
  })

  it('GET /game/command/:matchId consumes and clears queue', async () => {
    const res = await request(app).get('/game/command/cmd-match-1')
    expect(res.status).toBe(200)
    expect(res.body.commands.length).toBeGreaterThan(0)
    const res2 = await request(app).get('/game/command/cmd-match-1')
    expect(res2.body.commands).toHaveLength(0)
  })
})

// ── ELO correctness ─────────────────────────────────────────────────────────────
describe('ELO calculation', () => {
  beforeAll(async () => {
    await registerAgent('elo-x', 'ELO X')
    await registerAgent('elo-y', 'ELO Y')
  })

  it('equal-rated players: winner gains ~16, loser loses ~16', async () => {
    const cr = await createActiveMatch('elo-x', 'elo-y')
    const settleRes = await request(app)
      .post(`/match/${cr.body.match.id}/settle`)
      .send({ winnerId: 'elo-x', durationTicks: 200 })

    const { eloChange } = settleRes.body
    expect(eloChange['elo-x']).toBeCloseTo(1200 + 16, 0)
    expect(eloChange['elo-y']).toBeCloseTo(1200 - 16, 0)
  })
})
