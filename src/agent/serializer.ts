import { GameState, UnitType, ResourceType, BuildingType, WorkerState } from '../game/types'
import { worldToTile } from '../game/pathfinding'
import {
  TILE_SIZE,
  TRAIN_WORKER_GOLD,
  TRAIN_FOOTMAN_GOLD, TRAIN_FOOTMAN_LUMBER,
  TRAIN_ARCHER_GOLD,  TRAIN_ARCHER_LUMBER,
  BARRACKS_GOLD, BARRACKS_LUMBER,
  FARM_GOLD, FARM_LUMBER,
  TOWER_GOLD, TOWER_LUMBER,
} from '../game/constants'
import { getBuildingUpgradeCost } from '../game/entities/building'

function unitTypeName(t: UnitType): string {
  if (t === UnitType.FOOTMAN) return 'Footman'
  if (t === UnitType.ARCHER)  return 'Archer'
  return 'Worker'
}

/** Worker states where the unit is already doing something useful — don't reassign. */
const BUSY_STATES = new Set<WorkerState>([
  WorkerState.GATHERING,
  WorkerState.MOVING_TO_RESOURCE,
  WorkerState.MOVING_TO_TOWNHALL,
  WorkerState.DEPOSITING,
  WorkerState.ATTACKING,
  WorkerState.MOVING_TO_ATTACK,
  WorkerState.BUILDING,
])

/** Serialize the full game state into a rich context object for the LLM. */
export function serializeState(state: GameState, playerId: number): object {
  const enemyId = 1 - playerId
  const myRes   = state.playerResources[playerId]
  const supplyFree = state.playerSupplyMax[playerId] - state.playerSupply[playerId]

  // ── My units ──────────────────────────────────────────────────────────────
  const myAllAlive    = state.workers.filter(w => w.playerId === playerId && !w.dead)
  const myWorkersOnly = myAllAlive.filter(w => w.unitType === UnitType.WORKER)
  const myCombat      = myAllAlive.filter(w => w.unitType !== UnitType.WORKER)

  const myUnits = myAllAlive.map(w => {
    const tile = worldToTile(w.x, w.z, TILE_SIZE)
    return {
      id:     w.id,
      type:   unitTypeName(w.unitType),
      tx:     tile.x,
      tz:     tile.z,
      hp:     Math.ceil(w.hp),
      maxHp:  Math.ceil(w.maxHp),
      state:  w.state as string,
      level:  w.level,
      busy:   BUSY_STATES.has(w.state),
      carry:  w.carryAmount > 0
        ? { type: w.carryType === ResourceType.GOLD ? 'gold' : 'lumber', amount: w.carryAmount }
        : null,
    }
  })

  // ── My buildings ──────────────────────────────────────────────────────────
  const myBuildingsRaw = state.buildings.filter(b => b.playerId === playerId && !b.destroyed)

  const myBuildings = myBuildingsRaw.map(b => {
    const cost = getBuildingUpgradeCost(b.type, b.level)
    return {
      id:               b.id,
      type:             b.type as string,
      tx:               b.tileX,
      tz:               b.tileZ,
      hp:               Math.ceil(b.hp),
      maxHp:            Math.ceil(b.maxHp),
      level:            b.level,
      underConstruction: b.underConstruction,
      upgrading:        b.upgrading,
      trainingQueue:    b.trainingQueue.length,
      upgradeCost:      cost,
    }
  })

  // ── Enemy ─────────────────────────────────────────────────────────────────
  const enemyAllAlive = state.workers.filter(w => w.playerId === enemyId && !w.dead)

  const enemyUnits = enemyAllAlive.map(w => {
    const tile = worldToTile(w.x, w.z, TILE_SIZE)
    return { id: w.id, type: unitTypeName(w.unitType), tx: tile.x, tz: tile.z, hp: Math.ceil(w.hp), level: w.level }
  })

  const enemyBuildings = state.buildings
    .filter(b => b.playerId === enemyId && !b.destroyed)
    .map(b => ({
      id:    b.id,
      type:  b.type as string,
      tx:    b.tileX,
      tz:    b.tileZ,
      hp:    Math.ceil(b.hp),
      maxHp: Math.ceil(b.maxHp),
    }))

  // ── Resources on map ──────────────────────────────────────────────────────
  const resources = state.resources
    .filter(r => !r.depleted)
    .map(r => ({
      id:     r.id,
      type:   r.type === ResourceType.GOLD ? 'gold' : 'lumber',
      tx:     r.tileX,
      tz:     r.tileZ,
      amount: r.amount,
    }))

  // ── Loot piles (free resources on ground — walk a worker over them) ────────
  const lootPiles = (state.lootPiles ?? [])
    .filter(l => l.amount > 0)
    .map(l => {
      const tile = worldToTile(l.x, l.z, TILE_SIZE)
      return { type: l.type === ResourceType.GOLD ? 'gold' : 'lumber', amount: l.amount, tx: tile.x, tz: tile.z }
    })

  // ── Situation analysis (key derived facts for decision-making) ────────────
  const idleWorkerIds = myWorkersOnly
    .filter(w => !BUSY_STATES.has(w.state))
    .map(w => w.id)

  const idleCombatIds = myCombat
    .filter(w => !BUSY_STATES.has(w.state))
    .map(w => w.id)

  const readyBarracks = myBuildingsRaw.find(
    b => b.type === BuildingType.BARRACKS && !b.underConstruction && !b.destroyed
  )
  const hasBarracks  = !!readyBarracks
  const townHall     = myBuildingsRaw.find(b => b.type === BuildingType.TOWN_HALL)
  const readyTH      = townHall && !townHall.underConstruction ? townHall : null

  const enemyCombat  = enemyAllAlive.filter(w => w.unitType !== UnitType.WORKER)
  const enemyTowers  = state.buildings.filter(b => b.playerId === enemyId && !b.destroyed && b.type === BuildingType.TOWER)
  const enemyTH      = enemyBuildings.find(b => b.type === 'town_hall')
  const enemyDefenseless = enemyCombat.length === 0 && enemyTowers.length === 0

  // What can be afforded right now
  const canAffordNow: string[] = []
  if (readyTH && readyTH.trainingQueue.length < 5 && myRes.gold >= TRAIN_WORKER_GOLD && supplyFree > 0)
    canAffordNow.push(`Worker (cost:${TRAIN_WORKER_GOLD}g) — TRAIN from buildingId:"${readyTH.id}"`)
  if (hasBarracks && readyBarracks!.trainingQueue.length < 5 && supplyFree > 0) {
    if (myRes.gold >= TRAIN_FOOTMAN_GOLD && myRes.lumber >= TRAIN_FOOTMAN_LUMBER)
      canAffordNow.push(`Footman (cost:${TRAIN_FOOTMAN_GOLD}g) — TRAIN from buildingId:"${readyBarracks!.id}"`)
    if (myRes.gold >= TRAIN_ARCHER_GOLD && myRes.lumber >= TRAIN_ARCHER_LUMBER)
      canAffordNow.push(`Archer (cost:${TRAIN_ARCHER_GOLD}g,${TRAIN_ARCHER_LUMBER}l) — TRAIN from buildingId:"${readyBarracks!.id}"`)
  }
  if (!hasBarracks && myRes.gold >= BARRACKS_GOLD && myRes.lumber >= BARRACKS_LUMBER)
    canAffordNow.push(`barracks (cost:${BARRACKS_GOLD}g,${BARRACKS_LUMBER}l) — BUILD with a worker`)
  if (myRes.gold >= FARM_GOLD && myRes.lumber >= FARM_LUMBER)
    canAffordNow.push(`farm (cost:${FARM_GOLD}g,${FARM_LUMBER}l) — BUILD with a worker`)
  if (myRes.gold >= TOWER_GOLD && myRes.lumber >= TOWER_LUMBER)
    canAffordNow.push(`tower (cost:${TOWER_GOLD}g,${TOWER_LUMBER}l) — BUILD with a worker`)

  // Base position for building placement hints
  const baseTx = townHall?.tileX ?? (playerId === 0 ? 8 : 40)
  const baseTz = townHall?.tileZ ?? (playerId === 0 ? 8 : 40)
  // Suggest building spots offset from town hall (picked to avoid collision)
  const buildSpot1 = { tx: baseTx + 4, tz: baseTz + 2 }
  const buildSpot2 = { tx: baseTx + 4, tz: baseTz + 5 }
  const buildSpot3 = { tx: baseTx - 4, tz: baseTz + 2 }

  // ── Derived advantage metrics ─────────────────────────────────────────────
  const myTotalPower   = myCombat.length
  const enemyTotalPower = enemyCombat.length + enemyTowers.length
  const dominantAdvantage = myTotalPower >= 2 && myTotalPower > enemyTotalPower + 1
  const crushingAdvantage = myTotalPower >= 1 && enemyAllAlive.length <= 1  // enemy has ≤1 unit total

  // ── Build composite urgentAction (ALL concerns combined, not exclusive) ────
  const urgentParts: string[] = []

  // #1 — Absolute win conditions (enemy open or nearly dead)
  if (enemyDefenseless && enemyTH) {
    const allIds = myAllAlive.map(u => u.id)
    urgentParts.push(`🏆 WIN NOW: Enemy has ZERO combat units+towers! ATTACK_BUILDING town_hall id="${enemyTH.id}" at (${enemyTH.tx},${enemyTH.tz}) with ALL units unitIds:${JSON.stringify(allIds)}`)
  } else if (crushingAdvantage && enemyTH) {
    const combatIds = [...myCombat.map(u => u.id), ...myWorkersOnly.slice(0,2).map(u => u.id)]
    urgentParts.push(`🏆 FINISH THEM: Enemy has only ${enemyAllAlive.length} unit(s) left! Send ALL fighters to ATTACK_BUILDING town_hall id="${enemyTH.id}" at (${enemyTH.tx},${enemyTH.tz}) unitIds:${JSON.stringify(combatIds)}`)
  } else if (dominantAdvantage && enemyTH) {
    const combatIds = myCombat.map(u => u.id)
    urgentParts.push(`⚔️ PRESS ADVANTAGE: You have ${myTotalPower} fighters vs enemy ${enemyTotalPower} — ATTACK_BUILDING town_hall id="${enemyTH.id}" at (${enemyTH.tx},${enemyTH.tz}) with fighters unitIds:${JSON.stringify(combatIds)}`)
  }

  // #2 — Idle combat units (ALWAYS direct them regardless of other concerns)
  if (!enemyDefenseless && !dominantAdvantage && !crushingAdvantage && idleCombatIds.length >= 1 && enemyTH) {
    urgentParts.push(`⚔️ ${idleCombatIds.length} IDLE FIGHTERS [${idleCombatIds.join(',')}] — ATTACK_MOVE toward enemy base (${enemyTH.tx},${enemyTH.tz})`)
  }

  // #3 — Idle workers (economy — always gather regardless of other concerns)
  if (idleWorkerIds.length > 0 && resources.length > 0) {
    const g = resources.find(r => r.type === 'gold') ?? resources[0]
    const l = resources.find(r => r.type === 'lumber') ?? resources[0]
    urgentParts.push(`💰 ${idleWorkerIds.length} IDLE WORKERS [${idleWorkerIds.join(',')}] — GATHER gold from "${g.id}" at (${g.tx},${g.tz})${l !== g ? ` or lumber from "${l.id}" at (${l.tx},${l.tz})` : ''}`)
  }

  // #4 — Economy / building concerns (secondary)
  if (supplyFree <= 0 && myRes.gold >= FARM_GOLD && myRes.lumber >= FARM_LUMBER) {
    urgentParts.push(`🏗️ Supply CAPPED (${state.playerSupply[playerId]}/${state.playerSupplyMax[playerId]}) — BUILD farm at (${buildSpot1.tx},${buildSpot1.tz})`)
  } else if (!hasBarracks && myRes.gold >= BARRACKS_GOLD && myRes.lumber >= BARRACKS_LUMBER) {
    urgentParts.push(`🏗️ No barracks — BUILD barracks at (${buildSpot1.tx},${buildSpot1.tz}) with an idle worker`)
  }

  // #5 — Training (only if supply is free)
  if (canAffordNow.length > 0 && supplyFree > 0) {
    urgentParts.push(`🎓 ${canAffordNow[0]}`)
  }

  const urgentAction = urgentParts.length > 0 ? urgentParts.join(' | ') : 'none'

  return {
    tick:       state.tick,
    playerId,
    gold:       myRes.gold,
    lumber:     myRes.lumber,
    supply:     state.playerSupply[playerId],
    supplyMax:  state.playerSupplyMax[playerId],
    supplyFree,
    myBaseCenter: { tx: baseTx, tz: baseTz },
    suggestedBuildSpots: [buildSpot1, buildSpot2, buildSpot3],
    myUnits,
    myBuildings,
    enemyUnits,
    enemyBuildings,
    resources,
    lootPiles,
    situation: {
      urgentAction,
      idleWorkerIds,
      idleCombatIds,
      hasBarracks,
      enemyDefenseless,
      dominantAdvantage,
      crushingAdvantage,
      myCombatCount:    myCombat.length,
      enemyCombatCount: enemyCombat.length,
      enemyTotalUnits:  enemyAllAlive.length,
      enemyTowerCount:  enemyTowers.length,
      canAffordNow,
    },
  }
}
