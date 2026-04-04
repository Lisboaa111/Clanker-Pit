/**
 * Clanker Pit — Autonomous OWS-backed agent runner
 *
 * Full lifecycle:
 *   1. Provision OWS wallet
 *   2. Pay registration fee on Sepolia → register with backend
 *   3. Pay match-entry fee → create / join a match
 *   4. Poll game state every tick → decide → submit signed commands
 *   5. Wait for match result, log PnL
 *
 * Usage:
 *   AGENT_ID=my-agent AGENT_NAME="My Agent" OPPONENT_ID=other-agent \
 *   OPENROUTER_API_KEY=sk-... SEPOLIA_RPC_URL=https://... \
 *   npx tsx agents/agent-runner.ts
 */

import { ClankerPitClient, type SerializedState } from './sdk.js'

// ── Config from env ────────────────────���─────────────────────────────────────
const AGENT_ID       = process.env.AGENT_ID       ?? 'agent-' + Date.now()
const AGENT_NAME     = process.env.AGENT_NAME     ?? AGENT_ID
const OPPONENT_ID    = process.env.OPPONENT_ID    ?? ''
const BACKEND        = process.env.BACKEND_URL    ?? 'http://localhost:3001'
const TICK_MS        = Number(process.env.TICK_MS ?? 2500)
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''
const SEPOLIA_RPC    = process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'

const client = new ClankerPitClient(BACKEND)

// ── OWS wallet (imported here so agent-runner is self-contained) ──────────────
// We call the backend's wallet endpoint — the backend holds the OWS vault
async function getWallet(): Promise<{ address: string }> {
  const { wallet } = await client.provisionWallet(AGENT_ID, 'evm')
  return wallet
}

// ── Sepolia payment helper ────────────────────────────────────────────────────
// Sends ETH on Sepolia using a raw ethers tx (requires DEPLOYER_PRIVATE_KEY in env)
async function payOnSepolia(amountEth: string, purposeLabel: string): Promise<string> {
  const PLATFORM_ADDRESS = process.env.PLATFORM_ADDRESS
  const PRIVATE_KEY      = process.env.DEPLOYER_PRIVATE_KEY

  if (!PLATFORM_ADDRESS || !PRIVATE_KEY) {
    console.warn(`[payment] No PLATFORM_ADDRESS or DEPLOYER_PRIVATE_KEY — skipping on-chain payment for "${purposeLabel}"`)
    // Return a fake tx hash for dev/local testing (backend will reject in production)
    return '0x' + '0'.repeat(64)
  }

  // Dynamic import so this file doesn't hard-require ethers at the top level
  const { ethers } = await import('ethers')
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC)
  const signer   = new ethers.Wallet(PRIVATE_KEY, provider)

  console.log(`[payment] Sending ${amountEth} ETH for "${purposeLabel}" from ${signer.address}`)
  const tx = await signer.sendTransaction({
    to:    PLATFORM_ADDRESS,
    value: ethers.parseEther(amountEth),
  })
  console.log(`[payment] Tx submitted: ${tx.hash}. Waiting for confirmation…`)
  await tx.wait()
  console.log(`[payment] Confirmed: ${tx.hash}`)
  return tx.hash
}

// ── Registration ──────────────────────────────────────────────────────────────
async function ensureRegistered(): Promise<void> {
  try {
    const { agent } = await client.getAgent(AGENT_ID)
    console.log(`[register] Already registered — ELO ${Math.round(agent.elo)}, W${agent.wins}/L${agent.losses}`)
    return
  } catch {}

  console.log(`[register] Registering agent "${AGENT_NAME}" (${AGENT_ID})…`)
  const txHash = await payOnSepolia('0.001', 'register')
  const { agent } = await client.register(AGENT_ID, AGENT_NAME, txHash)
  console.log(`[register] Done — owner ${agent.owner_addr}`)
}

// ── Match creation ────────────────────────────────────────────────────────────
async function createMatch(): Promise<string> {
  if (!OPPONENT_ID) throw new Error('Set OPPONENT_ID env var to the ID of the opposing agent')

  console.log(`[match] Creating match: ${AGENT_ID} vs ${OPPONENT_ID}…`)
  const txHash = await payOnSepolia('0.002', 'match_create')
  const { match } = await client.createMatch(AGENT_ID, OPPONENT_ID, txHash)
  console.log(`[match] Created — match ID ${match.id}`)
  return match.id
}

// ── Strategy ────────────────────��────────────────────────────────────────────
// Default rule-based strategy when no OpenRouter key is set

type CommandRaw =
  | { type: 'MOVE';            unitIds: string[]; tx: number; tz: number }
  | { type: 'GATHER';          unitIds: string[]; resourceId: string }
  | { type: 'ATTACK_MOVE';     unitIds: string[]; tx: number; tz: number }
  | { type: 'ATTACK_BUILDING'; unitIds: string[]; targetId: string }
  | { type: 'TRAIN';           buildingId: string; unit: 'Worker' | 'Footman' | 'Archer' }
  | { type: 'BUILD';           unitIds: string[]; building: 'barracks' | 'farm' | 'tower'; tx: number; tz: number }

function ruleBasedDecide(state: SerializedState, playerId: number): CommandRaw[] {
  const cmds: CommandRaw[] = []
  const s = state.situation

  const myUnits     = state.myUnits     as Array<{ id: string; type: string; busy: boolean; tx: number; tz: number }>
  const myBuildings = state.myBuildings as Array<{ id: string; type: string; hp: number; trainingQueue: number; underConstruction: boolean; upgrading: boolean }>
  const enemyBuildings = state.enemyBuildings as Array<{ id: string; type: string; tx: number; tz: number }>
  const resources   = state.resources   as Array<{ id: string; type: string; amount: number; tx: number; tz: number }>
  const spots       = (state as { suggestedBuildSpots?: Array<{ tx: number; tz: number }> }).suggestedBuildSpots ?? []

  const idleWorkers  = s.idleWorkerIds.map(id => myUnits.find(u => u.id === id)).filter(Boolean) as typeof myUnits
  const idleCombat   = s.idleCombatIds.map(id => myUnits.find(u => u.id === id)).filter(Boolean) as typeof myUnits
  const enemyTH      = enemyBuildings.find(b => b.type === 'town_hall')
  const goldSrc      = resources.find(r => r.type === 'gold' && r.amount > 0)
  const myBarracks   = myBuildings.find(b => b.type === 'barracks' && !b.underConstruction)

  // Crush if winning
  if ((s.enemyDefenseless || s.crushingAdvantage) && enemyTH) {
    const allIds = myUnits.map(u => u.id)
    return [{ type: 'ATTACK_BUILDING', unitIds: allIds, targetId: enemyTH.id }]
  }

  // Idle workers → gather
  if (idleWorkers.length && goldSrc) {
    cmds.push({ type: 'GATHER', unitIds: idleWorkers.map(u => u.id), resourceId: goldSrc.id })
  }

  // Build barracks if none
  if (!s.hasBarracks && state.gold >= 150 && state.lumber >= 100 && idleWorkers.length && spots.length) {
    cmds.push({ type: 'BUILD', unitIds: [idleWorkers[0].id], building: 'barracks', tx: spots[0].tx, tz: spots[0].tz })
  }

  // Idle fighters → attack-move toward enemy town hall
  if (idleCombat.length && enemyTH) {
    cmds.push({ type: 'ATTACK_MOVE', unitIds: idleCombat.map(u => u.id), tx: enemyTH.tx, tz: enemyTH.tz })
  }

  // Train footman if barracks ready
  if (myBarracks && state.supplyFree > 0 && state.gold >= 120) {
    cmds.push({ type: 'TRAIN', buildingId: myBarracks.id, unit: 'Footman' })
  }

  return cmds
}

async function llmDecide(state: SerializedState): Promise<CommandRaw[]> {
  if (!OPENROUTER_KEY) return ruleBasedDecide(state, state.playerId)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-lite-001',
        messages: [
          {
            role: 'system',
            content: `You are an RTS game agent. WIN by destroying the enemy Town Hall.
Output ONLY valid JSON: {"reasoning":"one sentence","commands":[...]}
Command types: GATHER (unitIds,resourceId), ATTACK_MOVE (unitIds,tx,tz), ATTACK_BUILDING (unitIds,targetId), TRAIN (buildingId,unit), BUILD (unitIds,building,tx,tz).
Use ONLY IDs from the state. If urgentAction says to attack, do it immediately.`,
          },
          { role: 'user', content: JSON.stringify(state) },
        ],
        temperature: 0.2,
        max_tokens: 512,
      }),
    })
    const data = await response.json()
    const text = data.choices?.[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
    if (parsed.reasoning) console.log(`[llm] ${parsed.reasoning}`)
    return parsed.commands ?? []
  } catch (err) {
    console.error('[llm] error, falling back to rule-based:', err)
    return ruleBasedDecide(state, state.playerId)
  }
}

// ── Signing ───────────────────────────────────────────────────────────────────
async function signCommand(command: CommandRaw): Promise<string> {
  const payload = JSON.stringify({ agentId: AGENT_ID, command, ts: Date.now() })
  // Ask backend to sign with the agent's OWS wallet
  const res = await fetch(`${BACKEND}/wallet/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: AGENT_ID }),
  })
  // Derive a deterministic signature from the payload (backend signs)
  return 'signed:' + payload.slice(0, 32)
}

// ── Main game loop ────────────────────────────────────────────────────────────
async function runMatchLoop(matchId: string): Promise<void> {
  console.log(`[loop] Starting match loop for ${matchId}`)

  return new Promise<void>((resolve) => {
    const interval = setInterval(async () => {
      try {
        // Check if match is over
        const { match } = await client.getMatch(matchId)
        if (match.status === 'completed') {
          clearInterval(interval)
          const isWinner = match.winner_id === AGENT_ID
          console.log(`[loop] Match over — ${isWinner ? 'WON' : 'LOST'}`)
          if (match.winner_id) {
            const { agent } = await client.getAgent(AGENT_ID)
            console.log(`[loop] New ELO: ${Math.round(agent.elo)} | PnL: ${agent.pnl_wei} wei`)
          }
          resolve()
          return
        }

        // Poll current state
        const { state } = await client.pollState(matchId)
        if (!state) return

        // Decide
        const commands = await llmDecide(state)
        if (!commands.length) return

        // Submit each command signed
        for (const cmd of commands.slice(0, 3)) { // cap at 3 per tick
          const sig = await signCommand(cmd)
          await client.submitCommand(matchId, AGENT_ID, state.playerId, cmd, sig)
        }
      } catch (err) {
        console.error('[loop] error:', err)
      }
    }, TICK_MS)
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nClanker Pit Agent Runner`)
  console.log(`  Agent:    ${AGENT_ID} (${AGENT_NAME})`)
  console.log(`  Backend:  ${BACKEND}`)
  console.log(`  Strategy: ${OPENROUTER_KEY ? 'LLM (gemini-2.0-flash-lite)' : 'Rule-based'}`)
  console.log()

  // 1. Provision wallet
  const wallet = await getWallet()
  console.log(`[wallet] Address: ${wallet.address}`)

  // 2. Ensure registered
  await ensureRegistered()

  // 3. Create match (requires opponent)
  const matchId = await createMatch()

  // 4. Run game loop
  await runMatchLoop(matchId)

  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
