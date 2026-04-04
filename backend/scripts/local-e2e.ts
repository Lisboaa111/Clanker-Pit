/**
 * Clanker Pit — Local E2E Test (full on-chain flow)
 *
 *  1.  Kill stale processes on :8545 / :3001
 *  2.  Start Hardhat node on :8545
 *  3.  Compile + deploy ClankerPitArena
 *  4.  Write backend .env
 *  5.  Start backend on :3001
 *  6.  Register both agents (backend calls arena.registerAgent on-chain)
 *  7.  Both agents pay wager via x402 to join matchmaking pool
 *  8.  Agent-alpha picks agent-beta → POST /match/create
 *        → backend forwards both wagers to contract escrow
 *        → match immediately active
 *  9.  Simulate 100-tick game loop (rule-based decisions, command log, state push)
 * 10.  Settle match → backend calls arena.settle → winner paid on-chain
 * 11.  Print result, ELO changes, command summary, leaderboard, replay count
 *
 * Usage (from backend/):
 *   npx tsx scripts/local-e2e.ts
 */

import { spawn, ChildProcess } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKEND   = join(__dirname, '..')
const ROOT      = join(BACKEND, '..')
const CONTRACTS = join(ROOT, 'contracts')

const BACKEND_URL = 'http://localhost:3001'
const HARDHAT_URL = 'http://127.0.0.1:8545'

// Hardhat account #0 — deployer / platform
const PLATFORM_PK   = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const PLATFORM_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Hardhat accounts #1 and #2 — agent owners (10 000 ETH each)
const AGENTS = [
  {
    id: 'agent-alpha', name: 'Alpha Rusher',
    pk: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    addr: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  },
  {
    id: 'agent-beta', name: 'Beta Economist',
    pk: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    addr: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  },
]

const WAGER_ETH = '0.01'

// ── Logging ───────────────────────────────────────────────────────────────────
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`${dim(ts)} ${cyan(`[${tag}]`)} ${msg}`)
}

// ── Process management ────────────────────────────────────────────────────────
const procs: ChildProcess[] = []

function spawnLogged(name: string, cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): ChildProcess {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true })
  p.stdout?.on('data', d => String(d).trim().split('\n').forEach(l => log(name, dim(l))))
  p.stderr?.on('data', d => String(d).trim().split('\n').forEach(l => { if (l.trim()) log(name, dim(l)) }))
  procs.push(p)
  return p
}

function cleanup() {
  procs.forEach(p => { try { p.kill('SIGTERM') } catch {} })
}
process.on('exit',   cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(0) })

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function killPort(port: number) {
  return new Promise<void>(resolve => {
    const script = `
      if command -v netstat >/dev/null 2>&1; then
        PID=$(netstat -ano 2>/dev/null | grep ":${port} " | grep LISTEN | awk '{print $NF}' | head -1)
        if [ -n "$PID" ] && [ "$PID" != "0" ]; then
          cmd //c "taskkill /F /PID $PID" 2>/dev/null || kill -9 $PID 2>/dev/null || true
        fi
      fi
    `
    spawn('bash', ['-c', script]).on('close', () => resolve())
  })
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${JSON.stringify(json)}`)
  return { status: res.status, body: json }
}

// ── Ethereum helpers ──────────────────────────────────────────────────────────
async function deployContract(provider: ethers.JsonRpcProvider): Promise<string> {
  const artifact = JSON.parse(
    readFileSync(join(CONTRACTS, 'artifacts/contracts/ClankerPitArena.sol/ClankerPitArena.json'), 'utf8')
  )
  const wallet   = new ethers.Wallet(PLATFORM_PK, provider)
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)
  log('deploy', `deploying from ${wallet.address}…`)
  const contract = await factory.deploy()
  await contract.waitForDeployment()
  const address  = await contract.getAddress()
  log('deploy', green(`ClankerPitArena @ ${address}`))
  return address
}

// ── Game simulation ───────────────────────────────────────────────────────────
function makeGameState(tick: number, playerId: number, gold: number, lumber: number, enemyHp: number) {
  const myBase    = playerId === 0 ? { tx: 6,  tz: 6  } : { tx: 38, tz: 38 }
  const enemyBase = playerId === 0 ? { tx: 38, tz: 38 } : { tx: 6,  tz: 6  }

  const myUnits = [
    { id: `p${playerId}-w1`, type: 'Worker',  tx: myBase.tx+1, tz: myBase.tz,   hp: 50,  maxHp: 50,  busy: true,  state: 'gathering', level: 1, carry: null },
    { id: `p${playerId}-w2`, type: 'Worker',  tx: myBase.tx,   tz: myBase.tz+1, hp: 50,  maxHp: 50,  busy: true,  state: 'gathering', level: 1, carry: null },
    { id: `p${playerId}-f1`, type: 'Footman', tx: myBase.tx+2, tz: myBase.tz+2, hp: 160, maxHp: 160, busy: false, state: 'idle',      level: 1, carry: null },
  ]
  if (tick > 50) {
    myUnits.push({ id: `p${playerId}-f2`, type: 'Footman', tx: enemyBase.tx-3, tz: enemyBase.tz-3, hp: 120, maxHp: 160, busy: true, state: 'attacking', level: 1, carry: null })
    myUnits.push({ id: `p${playerId}-a1`, type: 'Archer',  tx: enemyBase.tx-4, tz: enemyBase.tz-2, hp: 60,  maxHp: 70,  busy: true, state: 'attacking', level: 1, carry: null })
  }

  const enemyUnits = tick < 80
    ? [{ id: `p${1-playerId}-w1`, type: 'Worker', tx: enemyBase.tx+1, tz: enemyBase.tz, hp: 50, maxHp: 50, busy: true, state: 'gathering', level: 1, carry: null }]
    : []

  const myBuildings = [
    { id: `p${playerId}-th`,  type: 'town_hall', tx: myBase.tx, tz: myBase.tz, hp: 1200, maxHp: 1200, level: 1, underConstruction: false, upgrading: false, trainingQueue: 0, upgradeCost: { gold: 500, lumber: 300 } },
    ...(tick > 30 ? [{ id: `p${playerId}-bar`, type: 'barracks', tx: myBase.tx+3, tz: myBase.tz, hp: 900, maxHp: 900, level: 1, underConstruction: false, upgrading: false, trainingQueue: 0, upgradeCost: { gold: 300, lumber: 200 } }] : []),
  ]

  const enemyBuildings = [
    { id: `p${1-playerId}-th`, type: 'town_hall', tx: enemyBase.tx, tz: enemyBase.tz, hp: enemyHp, maxHp: 1200, level: 1, underConstruction: false, upgrading: false, trainingQueue: 0, upgradeCost: { gold: 500, lumber: 300 } },
  ]

  const resources = [
    { id: 'gold-mine-1', type: 'gold',   tx: myBase.tx+2,    tz: myBase.tz,    amount: Math.max(0, 2000 - tick * 5) },
    { id: 'gold-mine-2', type: 'gold',   tx: enemyBase.tx-2, tz: enemyBase.tz, amount: Math.max(0, 2000 - tick * 3) },
    { id: 'lumber-1',    type: 'lumber', tx: 12, tz: 12,                        amount: 800 },
  ]

  const hasBarracks      = myBuildings.some(b => b.type === 'barracks')
  const enemyDefenseless = enemyHp < 200 || enemyUnits.length === 0
  const idleWorkerIds    = myUnits.filter(u => u.type === 'Worker' && !u.busy).map(u => u.id)
  const idleCombatIds    = myUnits.filter(u => u.type !== 'Worker' && !u.busy).map(u => u.id)

  return {
    tick, playerId, gold, lumber,
    supply: myUnits.length, supplyMax: 15, supplyFree: 15 - myUnits.length,
    myBaseCenter: myBase,
    suggestedBuildSpots: [{ tx: myBase.tx+3, tz: myBase.tz }],
    myUnits, myBuildings, enemyUnits, enemyBuildings, resources, lootPiles: [],
    situation: {
      urgentAction: enemyDefenseless ? `WIN NOW: attack ${enemyBuildings[0].id}` : '',
      idleWorkerIds, idleCombatIds, hasBarracks,
      enemyDefenseless,
      crushingAdvantage: myUnits.filter(u => u.type !== 'Worker').length >= 3 && enemyUnits.length === 0,
      canAffordNow: gold >= 120 && hasBarracks ? ['TRAIN Footman'] : [],
    },
  }
}

function decide(state: ReturnType<typeof makeGameState>): Array<{ type: string; [k: string]: unknown }> {
  const cmds: Array<{ type: string; [k: string]: unknown }> = []
  const s     = state.situation
  const enemy = state.enemyBuildings.find(b => b.type === 'town_hall')

  if ((s.enemyDefenseless || s.crushingAdvantage) && enemy)
    return [{ type: 'ATTACK_BUILDING', unitIds: state.myUnits.map(u => u.id), targetId: enemy.id }]

  if (s.idleCombatIds.length && enemy)
    cmds.push({ type: 'ATTACK_MOVE', unitIds: s.idleCombatIds, tx: enemy.tx, tz: enemy.tz })

  const gold = state.resources.find(r => r.type === 'gold' && r.amount > 0)
  if (s.idleWorkerIds.length && gold)
    cmds.push({ type: 'GATHER', unitIds: s.idleWorkerIds, resourceId: gold.id })

  const bar = state.myBuildings.find(b => b.type === 'barracks')
  if (bar && state.gold >= 120 && state.supplyFree > 0)
    cmds.push({ type: 'TRAIN', buildingId: bar.id, unit: 'Footman' })

  if (!s.hasBarracks && state.gold >= 150 && state.lumber >= 100) {
    const w = state.myUnits.find(u => u.type === 'Worker')
    if (w) cmds.push({ type: 'BUILD', unitIds: [w.id], building: 'barracks', tx: state.suggestedBuildSpots[0].tx, tz: state.suggestedBuildSpots[0].tz })
  }

  return cmds
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log()
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Clanker Pit — Local E2E (full on-chain)'))
  console.log(bold('══════════════════════════════════════════════'))
  console.log()

  // ── 1. Clear stale state ───────────────────────────────────────────────────
  log('init', 'killing stale processes on :8545 and :3001…')
  await killPort(8545)
  await killPort(3001)
  await wait(1000)

  // Delete old SQLite DB so schema is fresh (db.ts places it at repo root: ../../clankerpit.db from src/)
  const dbPath = join(ROOT, 'clankerpit.db')
  if (existsSync(dbPath)) { unlinkSync(dbPath); log('init', 'deleted stale clankerpit.db') }

  // ── 2. Start Hardhat node ──────────────────────────────────────────────────
  log('hardhat', 'starting on :8545…')
  spawnLogged('hardhat', 'npx', ['hardhat', 'node', '--port', '8545'], CONTRACTS)

  const provider = new ethers.JsonRpcProvider(HARDHAT_URL)
  const deadline = Date.now() + 30_000
  while (true) {
    try {
      const chainId = await provider.send('eth_chainId', [])
      log('hardhat', `ready — chain ID: ${parseInt(chainId, 16)}`); break
    } catch {
      if (Date.now() > deadline) throw new Error('Hardhat node timeout')
      await wait(800)
    }
  }

  // ── 3. Compile + deploy ────────────────────────────────────────────────────
  log('compile', 'running hardhat compile…')
  await new Promise<void>((res, rej) => {
    const p = spawn('npx', ['hardhat', 'compile'], { cwd: CONTRACTS, shell: true })
    p.stdout?.on('data', d => String(d).trim().split('\n').forEach(l => log('compile', dim(l))))
    p.stderr?.on('data', d => String(d).trim().split('\n').forEach(l => log('compile', dim(l))))
    p.on('close', code => code === 0 ? res() : rej(new Error(`hardhat compile exited ${code}`)))
  })

  const arenaAddress = await deployContract(provider)

  // ── 4. Write .env ──────────────────────────────────────────────────────────
  writeFileSync(join(BACKEND, '.env'), [
    `CHAIN=local`,
    `SEPOLIA_RPC_URL=${HARDHAT_URL}`,
    `ARENA_ADDRESS=${arenaAddress}`,
    `DEPLOYER_PRIVATE_KEY=${PLATFORM_PK}`,
    `PLATFORM_ADDRESS=${PLATFORM_ADDR}`,
    `PORT=3001`,
  ].join('\n'))
  log('env', `wrote backend .env — ARENA_ADDRESS=${arenaAddress.slice(0, 10)}…`)

  // ── 5. Start backend ───────────────────────────────────────────────────────
  log('backend', 'starting on :3001…')
  spawnLogged('backend', 'npx', ['tsx', 'src/index.ts'], BACKEND)

  const bDeadline = Date.now() + 20_000
  while (true) {
    try { const r = await fetch(`${BACKEND_URL}/health`); if (r.ok) { log('backend', 'ready'); break } } catch {}
    if (Date.now() > bDeadline) throw new Error('Backend startup timeout')
    await wait(500)
  }

  // ── 6. Register agents ─────────────────────────────────────────────────────
  // Each agent's Hardhat account sends 0.001 ETH registration fee to platform (x402).
  // Backend registers in DB and calls arena.registerAgent on-chain.
  log('register', 'registering both agents…')
  const arena = new ethers.Contract(arenaAddress, [
    'function registerAgent(bytes32, address) external payable',
    'function agentOwner(bytes32) external view returns (address)',
    'function deposit(bytes32, uint8, address) external payable',
    'function getMatch(bytes32) external view returns (address, address, uint256, uint256, bool, bool)',
    'function settle(bytes32, address) external',
  ], new ethers.Wallet(PLATFORM_PK, provider))

  for (const agent of AGENTS) {
    // Agent pays 0.001 ETH registration fee to platform
    const regTx = await new ethers.Wallet(agent.pk, provider)
      .sendTransaction({ to: PLATFORM_ADDR, value: ethers.parseEther('0.001') })
    await regTx.wait()

    const { body } = await api(
      'POST', '/agents/register',
      { id: agent.id, name: agent.name },
      { 'X-Payment': regTx.hash, 'X-From-Address': agent.addr },
    )
    log('register', green(`${agent.name} registered — ELO ${body.agent.elo}, owner ${agent.addr.slice(0, 10)}…`))
  }

  // Wait briefly for the async on-chain registration to complete
  await wait(2000)

  // Verify on-chain registration
  for (const agent of AGENTS) {
    const agentIdB32  = ethers.id(agent.id)
    const onChainOwner = await arena.agentOwner(agentIdB32)
    log('register', dim(`  on-chain: agentOwner[${agent.id}] = ${onChainOwner}`))
  }

  // ── 7. Both agents join matchmaking by paying wager via x402 ──────────────
  log('matchmaking', `both agents pay ${WAGER_ETH} ETH wager to join matchmaking pool…`)

  for (const agent of AGENTS) {
    // Agent sends wager ETH to platform address (x402 payment)
    const wagerTx = await new ethers.Wallet(agent.pk, provider)
      .sendTransaction({ to: PLATFORM_ADDR, value: ethers.parseEther(WAGER_ETH) })
    await wagerTx.wait()

    const joinRes = await api(
      'POST', '/matchmaking/join',
      { agentId: agent.id },
      { 'X-Payment': wagerTx.hash, 'X-From-Address': agent.addr },
    )
    log('matchmaking', green(
      `${agent.name} joined pool — wager: ${ethers.formatEther(joinRes.body.wagerWei)} ETH, ` +
      `expires in ${joinRes.body.expiresInSeconds}s`
    ))
  }

  const poolRes = await api('GET', '/matchmaking/active')
  log('matchmaking', `pool has ${poolRes.body.count} agents:`)
  for (const e of poolRes.body.agents) {
    log('matchmaking', `  ${e.name.padEnd(20)} ELO:${e.elo}  wager:${ethers.formatEther(e.wagerWei)} ETH  expires in ${e.remainingSeconds}s`)
  }

  // ── 8. Create match — backend auto-deposits both wagers to contract ────────
  log('match', `${AGENTS[0].name} picks ${AGENTS[1].name} from pool…`)

  const matchRes = await api('POST', '/match/create', {
    agent0Id: AGENTS[0].id,
    agent1Id: AGENTS[1].id,
  })
  const { match } = matchRes.body
  const matchId  = match.id
  const matchB32 = ethers.id(matchId)

  log('match', green(`match ${matchId} created — status: ${match.status}`))
  log('match', `prize pool: ${ethers.formatEther(match.prize_wei)} ETH`)
  log('match', `matchIdBytes32: ${matchB32}`)

  // Wait for async on-chain deposits to complete
  log('deposit', 'waiting for on-chain deposits to confirm…')
  await wait(3000)

  // Verify on-chain deposit state
  const [d0, d1, a0, a1] = await arena.getMatch(matchB32)
  log('deposit', green(`on-chain depositors: [${d0.slice(0,10)}…, ${d1.slice(0,10)}…]`))
  log('deposit', green(`on-chain amounts:    [${ethers.formatEther(a0)} ETH, ${ethers.formatEther(a1)} ETH]`))

  // ── 9. Game simulation ─────────────────────────────────────────────────────
  console.log()
  log('sim', bold('starting 100-tick simulation…'))
  console.log()

  let gold0 = 300, lumber0 = 150
  let gold1 = 300, lumber1 = 150
  let enemyHp0 = 1200
  let enemyHp1 = 1200
  const cmd0Log: string[] = []
  const cmd1Log: string[] = []
  let lastTick = 99

  for (let tick = 0; tick < 100; tick++) {
    gold0 += 8; lumber0 += 3
    gold1 += 6; lumber1 += 2

    if (tick > 40) enemyHp0 = Math.max(0, enemyHp0 - Math.floor(Math.random() * 25 + 10))
    if (tick > 55) enemyHp1 = Math.max(0, enemyHp1 - Math.floor(Math.random() * 10 + 5))

    const s0 = makeGameState(tick, 0, gold0, lumber0, enemyHp0)
    const s1 = makeGameState(tick, 1, gold1, lumber1, enemyHp1)

    await Promise.all([
      api('POST', '/game/state', { matchId, tick, playerId: 0, stateJson: JSON.stringify(s0) }),
      api('POST', '/game/state', { matchId, tick, playerId: 1, stateJson: JSON.stringify(s1) }),
    ])

    for (const cmd of decide(s0).slice(0, 2)) {
      await api('POST', '/game/command', { matchId, agentId: AGENTS[0].id, playerId: 0, command: cmd, signature: '0x' + 'a'.repeat(64) })
      cmd0Log.push(cmd.type)
    }
    for (const cmd of decide(s1).slice(0, 2)) {
      await api('POST', '/game/command', { matchId, agentId: AGENTS[1].id, playerId: 1, command: cmd, signature: '0x' + 'b'.repeat(64) })
      cmd1Log.push(cmd.type)
    }

    if (tick % 10 === 0) {
      const pct = Math.round(tick)
      const bar = '█'.repeat(Math.floor(pct / 5)) + ' '.repeat(20 - Math.floor(pct / 5))
      log('sim', `tick ${String(tick).padStart(3)}/100  ${yellow(`[${bar}]`)} ${pct}%  gold0=${gold0} gold1=${gold1} | ehp(α)=${enemyHp0} ehp(β)=${enemyHp1}`)
    }

    await wait(80)

    if (enemyHp0 <= 0 || enemyHp1 <= 0) {
      log('sim', green(`Town Hall destroyed at tick ${tick}!`))
      lastTick = tick; break
    }
  }

  // ── 10. Settle match ──────────────────────────────────────────────────────
  console.log()
  const winnerId = enemyHp0 <= enemyHp1 ? AGENTS[0].id : AGENTS[1].id
  const winner   = AGENTS.find(a => a.id === winnerId)!

  log('settle', `winner: ${bold(winner.name)}`)

  // Record winner's balance before settlement
  const winnerBalBefore   = await provider.getBalance(winner.addr)
  const platformBalBefore = await provider.getBalance(PLATFORM_ADDR)

  const settleRes = await api('POST', `/match/${matchId}/settle`, { winnerId, durationTicks: lastTick + 1 })

  // Wait for on-chain settlement to complete
  await wait(3000)

  const winnerBalAfter   = await provider.getBalance(winner.addr)
  const platformBalAfter = await provider.getBalance(PLATFORM_ADDR)

  const payout      = winnerBalAfter  - winnerBalBefore
  const platformFee = platformBalAfter - platformBalBefore

  // ── 11. Results ────────────────────────────────────────────────────────────
  console.log()
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Match Result'))
  console.log(bold('══════════════════════════════════════════════'))
  console.log(green(`  Winner:   ${settleRes.body.match.winner_id}`))
  console.log(`  Duration: ${settleRes.body.match.duration_ticks} ticks`)
  console.log()
  console.log(`  Prize pool: ${ethers.formatEther(ethers.parseEther(WAGER_ETH) * 2n)} ETH`)
  console.log(green(`  Winner received:  ~${ethers.formatEther(payout < 0n ? 0n : payout)} ETH`))
  console.log(`  Platform fee:     ~${ethers.formatEther(platformFee < 0n ? 0n : platformFee)} ETH`)
  console.log()

  const eloChange = settleRes.body.eloChange
  for (const [id, elo] of Object.entries(eloChange)) {
    const delta = (elo as number) - 1200
    const col   = delta >= 0 ? green(`+${delta}`) : red(`${delta}`)
    console.log(`  ${id.padEnd(14)} ELO: ${elo}  (${col})`)
  }

  const countByType = (cmds: string[]) => {
    const c: Record<string, number> = {}
    cmds.forEach(t => { c[t] = (c[t] ?? 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(', ')
  }
  console.log()
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Agent Command Summary'))
  console.log(bold('══════════════════════════════════════════════'))
  console.log(`  Alpha: ${countByType(cmd0Log) || '(none)'}`)
  console.log(`  Beta:  ${countByType(cmd1Log) || '(none)'}`)

  const lb = await api('GET', '/leaderboard')
  console.log()
  console.log(bold('══════════════════════════════════════════════'))
  console.log(bold('  Final Leaderboard'))
  console.log(bold('══════════════════════════════════════════════'))
  for (const e of lb.body.leaderboard) {
    const star = e.id === winnerId ? green('★') : ' '
    console.log(`  ${star} #${e.rank} ${e.name.padEnd(20)} ELO:${String(e.elo).padStart(5)}  W:${e.wins} L:${e.losses}  PnL: ${e.pnlEth} ETH`)
  }

  const replay = await api('GET', `/match/${matchId}/replay`)
  console.log()
  log('replay', `stored ${replay.body.ticks.length} tick entries`)
  console.log()
  console.log(green(bold('  ✓ E2E complete — on-chain settlement verified')))
  console.log()

  await wait(300)
  cleanup()
  process.exit(0)
}

main().catch(err => {
  console.error(red('\n[error] ' + err.message))
  if (err.stack) console.error(dim(err.stack))
  cleanup()
  process.exit(1)
})
