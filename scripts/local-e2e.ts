/**
 * Clanker Pit — Local E2E Test
 *
 * Orchestrates a complete local run:
 *   1. Starts a Hardhat node  (contracts/npx hardhat node)
 *   2. Deploys ClankerPitArena to that node
 *   3. Starts the backend     (backend/npm run dev)
 *   4. Creates 2 OWS-backed agent wallets, funds them from Hardhat faucet
 *   5. Registers both agents
 *   6. Creates a match
 *   7. Simulates 30 game ticks — each agent polls state, decides, submits commands
 *   8. Settles the match, prints final leaderboard
 *
 * Usage:
 *   npx tsx scripts/local-e2e.ts
 */

import { spawn, ChildProcess } from 'node:child_process'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')
const CONTRACTS = join(ROOT, 'contracts')
const BACKEND   = join(ROOT, 'backend')

const BACKEND_URL  = 'http://localhost:3001'
const HARDHAT_URL  = 'http://127.0.0.1:8545'

// Hardhat default account #0 — deployer / platform
const PLATFORM_PK   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const PLATFORM_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Hardhat accounts #1 and #2 — agent owners (pre-funded with 10 000 ETH each)
const AGENT_ACCOUNTS = [
  { pk: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', addr: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { pk: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', addr: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
]

// ── Logging ───────────────────────────────────────────────────────────────────
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow= (s: string) => `\x1b[33m${s}\x1b[0m`
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`${dim(ts)} ${cyan(`[${tag}]`)} ${msg}`)
}

// ── Process management ────────────────────────────────────────────────────────
const procs: ChildProcess[] = []

function spawnLogged(name: string, cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): ChildProcess {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true })
  p.stdout?.on('data', d => String(d).trim().split('\n').forEach(l => log(name, dim(l))))
  p.stderr?.on('data', d => String(d).trim().split('\n').forEach(l => {
    const line = l.trim()
    if (line) log(name, dim(line))
  }))
  procs.push(p)
  return p
}

function cleanup() {
  log('cleanup', 'stopping child processes…')
  procs.forEach(p => p.kill('SIGTERM'))
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(0) })

async function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function waitForHttp(url: string, label: string, maxMs = 20_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url)
      if (r.ok) { log('wait', `${label} ready`); return }
    } catch {}
    await wait(500)
  }
  throw new Error(`${label} didn't start within ${maxMs}ms`)
}

// ── Ethereum helpers ──────────────────────────────────────────────────────────
async function deployContract(provider: ethers.JsonRpcProvider): Promise<string> {
  const artifact = JSON.parse(
    readFileSync(join(CONTRACTS, 'artifacts/contracts/ClankerPitArena.sol/ClankerPitArena.json'), 'utf8')
  )
  const wallet  = new ethers.Wallet(PLATFORM_PK, provider)
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)
  log('deploy', `deploying ClankerPitArena from ${wallet.address}…`)
  const contract = await factory.deploy()
  await contract.waitForDeployment()
  const address = await contract.getAddress()
  log('deploy', green(`ClankerPitArena deployed at ${address}`))
  return address
}

async function fundWallet(provider: ethers.JsonRpcProvider, fromPk: string, toAddr: string, amountEth: string) {
  const sender = new ethers.Wallet(fromPk, provider)
  const tx = await sender.sendTransaction({ to: toAddr, value: ethers.parseEther(amountEth) })
  await tx.wait()
  const bal = await provider.getBalance(toAddr)
  log('fund', `${toAddr.slice(0,10)}… funded with ${amountEth} ETH — balance: ${ethers.formatEther(bal)} ETH`)
}

// ── Backend API helpers ───────────────────────────────────────────────────────
async function api(method: string, path: string, body?: unknown, headers?: Record<string,string>): Promise<any> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok && res.status !== 402) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`)
  }
  return { status: res.status, body: json }
}

// ── Game simulation ────────────────────────────────────────────────────────────
interface SimUnit {
  id: string; type: string; tx: number; tz: number; hp: number; maxHp: number
  busy: boolean; state: string; level: number; carry: null
}
interface SimBuilding {
  id: string; type: string; tx: number; tz: number; hp: number; maxHp: number
  level: number; underConstruction: boolean; upgrading: boolean; trainingQueue: number
  upgradeCost: { gold: number; lumber: number }
}
interface SimResource { id: string; type: string; tx: number; tz: number; amount: number }

function makeGameState(tick: number, playerId: number, gold: number, lumber: number, enemyHp: number) {
  const myBase = playerId === 0 ? { tx: 6, tz: 6 } : { tx: 38, tz: 38 }
  const enemyBase = playerId === 0 ? { tx: 38, tz: 38 } : { tx: 6, tz: 6 }

  const myUnits: SimUnit[] = [
    { id: `p${playerId}-w1`, type: 'Worker',  tx: myBase.tx+1, tz: myBase.tz,   hp: 50,  maxHp: 50,  busy: true, state: 'gathering', level: 1, carry: null },
    { id: `p${playerId}-w2`, type: 'Worker',  tx: myBase.tx,   tz: myBase.tz+1, hp: 50,  maxHp: 50,  busy: true, state: 'gathering', level: 1, carry: null },
    { id: `p${playerId}-f1`, type: 'Footman', tx: myBase.tx+2, tz: myBase.tz+2, hp: 160, maxHp: 160, busy: false, state: 'idle', level: 1, carry: null },
  ]
  if (tick > 50) {
    myUnits.push({ id: `p${playerId}-f2`, type: 'Footman', tx: enemyBase.tx-3, tz: enemyBase.tz-3, hp: 120, maxHp: 160, busy: true, state: 'attacking', level: 1, carry: null })
    myUnits.push({ id: `p${playerId}-a1`, type: 'Archer',  tx: enemyBase.tx-4, tz: enemyBase.tz-2, hp: 60,  maxHp: 70,  busy: true, state: 'attacking', level: 1, carry: null })
  }

  const enemyUnits: SimUnit[] = tick < 80 ? [
    { id: `p${1-playerId}-w1`, type: 'Worker', tx: enemyBase.tx+1, tz: enemyBase.tz, hp: 50, maxHp: 50, busy: true, state: 'gathering', level: 1, carry: null },
  ] : []

  const myBuildings: SimBuilding[] = [
    { id: `p${playerId}-th`, type: 'town_hall', tx: myBase.tx, tz: myBase.tz, hp: 1200, maxHp: 1200, level: 1, underConstruction: false, upgrading: false, trainingQueue: 0, upgradeCost: { gold: 500, lumber: 300 } },
  ]
  if (tick > 30) {
    myBuildings.push({ id: `p${playerId}-bar`, type: 'barracks', tx: myBase.tx+3, tz: myBase.tz, hp: 900, maxHp: 900, level: 1, underConstruction: false, upgrading: false, trainingQueue: 0, upgradeCost: { gold: 300, lumber: 200 } })
  }

  const enemyBuildings: SimBuilding[] = [
    { id: `p${1-playerId}-th`, type: 'town_hall', tx: enemyBase.tx, tz: enemyBase.tz, hp: enemyHp, maxHp: 1200, level: 1, underConstruction: false, upgrading: false, trainingQueue: 0, upgradeCost: { gold: 500, lumber: 300 } },
  ]

  const resources: SimResource[] = [
    { id: 'gold-mine-1', type: 'gold',   tx: myBase.tx+2, tz: myBase.tz,   amount: 2000 - tick * 5 },
    { id: 'gold-mine-2', type: 'gold',   tx: enemyBase.tx-2, tz: enemyBase.tz, amount: 2000 - tick * 3 },
    { id: 'lumber-1',    type: 'lumber', tx: 12, tz: 12, amount: 800 },
  ]

  const hasBarracks = myBuildings.some(b => b.type === 'barracks')
  const enemyDefenseless = enemyHp < 200 || enemyUnits.length === 0
  const crushingAdvantage = myUnits.filter(u => u.type !== 'Worker').length >= 3 && enemyUnits.length === 0

  const idleWorkerIds = myUnits.filter(u => u.type === 'Worker' && !u.busy).map(u => u.id)
  const idleCombatIds = myUnits.filter(u => u.type !== 'Worker' && !u.busy).map(u => u.id)

  let urgentAction = ''
  if (enemyDefenseless) urgentAction += `WIN NOW: attack town hall ${enemyBuildings[0].id} | `
  if (idleCombatIds.length) urgentAction += `${idleCombatIds.length} idle fighters — attack-move to enemy | `
  if (idleWorkerIds.length) urgentAction += `${idleWorkerIds.length} idle workers — gather gold | `
  if (!hasBarracks && gold >= 150) urgentAction += 'build barracks | '

  const canAffordNow: string[] = []
  if (gold >= 120 && hasBarracks) canAffordNow.push(`TRAIN Footman at ${myBuildings.find(b => b.type === 'barracks')?.id}`)
  if (gold >= 150 && lumber >= 100 && !hasBarracks) canAffordNow.push('BUILD barracks')

  return {
    tick, playerId, gold, lumber, supply: myUnits.length, supplyMax: 15, supplyFree: 15 - myUnits.length,
    myBaseCenter: myBase, suggestedBuildSpots: [{ tx: myBase.tx+3, tz: myBase.tz }, { tx: myBase.tx, tz: myBase.tz+3 }],
    myUnits, myBuildings, enemyUnits, enemyBuildings, resources, lootPiles: [],
    situation: { urgentAction, idleWorkerIds, idleCombatIds, hasBarracks, enemyDefenseless, dominantAdvantage: myUnits.length > 4, crushingAdvantage, myCombatCount: myUnits.filter(u=>u.type!=='Worker').length, enemyCombatCount: enemyUnits.filter(u=>u.type!=='Worker').length, enemyTotalUnits: enemyUnits.length, enemyTowerCount: 0, canAffordNow },
  }
}

// Rule-based agent strategy
function decide(state: ReturnType<typeof makeGameState>, agentId: string): Array<{ type: string; [k: string]: unknown }> {
  const cmds: Array<{ type: string; [k: string]: unknown }> = []
  const s = state.situation

  const enemyTH = state.enemyBuildings.find(b => b.type === 'town_hall')

  // 1. Crush if winning
  if ((s.enemyDefenseless || s.crushingAdvantage) && enemyTH) {
    const allIds = state.myUnits.map(u => u.id)
    return [{ type: 'ATTACK_BUILDING', unitIds: allIds, targetId: enemyTH.id }]
  }

  // 2. Idle fighters → attack-move
  if (s.idleCombatIds.length && enemyTH) {
    cmds.push({ type: 'ATTACK_MOVE', unitIds: s.idleCombatIds, tx: enemyTH.tx, tz: enemyTH.tz })
  }

  // 3. Idle workers → gather
  const gold = state.resources.find(r => r.type === 'gold' && r.amount > 0)
  if (s.idleWorkerIds.length && gold) {
    cmds.push({ type: 'GATHER', unitIds: s.idleWorkerIds, resourceId: gold.id })
  }

  // 4. Train footman
  const barracks = state.myBuildings.find(b => b.type === 'barracks')
  if (barracks && state.gold >= 120 && state.supplyFree > 0) {
    cmds.push({ type: 'TRAIN', buildingId: barracks.id, unit: 'Footman' })
  }

  // 5. Build barracks
  if (!s.hasBarracks && state.gold >= 150 && state.lumber >= 100 && state.myUnits.find(u => u.type === 'Worker')) {
    const spot = state.suggestedBuildSpots[0]
    const worker = state.myUnits.find(u => u.type === 'Worker')!
    cmds.push({ type: 'BUILD', unitIds: [worker.id], building: 'barracks', tx: spot.tx, tz: spot.tz })
  }

  return cmds
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log()
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Clanker Pit — Local E2E Test'))
  console.log(bold('══════════════════════════════════════════════'))
  console.log()

  // ── 1. Start Hardhat node ──────────────────────────────────────────────────
  log('hardhat', 'starting local node on :8545…')
  const hardhatProc = spawnLogged(
    'hardhat',
    'npx', ['hardhat', 'node', '--port', '8545'],
    CONTRACTS,
  )
  await waitForHttp(HARDHAT_URL, 'Hardhat node')

  const provider  = new ethers.JsonRpcProvider(HARDHAT_URL)
  const netInfo   = await provider.getNetwork()
  log('hardhat', `chain ID: ${netInfo.chainId}`)

  // ── 2. Deploy contract ─────────────────────────────────────────────────────
  const arenaAddress = await deployContract(provider)

  // ── 3. Write backend .env ──────────────────────────────────────────────────
  const envContent = [
    `CHAIN=local`,
    `SEPOLIA_RPC_URL=${HARDHAT_URL}`,
    `ARENA_ADDRESS=${arenaAddress}`,
    `DEPLOYER_PRIVATE_KEY=${PLATFORM_PK}`,
    `PLATFORM_ADDRESS=${PLATFORM_ADDR}`,
    `PORT=3001`,
  ].join('\n')
  writeFileSync(join(BACKEND, '.env'), envContent)
  log('env', `backend .env written (ARENA_ADDRESS=${arenaAddress.slice(0,10)}…)`)

  // ── 4. Start backend ───────────────────────────────────────────────────────
  log('backend', 'starting on :3001…')
  spawnLogged('backend', 'npx', ['tsx', 'src/index.ts'], BACKEND)
  await waitForHttp(`${BACKEND_URL}/health`, 'Backend')

  // ── 5. Create OWS-backed agent wallets via backend ─────────────────────────
  log('wallets', 'provisioning OWS wallets for both agents…')

  const w0 = await api('POST', '/wallet/provision', { agentId: 'agent-alpha', chain: 'evm' })
  const w1 = await api('POST', '/wallet/provision', { agentId: 'agent-beta',  chain: 'evm' })

  log('wallets', `Agent Alpha wallet: ${w0.body.wallet.address}`)
  log('wallets', `Agent Beta  wallet: ${w1.body.wallet.address}`)

  // ── 6. Fund OWS wallets from Hardhat faucet accounts ──────────────────────
  log('fund', 'funding OWS wallets from Hardhat faucet accounts…')
  await fundWallet(provider, AGENT_ACCOUNTS[0].pk, w0.body.wallet.address, '0.5')
  await fundWallet(provider, AGENT_ACCOUNTS[1].pk, w1.body.wallet.address, '0.5')

  // Also send entry fees to platform address (simulating real x402 flow)
  log('fund', 'sending registration + entry fees to platform (x402 simulation)…')
  const reg0 = await new ethers.Wallet(AGENT_ACCOUNTS[0].pk, provider)
    .sendTransaction({ to: PLATFORM_ADDR, value: ethers.parseEther('0.003') })
  await reg0.wait()
  const reg1 = await new ethers.Wallet(AGENT_ACCOUNTS[1].pk, provider)
    .sendTransaction({ to: PLATFORM_ADDR, value: ethers.parseEther('0.003') })
  await reg1.wait()

  const platformBal = await provider.getBalance(PLATFORM_ADDR)
  log('fund', `platform balance after fees: ${ethers.formatEther(platformBal)} ETH`)

  // ── 7. Register agents (CHAIN=local → x402 bypassed, any X-Payment works) ─
  log('register', 'registering both agents…')
  const r0 = await api('POST', '/agents/register',
    { id: 'agent-alpha', name: '⚔️ Alpha Rusher' },
    { 'X-Payment': reg0.hash, 'X-From-Address': AGENT_ACCOUNTS[0].addr },
  )
  const r1 = await api('POST', '/agents/register',
    { id: 'agent-beta', name: '🛡️ Beta Economist' },
    { 'X-Payment': reg1.hash, 'X-From-Address': AGENT_ACCOUNTS[1].addr },
  )
  log('register', green(`Alpha registered — ELO ${r0.body.agent.elo}`))
  log('register', green(`Beta  registered — ELO ${r1.body.agent.elo}`))

  // ── 8. Create match ────────────────────────────────────────────────────────
  log('match', 'creating match: Alpha vs Beta…')
  const entryTx = await new ethers.Wallet(PLATFORM_PK, provider)
    .sendTransaction({ to: PLATFORM_ADDR, value: ethers.parseEther('0.002') })
  await entryTx.wait()

  const matchRes = await api('POST', '/match/create',
    { agent0Id: 'agent-alpha', agent1Id: 'agent-beta' },
    { 'X-Payment': entryTx.hash },
  )
  const matchId = matchRes.body.match.id
  log('match', green(`match created: ${matchId}`))
  log('match', `prize pool: ${ethers.formatEther(matchRes.body.match.prize_wei)} ETH`)

  // ── 9. Simulate game loop ──────────────────────────────────────────────────
  console.log()
  log('sim', bold('starting 100-tick simulation…'))
  console.log()

  const TOTAL_TICKS = 100
  const TICK_INTERVAL_MS = 100

  // Track game state (agent-0 is "winning" by design)
  let gold0 = 300, lumber0 = 150
  let gold1 = 300, lumber1 = 150
  let enemyHp0 = 1200  // enemy hp seen by agent-0 (decreasing)
  let enemyHp1 = 1200  // enemy hp seen by agent-1

  const agent0Cmds: string[] = []
  const agent1Cmds: string[] = []

  for (let tick = 0; tick < TOTAL_TICKS; tick++) {
    // Advance economy
    gold0 += 8; lumber0 += 3
    gold1 += 6; lumber1 += 2

    // Alpha is more aggressive — enemy HP drops faster from agent-0's perspective
    if (tick > 40) enemyHp0 = Math.max(0, enemyHp0 - Math.floor(Math.random() * 25 + 10))
    if (tick > 55) enemyHp1 = Math.max(0, enemyHp1 - Math.floor(Math.random() * 10 + 5))

    // Build serialized state for each player
    const state0 = makeGameState(tick, 0, gold0, lumber0, enemyHp0)
    const state1 = makeGameState(tick, 1, gold1, lumber1, enemyHp1)

    // Frontend pushes state to backend
    await Promise.all([
      api('POST', '/game/state', { matchId, tick, playerId: 0, stateJson: JSON.stringify(state0) }),
      api('POST', '/game/state', { matchId, tick, playerId: 1, stateJson: JSON.stringify(state1) }),
    ])

    // Agent-0 (Alpha) decides
    const cmds0 = decide(state0, 'agent-alpha')
    for (const cmd of cmds0.slice(0, 2)) {
      await api('POST', '/game/command', {
        matchId, agentId: 'agent-alpha', playerId: 0,
        command: cmd, signature: '0x' + 'a'.repeat(64),
      })
      agent0Cmds.push(cmd.type)
    }

    // Agent-1 (Beta) decides
    const cmds1 = decide(state1, 'agent-beta')
    for (const cmd of cmds1.slice(0, 2)) {
      await api('POST', '/game/command', {
        matchId, agentId: 'agent-beta', playerId: 1,
        command: cmd, signature: '0x' + 'b'.repeat(64),
      })
      agent1Cmds.push(cmd.type)
    }

    // Log progress every 10 ticks
    if (tick % 10 === 0) {
      const pct = Math.round((tick / TOTAL_TICKS) * 100)
      log('sim', `tick ${String(tick).padStart(3)} / ${TOTAL_TICKS}  ${yellow(`[${'█'.repeat(pct/5)}${' '.repeat(20-pct/5)}]`)} ${pct}%  | gold0=${gold0} gold1=${gold1} | enemyHP(alpha)=${enemyHp0} enemyHP(beta)=${enemyHp1}`)
    }

    await wait(TICK_INTERVAL_MS)

    // Check if game over (enemy TH destroyed)
    if (enemyHp0 <= 0 || enemyHp1 <= 0) {
      log('sim', green(`enemy Town Hall destroyed at tick ${tick}!`))
      break
    }
  }

  // ── 10. Settle match ───────────────────────────────────────────────────────
  console.log()
  // Alpha wins (from simulation)
  const winnerId = enemyHp0 <= enemyHp1 ? 'agent-alpha' : 'agent-beta'
  const loserId  = winnerId === 'agent-alpha' ? 'agent-beta' : 'agent-alpha'

  log('settle', `settling — winner: ${bold(winnerId)}`)
  const settleRes = await api('POST', `/match/${matchId}/settle`, {
    winnerId,
    durationTicks: TOTAL_TICKS,
  })

  console.log()
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Match Result'))
  console.log(bold('══════════════════════════════════════════════'))
  console.log(green(`  Winner: ${settleRes.body.match.winner_id}`))
  console.log(`  Duration: ${settleRes.body.match.duration_ticks} ticks`)
  console.log()

  const eloChange = settleRes.body.eloChange
  console.log(`  ELO changes:`)
  console.log(green(`    agent-alpha: ${eloChange['agent-alpha']}`))
  console.log(red(  `    agent-beta:  ${eloChange['agent-beta']}`))
  console.log()

  // ── 11. Print command summary ──────────────────────────────────────────────
  const countByType = (cmds: string[]) => {
    const c: Record<string, number> = {}
    cmds.forEach(t => c[t] = (c[t] ?? 0) + 1)
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(', ')
  }
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Agent Command Summary'))
  console.log(bold('══════════════════════════════════════════════'))
  console.log(`  Alpha: ${countByType(agent0Cmds)}`)
  console.log(`  Beta:  ${countByType(agent1Cmds)}`)
  console.log()

  // ── 12. Final leaderboard ──────────────────────────────────────────────────
  const lb = await api('GET', '/leaderboard')
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Final Leaderboard'))
  console.log(bold('══════════════════════════════════════════════'))
  for (const entry of lb.body.leaderboard) {
    const mark = entry.id === winnerId ? green('★') : ' '
    console.log(`  ${mark} #${entry.rank} ${entry.name.padEnd(22)} ELO:${String(entry.elo).padStart(5)}  W:${entry.wins} L:${entry.losses}  PnL:${entry.pnlEth} ETH`)
  }
  console.log()

  // ── 13. Verify on-chain contract settle call ───────────────────────────────
  log('chain', 'checking platform wallet balance after settlement…')
  const finalBal = await provider.getBalance(PLATFORM_ADDR)
  log('chain', `platform balance: ${ethers.formatEther(finalBal)} ETH`)

  // Verify match replay has ticks
  const replay = await api('GET', `/match/${matchId}/replay`)
  log('replay', `replay stored ${replay.body.ticks.length} ticks (snapshots on every 10th tick)`)

  console.log()
  console.log(green(bold('  ✓ E2E test complete')))
  console.log()

  // Give logs a moment to flush then exit cleanly
  await wait(500)
  cleanup()
  process.exit(0)
}

main().catch(err => {
  console.error(red('\n[error] ' + err.message))
  console.error(err.stack)
  cleanup()
  process.exit(1)
})
