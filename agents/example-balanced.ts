/**
 * Clanker Pit — Example: Balanced agent
 *
 * Demonstrates the full loop:
 *   1. Provision a wallet
 *   2. Poll game state
 *   3. Decide commands with a simple rule-based strategy
 *   4. Submit signed skill orders via the SDK
 *
 * Run:
 *   npx tsx agents/example-balanced.ts
 */
import { ClankerPitClient } from './sdk.js'

const AGENT_ID   = 'example-balanced'
const BACKEND    = 'http://localhost:3001'
const TICK_MS    = 2500

// ---------------------------------------------------------------------------
// Minimal game-state type (mirrors what the arena serializer emits)
// ---------------------------------------------------------------------------
interface Vec2 { x: number; z: number }

interface UnitState {
  id: string
  type: 'worker' | 'footman' | 'archer'
  x: number
  z: number
  hp: number
  maxHp: number
  busy: boolean
}

interface BuildingState {
  id: string
  type: 'town_hall' | 'barracks' | 'farm' | 'tower'
  x: number
  z: number
  hp: number
  maxHp: number
}

interface ResourceState {
  id: string
  type: 'gold' | 'lumber'
  x: number
  z: number
  amount: number
}

interface GameState {
  tick: number
  myPlayerId: number
  gold: number
  lumber: number
  supply: number
  supplyMax: number
  myUnits: UnitState[]
  myBuildings: BuildingState[]
  enemyBuildings: BuildingState[]
  resources: ResourceState[]
  suggestedBuildSpots: Vec2[]
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------
function decide(state: GameState): Array<{ skill: string; args: Record<string, unknown> }> {
  const cmds: Array<{ skill: string; args: Record<string, unknown> }> = []

  const idleWorkers  = state.myUnits.filter(u => u.type === 'worker'  && !u.busy)
  const idleFighters = state.myUnits.filter(u => u.type !== 'worker'  && !u.busy)
  const goldSources  = state.resources.filter(r => r.type === 'gold' && r.amount > 0)
  const enemyTH      = state.enemyBuildings.find(b => b.type === 'town_hall')
  const myBarracks   = state.myBuildings.find(b => b.type === 'barracks')
  const myTH         = state.myBuildings.find(b => b.type === 'town_hall')

  // 1. Idle workers → gather gold
  if (idleWorkers.length && goldSources.length) {
    const target = goldSources[0]
    cmds.push({
      skill: 'gather',
      args: { unitIds: idleWorkers.map(u => u.id), x: target.x, z: target.z },
    })
  }

  // 2. Build barracks if we have none and can afford it
  if (!myBarracks && state.gold >= 150 && state.lumber >= 100 && idleWorkers.length) {
    const spot = state.suggestedBuildSpots[0]
    if (spot) {
      cmds.push({
        skill: 'build',
        args: {
          unitIds: [idleWorkers[0].id],
          buildingType: 'barracks',
          x: spot.x,
          z: spot.z,
        },
      })
    }
  }

  // 3. Idle fighters → attack-move toward enemy Town Hall
  if (idleFighters.length && enemyTH) {
    cmds.push({
      skill: 'attack',
      args: { unitIds: idleFighters.map(u => u.id), x: enemyTH.x, z: enemyTH.z },
    })
  }

  // 4. Send workers to attack if enemy is defenceless
  if (enemyTH && state.myUnits.length >= 6 && !enemyTH) {
    const allIds = state.myUnits.map(u => u.id)
    cmds.push({ skill: 'attack', args: { unitIds: allIds, x: enemyTH!.x, z: enemyTH!.z } })
  }

  return cmds
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function fetchGameState(): Promise<GameState | null> {
  try {
    const res = await fetch('http://localhost:5173/api/game-state')
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function main() {
  const client = new ClankerPitClient(BACKEND)

  const { wallet } = await client.provisionWallet(AGENT_ID, 'evm')
  console.log(`Wallet provisioned: ${wallet.walletName} (${wallet.chain})`)

  setInterval(async () => {
    const state = await fetchGameState()
    if (!state) return

    const cmds = decide(state)
    for (const cmd of cmds) {
      try {
        switch (cmd.skill) {
          case 'move':    await client.moveUnits({ agentId: AGENT_ID, ...(cmd.args as Parameters<typeof client.moveUnits>[0]) }); break
          case 'attack':  await client.attack({ agentId: AGENT_ID, ...(cmd.args as Parameters<typeof client.attack>[0]) }); break
          case 'gather':  await client.gather({ agentId: AGENT_ID, ...(cmd.args as Parameters<typeof client.gather>[0]) }); break
          case 'build':   await client.build({ agentId: AGENT_ID, ...(cmd.args as Parameters<typeof client.build>[0]) }); break
        }
      } catch (err) {
        console.error(`Skill ${cmd.skill} failed:`, err)
      }
    }
  }, TICK_MS)
}

main().catch(console.error)
