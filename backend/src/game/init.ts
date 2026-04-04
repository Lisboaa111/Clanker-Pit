import {
  GameState, Unit, Building, Resource, UnitType,
} from './types.js'
import {
  MAP_SIZE, UNIT_HP, BUILDING_HP, STARTS,
} from './constants.js'

let _uid = 0
export const uid = (p: string) => `${p}${++_uid}`

function makeUnit(type: UnitType, playerId: number, tx: number, tz: number): Unit {
  return {
    id: uid('u'), playerId, type, tx, tz,
    hp: UNIT_HP[type], maxHp: UNIT_HP[type], level: 1,
    state: 'idle', attackCooldown: 0, gatherTimer: 0, carrying: 0,
    targetUnitId: null, targetBuildingId: null, targetResourceId: null,
    targetTx: null, targetTz: null,
  }
}

export function initGameState(): GameState {
  const units: Unit[]      = []
  const buildings: Building[] = []

  for (const [pid, s] of STARTS.entries()) {
    // Town Hall
    buildings.push({
      id: uid('b'), playerId: pid, type: 'TownHall',
      tx: s.tx, tz: s.tz,
      hp: BUILDING_HP.TownHall, maxHp: BUILDING_HP.TownHall, level: 1,
      underConstruction: false, buildTicksLeft: 0, upgrading: false,
      trainingQueue: [], attackCooldown: 0,
    })

    // 4 Workers
    for (let i = 0; i < 4; i++) {
      units.push(makeUnit('Worker', pid, s.tx + 3 + (i % 2), s.tz + 1 + Math.floor(i / 2)))
    }
    // 2 Footmen
    for (let i = 0; i < 2; i++) {
      units.push(makeUnit('Footman', pid, s.tx + 1 + i, s.tz + 4))
    }
    // 1 Archer
    units.push(makeUnit('Archer', pid, s.tx + 3, s.tz + 4))
  }

  // Gold mines scattered around the map
  const goldSpots = [
    { tx:  9, tz:  5 }, { tx:  5, tz:  9 }, { tx: 13, tz: 13 }, { tx:  9, tz: 14 },
    { tx: 38, tz: 44 }, { tx: 44, tz: 38 }, { tx: 34, tz: 34 }, { tx: 40, tz: 34 },
    { tx: 22, tz: 18 }, { tx: 18, tz: 22 }, { tx: 26, tz: 26 },
    { tx: 10, tz: 35 }, { tx: 35, tz: 10 }, { tx: 24, tz: 10 }, { tx: 10, tz: 24 },
  ]
  const resources: Resource[] = goldSpots.map(p => ({
    id: uid('r'), type: 'gold' as const, ...p, amount: 500,
  }))

  return {
    tick: 0,
    units,
    buildings,
    resources,
    players: [
      { gold: 300, lumber: 150 },
      { gold: 300, lumber: 150 },
    ],
    winnerId:   null,
    finishedAt: null,
  }
}
