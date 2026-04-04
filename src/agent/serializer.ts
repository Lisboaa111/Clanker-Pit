import { GameState, UnitType, ResourceType } from '../game/types'
import { worldToTile } from '../game/pathfinding'
import { TILE_SIZE } from '../game/constants'
import { getBuildingUpgradeCost } from '../game/entities/building'

function unitTypeName(t: UnitType): string {
  if (t === UnitType.FOOTMAN) return 'Footman'
  if (t === UnitType.ARCHER)  return 'Archer'
  return 'Worker'
}

/** Serialize the full game state into a compact context object for the LLM. */
export function serializeState(state: GameState, playerId: number): object {
  const enemyId = 1 - playerId
  const myRes = state.playerResources[playerId]

  const myUnits = state.workers
    .filter(w => w.playerId === playerId && !w.dead)
    .map(w => {
      const tile = worldToTile(w.x, w.z, TILE_SIZE)
      return {
        id: w.id,
        type: unitTypeName(w.unitType),
        tx: tile.x,
        tz: tile.z,
        hp: Math.ceil(w.hp),
        maxHp: Math.ceil(w.maxHp),
        state: w.state as string,
        level: w.level,
        carry: w.carryAmount > 0
          ? { type: w.carryType === ResourceType.GOLD ? 'gold' : 'lumber', amount: w.carryAmount }
          : null,
      }
    })

  const myBuildings = state.buildings
    .filter(b => b.playerId === playerId && !b.destroyed)
    .map(b => {
      const cost = getBuildingUpgradeCost(b.type, b.level)
      return {
        id: b.id,
        type: b.type as string,
        tx: b.tileX,
        tz: b.tileZ,
        hp: Math.ceil(b.hp),
        maxHp: Math.ceil(b.maxHp),
        level: b.level,
        underConstruction: b.underConstruction,
        upgrading: b.upgrading,
        trainingQueue: b.trainingQueue.length,
        upgradeCost: cost,
      }
    })

  const enemyUnits = state.workers
    .filter(w => w.playerId === enemyId && !w.dead)
    .map(w => {
      const tile = worldToTile(w.x, w.z, TILE_SIZE)
      return {
        id: w.id,
        type: unitTypeName(w.unitType),
        tx: tile.x,
        tz: tile.z,
        hp: Math.ceil(w.hp),
        level: w.level,
      }
    })

  const enemyBuildings = state.buildings
    .filter(b => b.playerId === enemyId && !b.destroyed)
    .map(b => ({
      id: b.id,
      type: b.type as string,
      tx: b.tileX,
      tz: b.tileZ,
      hp: Math.ceil(b.hp),
      maxHp: Math.ceil(b.maxHp),
    }))

  const resources = state.resources
    .filter(r => !r.depleted)
    .map(r => ({
      id: r.id,
      type: r.type === ResourceType.GOLD ? 'gold' : 'lumber',
      tx: r.tileX,
      tz: r.tileZ,
      amount: r.amount,
    }))

  return {
    tick: state.tick,
    playerId,
    gold: myRes.gold,
    lumber: myRes.lumber,
    supply: state.playerSupply[playerId],
    supplyMax: state.playerSupplyMax[playerId],
    myUnits,
    myBuildings,
    enemyUnits,
    enemyBuildings,
    resources,
  }
}
