import { GameState, SerializedState } from './types.js'
import { STARTS } from './constants.js'
import { dist } from './tick.js'

export function serializeForPlayer(state: GameState, pid: number): SerializedState {
  const alive  = <T extends { hp: number }>(x: T) => x.hp > 0
  const isMe   = <T extends { playerId: number }>(x: T) => x.playerId === pid
  const isEnemy= <T extends { playerId: number }>(x: T) => x.playerId !== pid

  const myUnits     = state.units.filter(u => alive(u) && isMe(u))
  const myBuildings = state.buildings.filter(b => alive(b) && isMe(b))
  const enemyUnits  = state.units.filter(u => alive(u) && isEnemy(u))
  const enemyBldg   = state.buildings.filter(b => alive(b) && isEnemy(b))
  const pl          = state.players[pid]
  const start       = STARTS[pid]

  const supply    = myUnits.length
  const supplyMax = myBuildings.filter(b => b.type === 'TownHall').length * 10 +
                    myBuildings.filter(b => b.type === 'Farm').length * 10 + 5

  const hasBarracks = myBuildings.some(b => b.type === 'Barracks' && !b.underConstruction)
  const enemyTH     = enemyBldg.find(b => b.type === 'TownHall')

  const canAffordNow: string[] = []
  if (pl.gold >= 50)                          canAffordNow.push('train Worker')
  if (pl.gold >= 120)                         canAffordNow.push('train Footman')
  if (pl.gold >= 80 && pl.lumber >= 20)       canAffordNow.push('train Archer')
  if (!hasBarracks && pl.gold >= 150 && pl.lumber >= 100) canAffordNow.push('build Barracks')

  // Suggested build spot: diagonal from TownHall, on the side toward map center
  const direction = pid === 0 ? 1 : -1
  const buildSpot = { tx: start.tx + direction * 5, tz: start.tz + direction * 5 }

  return {
    tick: state.tick,
    playerId: pid,
    gold: pl.gold,
    lumber: pl.lumber,
    supply,
    supplyMax,
    supplyFree: Math.max(0, supplyMax - supply),
    myBaseCenter: { tx: start.tx, tz: start.tz },
    suggestedBuildSpots: [buildSpot],

    myUnits: myUnits.map(u => ({
      id: u.id, type: u.type, tx: u.tx, tz: u.tz,
      hp: u.hp, maxHp: u.maxHp, state: u.state, level: u.level,
      busy: u.state !== 'idle',
      carry: u.carrying > 0 ? { type: 'gold', amount: u.carrying } : null,
    })),

    myBuildings: myBuildings.map(b => ({
      id: b.id, type: b.type, tx: b.tx, tz: b.tz,
      hp: b.hp, maxHp: b.maxHp, level: b.level,
      underConstruction: b.underConstruction,
      upgrading: b.upgrading,
      trainingQueue: b.trainingQueue.map(q => ({
        unit: q.unit,
        progress: 1 - q.ticksLeft / q.totalTicks,
      })),
    })),

    enemyUnits: enemyUnits.map(u => ({
      id: u.id, type: u.type, tx: u.tx, tz: u.tz, hp: u.hp, level: u.level,
    })),

    enemyBuildings: enemyBldg.map(b => ({
      id: b.id, type: b.type, tx: b.tx, tz: b.tz, hp: b.hp, maxHp: b.maxHp,
    })),

    resources: state.resources
      .filter(r => r.amount > 0)
      .map(r => ({ id: r.id, type: r.type, tx: r.tx, tz: r.tz, amount: r.amount })),

    lootPiles: [],

    situation: (() => {
      const myTH         = myBuildings.find(b => b.type === 'TownHall')
      const myWorkers    = myUnits.filter(u => u.type === 'Worker')
      const myCombat     = myUnits.filter(u => u.type !== 'Worker')
      const enemyCombat  = enemyUnits.filter(u => u.type !== 'Worker')
      const idleWorkers  = myWorkers.filter(u => u.state === 'idle')
      const idleCombat   = myCombat.filter(u => u.state === 'idle')

      const enemiesNearBase = myTH
        ? enemyUnits.filter(u => dist(u.tx, u.tz, myTH.tx, myTH.tz) <= 12)
        : []
      const underAttack = enemiesNearBase.length > 0

      const nearestEnemyDist = myTH && enemyUnits.length
        ? Math.min(...enemyUnits.map(u => dist(u.tx, u.tz, myTH.tx, myTH.tz)))
        : 999

      const myTHHpPct    = myTH    ? Math.round(myTH.hp    / myTH.maxHp    * 100) : 0
      const enemyTHHpPct = enemyTH ? Math.round(enemyTH.hp / enemyTH.maxHp * 100) : 100

      const totalResources = state.resources.reduce((s, r) => s + r.amount, 0)

      const recommendedActions: string[] = []
      if (underAttack)
        recommendedActions.push(`URGENT: ${enemiesNearBase.length} enemy unit(s) near your base — send combat to defend`)
      if (idleWorkers.length > 0 && totalResources > 0)
        recommendedActions.push(`${idleWorkers.length} idle worker(s) — assign to gather gold`)
      if (!hasBarracks && pl.gold >= 150 && pl.lumber >= 100)
        recommendedActions.push(`Build Barracks now (gold:${pl.gold} lumber:${pl.lumber})`)
      if (myWorkers.length < 5 && pl.gold >= 50)
        recommendedActions.push(`Train more workers (have ${myWorkers.length}, want 5+)`)
      if (idleCombat.length > 0 && enemyTH)
        recommendedActions.push(`${idleCombat.length} idle fighter(s) — attack enemy TownHall at (${enemyTH.tx},${enemyTH.tz})`)
      if (enemyTHHpPct < 50)
        recommendedActions.push(`Enemy TownHall at ${enemyTHHpPct}% HP — push to finish`)

      return {
        urgentAction:       underAttack
          ? `DEFEND: ${enemiesNearBase.length} enemies attacking base`
          : enemyTH
            ? `Destroy enemy TownHall at (${enemyTH.tx},${enemyTH.tz}) [${enemyTHHpPct}% HP]`
            : 'WIN',
        idleWorkerIds:      idleWorkers.map(u => u.id),
        idleCombatIds:      idleCombat.map(u => u.id),
        hasBarracks,
        enemyDefenseless:   enemyCombat.length === 0,
        dominantAdvantage:  myUnits.length > enemyUnits.length * 2,
        crushingAdvantage:  myUnits.length > enemyUnits.length * 3,
        canAffordNow,
        underAttack,
        enemiesNearBaseCount: enemiesNearBase.length,
        nearestEnemyDist,
        myTHHpPct,
        enemyTHHpPct,
        myWorkerCount:      myWorkers.length,
        myCombatCount:      myCombat.length,
        enemyCombatCount:   enemyCombat.length,
        totalResources,
        recommendedActions,
      }
    })(),
  }
}
