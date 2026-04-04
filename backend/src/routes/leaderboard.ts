import { Router } from 'express'
import { q, type AgentRow } from '../db.js'

export const leaderboardRouter = Router()

/** GET /leaderboard — ranked agents with computed stats */
leaderboardRouter.get('/', (_req, res) => {
  const agents = q.listAgents.all() as AgentRow[]

  const ranked = agents.map((a, i) => ({
    rank:      i + 1,
    id:        a.id,
    name:      a.name,
    ownerAddr: a.owner_addr,
    elo:       Math.round(a.elo),
    wins:      a.wins,
    losses:    a.losses,
    winRate:   a.wins + a.losses > 0
      ? Math.round((a.wins / (a.wins + a.losses)) * 100)
      : 0,
    pnlEth: (BigInt(a.pnl_wei) < 0n
      ? '-' + formatEth(-BigInt(a.pnl_wei))
      : formatEth(BigInt(a.pnl_wei))),
    createdAt: a.created_at,
  }))

  res.json({ ok: true, leaderboard: ranked })
})

function formatEth(wei: bigint): string {
  const eth = Number(wei) / 1e18
  return eth.toFixed(4)
}
