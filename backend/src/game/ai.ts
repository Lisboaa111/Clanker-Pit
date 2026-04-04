/**
 * Built-in rule-based AI — runs server-side when no external agent commands arrive.
 * External agents can always override by submitting their own commands via POST /game/command.
 *
 * Priority order (evaluated top-to-bottom, first match wins per unit/building):
 * 1. Emergency defense: enemy combat near base → intercept
 * 2. Keep workers gathering
 * 3. Build Barracks when affordable
 * 4. Train workers until 5
 * 5. Train Archers (high value, ranged)
 * 6. Train Footmen (meat shield)
 * 7. Push idle combat at enemy
 */
import { GameState, AgentCommand } from './types.js'
import { STARTS } from './constants.js'
import { dist } from './tick.js'

export function ruleBasedDecide(state: GameState, pid: number): { commands: AgentCommand[]; reasoning: string } {
  const myUnits     = state.units.filter(u => u.playerId === pid && u.hp > 0)
  const myBuildings = state.buildings.filter(b => b.playerId === pid && b.hp > 0)
  const enemyUnits  = state.units.filter(u => u.playerId !== pid && u.hp > 0)
  const enemyBldg   = state.buildings.filter(b => b.playerId !== pid && b.hp > 0)
  const pl          = state.players[pid]

  const workers    = myUnits.filter(u => u.type === 'Worker')
  const combat     = myUnits.filter(u => u.type !== 'Worker')
  const idleWorkers = workers.filter(u => u.state === 'idle')
  const idleCombat  = combat.filter(u => u.state === 'idle')

  const myTH       = myBuildings.find(b => b.type === 'TownHall')
  const myBarracks = myBuildings.find(b => b.type === 'Barracks' && !b.underConstruction)
  const enemyTH    = enemyBldg.find(b => b.type === 'TownHall')

  // Best enemy target: TownHall first, then anything else
  const bestEnemyBuilding = enemyTH ?? enemyBldg[0]

  const cmds: AgentCommand[] = []
  const notes: string[] = []

  // ── 1. Emergency defense ─────────────────────────────────────────────────────
  if (myTH) {
    const threatUnits = enemyUnits.filter(
      u => u.type !== 'Worker' && dist(u.tx, u.tz, myTH.tx, myTH.tz) <= 14,
    )
    if (threatUnits.length > 0 && idleCombat.length > 0) {
      // Target the nearest threat to TH
      const nearestThreat = threatUnits.sort(
        (a, b) => dist(a.tx, a.tz, myTH.tx, myTH.tz) - dist(b.tx, b.tz, myTH.tx, myTH.tz),
      )[0]
      cmds.push({ type: 'ATTACK', unitIds: idleCombat.map(u => u.id), targetId: nearestThreat.id })
      notes.push(`DEFEND: ${idleCombat.length} fighters → nearest threat`)
    }
  }

  // ── 2. Keep all workers gathering ────────────────────────────────────────────
  const availableGold = state.resources.filter(r => r.amount > 0)
  if (availableGold.length > 0 && idleWorkers.length > 0) {
    // Sort mines by distance from TH
    const baseTx = myTH?.tx ?? STARTS[pid].tx
    const baseTz = myTH?.tz ?? STARTS[pid].tz
    const nearestMine = availableGold.sort(
      (a, b) => dist(a.tx, a.tz, baseTx, baseTz) - dist(b.tx, b.tz, baseTx, baseTz),
    )[0]
    cmds.push({ type: 'GATHER', unitIds: idleWorkers.map(u => u.id), resourceId: nearestMine.id })
    notes.push(`${idleWorkers.length} workers → gather gold`)
  }

  // ── 3. Build Barracks if affordable and none exists ───────────────────────────
  const hasAnyBarracks = myBuildings.some(b => b.type === 'Barracks')
  if (!hasAnyBarracks && pl.gold >= 150 && pl.lumber >= 100 && workers.length > 0 && myTH) {
    const dir = pid === 0 ? 1 : -1
    // Place barracks 5 tiles toward map center from TH
    const bx = Math.max(2, Math.min(44, myTH.tx + dir * 5))
    const bz = Math.max(2, Math.min(44, myTH.tz + dir * 3))
    // Use first non-gathering worker if possible, else any worker
    const builder = workers.find(u => u.state === 'idle') ?? workers[0]
    cmds.push({ type: 'BUILD', unitIds: [builder.id], building: 'barracks', tx: bx, tz: bz })
    notes.push('building Barracks')
  }

  // ── 4. Train workers if fewer than 5 ─────────────────────────────────────────
  if (workers.length < 5 && pl.gold >= 50 && myTH && myTH.trainingQueue.length < 2) {
    cmds.push({ type: 'TRAIN', buildingId: myTH.id, unit: 'Worker' })
    notes.push('training Worker')
  }

  // ── 5. Train Archers (high value: range 8, CD 2) ─────────────────────────────
  if (myBarracks && pl.gold >= 80 && pl.lumber >= 20 && myUnits.length < 22 && myBarracks.trainingQueue.length < 3) {
    cmds.push({ type: 'TRAIN', buildingId: myBarracks.id, unit: 'Archer' })
    notes.push('training Archer')
  }
  // ── 6. Train Footmen if gold surplus ─────────────────────────────────────────
  else if (myBarracks && pl.gold >= 120 && myUnits.length < 22 && myBarracks.trainingQueue.length < 3) {
    cmds.push({ type: 'TRAIN', buildingId: myBarracks.id, unit: 'Footman' })
    notes.push('training Footman')
  }

  // ── 7. Push idle combat at enemy ─────────────────────────────────────────────
  const unorderedCombat = idleCombat.filter(
    u => !cmds.some(c => 'unitIds' in c && (c as any).unitIds?.includes(u.id)),
  )
  if (unorderedCombat.length > 0 && bestEnemyBuilding) {
    cmds.push({ type: 'ATTACK_BUILDING', unitIds: unorderedCombat.map(u => u.id), targetId: bestEnemyBuilding.id })
    notes.push(`${unorderedCombat.length} fighters → enemy ${bestEnemyBuilding.type}`)
  }

  const reasoning = notes.length
    ? `P${pid}: ${notes.join(' | ')} [gold:${pl.gold} lbr:${pl.lumber} units:${myUnits.length}]`
    : `P${pid}: holding [gold:${pl.gold} lbr:${pl.lumber} units:${myUnits.length}]`

  return { commands: cmds, reasoning }
}
