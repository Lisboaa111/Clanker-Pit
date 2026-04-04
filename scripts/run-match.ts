#!/usr/bin/env node
/**
 * One-command test match runner.
 * Registers agents if needed, enters matchmaking pool, creates match.
 * The backend game server handles the simulation automatically.
 *
 * Usage:
 *   npx tsx scripts/run-match.ts
 *   AGENT0=agent-alpha AGENT1=agent-beta npx tsx scripts/run-match.ts
 */

const BACKEND  = process.env.BACKEND_URL ?? 'http://localhost:3001'
const AGENT0   = process.env.AGENT0 ?? 'agent-alpha'
const AGENT1   = process.env.AGENT1 ?? 'agent-beta'
const AGENT0_NAME = process.env.AGENT0_NAME ?? 'Alpha Rusher'
const AGENT1_NAME = process.env.AGENT1_NAME ?? 'Beta Economist'
const AGENT0_ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const AGENT1_ADDR = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

async function post(path: string, body: unknown) {
  const r = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json() as Promise<any>
}

async function get(path: string) {
  return (await fetch(`${BACKEND}${path}`)).json() as Promise<any>
}

async function main() {
  console.log(`\n╔══════════════════════════════════════════╗`)
  console.log(`║   Clanker Pit — Test Match Setup        ║`)
  console.log(`╚══════════════════════════════════════════╝\n`)
  console.log(`  Agents: ${AGENT0}  vs  ${AGENT1}`)
  console.log(`  Backend: ${BACKEND}\n`)

  // 1. Register agents (idempotent)
  for (const [id, name, addr] of [
    [AGENT0, AGENT0_NAME, AGENT0_ADDR],
    [AGENT1, AGENT1_NAME, AGENT1_ADDR],
  ]) {
    const existing = await get(`/agents/${id}`)
    if (existing.agent) {
      console.log(`[register] ${id} already registered (ELO ${Math.round(existing.agent.elo)})`)
    } else {
      const r = await post('/agents/register', {
        agentId: id, agentName: name, ownerAddr: addr, txHash: `0xdev_${id}_${Date.now()}`,
      })
      if (r.ok) console.log(`[register] ${id} registered`)
      else console.warn(`[register] ${id}: ${JSON.stringify(r)}`)
    }
  }

  // 2. Join matchmaking pool (uses CHAIN=local bypass)
  for (const [id, addr, tx] of [
    [AGENT0, AGENT0_ADDR, `0xpool0_${Date.now()}`],
    [AGENT1, AGENT1_ADDR, `0xpool1_${Date.now()}`],
  ]) {
    const r = await fetch(`${BACKEND}/matchmaking/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment':      tx,
        'X-From-Address': addr,
      },
      body: JSON.stringify({ agentId: id }),
    }).then(r => r.json()) as any
    if (r.ok) console.log(`[pool] ${id} joined pool`)
    else console.warn(`[pool] ${id}: ${JSON.stringify(r)}`)
  }

  // 3. Create match — server auto-starts game loop
  const { ok, match, error } = await post('/match/create', {
    agent0Id: AGENT0,
    agent1Id: AGENT1,
  })
  if (!ok) { console.error(`[match] Failed: ${error}`); process.exit(1) }

  console.log(`\n[match] ✓ Match started!`)
  console.log(`  ID:     ${match.id}`)
  console.log(`  Status: ${match.status}`)
  console.log(`  Wager:  ${(Number(BigInt(match.wager_wei)) / 1e18).toFixed(4)} ETH each`)
  console.log(`  Prize:  ${(Number(BigInt(match.prize_wei)) / 1e18).toFixed(4)} ETH total`)
  console.log(`\n  Server is now running the match.`)
  console.log(`  Open http://localhost:5174 → HISTORY → ● LIVE to watch in real time`)
  console.log(`  Or wait for it to finish and view → REPLAY\n`)

  // 4. Watch match progress in terminal
  console.log(`[watch] Polling match status…\n`)
  let lastTick = 0
  const poll = setInterval(async () => {
    const m = await get(`/match/${match.id}`)
    const allTicks = await get(`/match/${match.id}/replay`)
    const tickCount = (allTicks.ticks ?? []).length

    if (tickCount !== lastTick) {
      process.stdout.write(`  tick ~${tickCount / 2} | snapshots: ${tickCount}\r`)
      lastTick = tickCount
    }

    if (m.match?.status === 'completed') {
      clearInterval(poll)
      const winner = m.match.winner_id ?? '?'
      console.log(`\n\n[done] ✓ Match complete! Winner: ${winner}`)
      console.log(`  Duration: ${m.match.duration_ticks} ticks`)
      console.log(`  Open http://localhost:5174 → HISTORY → REPLAY to watch the replay\n`)
    }
  }, 2000)
}

main().catch(e => { console.error(e); process.exit(1) })
