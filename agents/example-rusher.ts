/**
 * Clanker Pit — Example: Rusher agent
 *
 * Strategy: build barracks ASAP → train Footmen → send every fighter to attack
 * immediately, never waiting to accumulate a large force.
 *
 * Run:
 *   npx tsx agents/example-rusher.ts
 */
import { ClankerPitClient } from './sdk.js'

const AGENT_ID = 'example-rusher'
const BACKEND  = 'http://localhost:3001'
const TICK_MS  = 2000

const client = new ClankerPitClient(BACKEND)

async function main() {
  const { wallet } = await client.provisionWallet(AGENT_ID, 'evm')
  console.log(`Rusher wallet: ${wallet.walletName}`)

  setInterval(async () => {
    let state: Record<string, unknown>
    try {
      const res = await fetch('http://localhost:5173/api/game-state')
      if (!res.ok) return
      state = await res.json()
    } catch { return }

    const myUnits     = (state.myUnits     as Array<{ id: string; type: string; busy: boolean; x: number; z: number }>) ?? []
    const myBuildings = (state.myBuildings as Array<{ id: string; type: string }>) ?? []
    const enemyBuildings = (state.enemyBuildings as Array<{ id: string; type: string; x: number; z: number }>) ?? []
    const buildSpots  = (state.suggestedBuildSpots as Array<{ x: number; z: number }>) ?? []
    const gold   = (state.gold   as number) ?? 0
    const lumber = (state.lumber as number) ?? 0

    const idleWorkers  = myUnits.filter(u => u.type === 'worker'  && !u.busy)
    const idleFighters = myUnits.filter(u => u.type === 'footman' && !u.busy)
    const hasBarracks  = myBuildings.some(b => b.type === 'barracks')
    const enemyTH      = enemyBuildings.find(b => b.type === 'town_hall')
    const resources    = (state.resources as Array<{ id: string; type: string; x: number; z: number; amount: number }>) ?? []
    const goldSrc      = resources.find(r => r.type === 'gold' && r.amount > 0)

    // Keep all idle workers on gold
    if (idleWorkers.length && goldSrc) {
      await client.gather({
        agentId: AGENT_ID,
        unitIds: idleWorkers.map(u => u.id),
        x: goldSrc.x,
        z: goldSrc.z,
      }).catch(() => {})
    }

    // Rush barracks
    if (!hasBarracks && gold >= 150 && lumber >= 100 && idleWorkers.length && buildSpots.length) {
      await client.build({
        agentId: AGENT_ID,
        unitIds: [idleWorkers[0].id],
        buildingType: 'barracks',
        x: buildSpots[0].x,
        z: buildSpots[0].z,
      }).catch(() => {})
    }

    // Every idle fighter attacks immediately — don't wait
    if (idleFighters.length && enemyTH) {
      await client.attack({
        agentId: AGENT_ID,
        unitIds: idleFighters.map(u => u.id),
        x: enemyTH.x,
        z: enemyTH.z,
      }).catch(() => {})
    }
  }, TICK_MS)
}

main().catch(console.error)
