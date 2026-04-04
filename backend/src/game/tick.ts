import { GameState, AgentCommand, Unit, Building } from './types.js'
import {
  UNIT_HP, UNIT_ATK, UNIT_RANGE, UNIT_CD, UNIT_COST,
  TRAIN_TICKS, BUILDING_HP, GATHER_TICKS, GATHER_AMOUNT, CARRY_MAX,
  BARRACKS_COST, BARRACKS_TICKS, TOWER_ATK, TOWER_RANGE, TOWER_CD, MAX_TICKS,
} from './constants.js'
import { uid } from './init.js'

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Chebyshev (8-directional) tile distance */
export const dist = (ax: number, az: number, bx: number, bz: number) =>
  Math.max(Math.abs(ax - bx), Math.abs(az - bz))

/** Move unit one tile toward (tx,tz) */
function stepToward(u: Unit, tx: number, tz: number) {
  const dx = tx - u.tx; const dz = tz - u.tz
  if (dx !== 0) u.tx += Math.sign(dx)
  if (dz !== 0) u.tz += Math.sign(dz)
}

// ── Apply agent commands ───────────────────────────────────────────────────────

export function applyCommands(state: GameState, cmds: AgentCommand[], pid: number) {
  for (const cmd of cmds) {
    switch (cmd.type) {

      case 'GATHER': {
        const res = state.resources.find(r => r.id === cmd.resourceId && r.amount > 0)
        if (!res) break
        for (const id of cmd.unitIds) {
          const u = state.units.find(u => u.id === id && u.playerId === pid && u.hp > 0 && u.type === 'Worker')
          if (!u) continue
          u.state = 'moving'
          u.targetResourceId = cmd.resourceId
          u.targetTx = res.tx; u.targetTz = res.tz
          u.targetUnitId = null; u.targetBuildingId = null
        }
        break
      }

      case 'ATTACK_BUILDING': {
        const target = state.buildings.find(b => b.id === cmd.targetId && b.playerId !== pid && b.hp > 0)
        if (!target) break
        for (const id of cmd.unitIds) {
          const u = state.units.find(u => u.id === id && u.playerId === pid && u.hp > 0)
          if (!u) continue
          u.state = 'moving'; u.targetBuildingId = cmd.targetId
          u.targetTx = target.tx; u.targetTz = target.tz
          u.targetUnitId = null; u.targetResourceId = null
        }
        break
      }

      case 'ATTACK': {
        const target = state.units.find(u => u.id === cmd.targetId && u.hp > 0 && u.playerId !== pid)
        if (!target) break
        for (const id of cmd.unitIds) {
          const u = state.units.find(u => u.id === id && u.playerId === pid && u.hp > 0)
          if (!u) continue
          u.state = 'moving'; u.targetUnitId = cmd.targetId
          u.targetTx = target.tx; u.targetTz = target.tz
          u.targetBuildingId = null; u.targetResourceId = null
        }
        break
      }

      case 'ATTACK_MOVE': {
        for (const id of cmd.unitIds) {
          const u = state.units.find(u => u.id === id && u.playerId === pid && u.hp > 0)
          if (!u) continue
          u.state = 'moving'; u.targetTx = cmd.tx; u.targetTz = cmd.tz
          u.targetUnitId = null; u.targetBuildingId = null; u.targetResourceId = null
        }
        break
      }

      case 'TRAIN': {
        const bldg = state.buildings.find(
          b => b.id === cmd.buildingId && b.playerId === pid && b.hp > 0 && !b.underConstruction,
        )
        if (!bldg || bldg.trainingQueue.length >= 5) break
        const cost = UNIT_COST[cmd.unit]
        const pl   = state.players[pid]
        if (pl.gold < cost.gold || (cost.lumber && pl.lumber < (cost.lumber ?? 0))) break
        pl.gold -= cost.gold
        if (cost.lumber) pl.lumber -= cost.lumber
        const ticks = TRAIN_TICKS[cmd.unit]
        bldg.trainingQueue.push({ unit: cmd.unit, ticksLeft: ticks, totalTicks: ticks })
        break
      }

      case 'BUILD': {
        const pl = state.players[pid]
        if (pl.gold < BARRACKS_COST.gold || pl.lumber < BARRACKS_COST.lumber) break
        const worker = state.units.find(u =>
          cmd.unitIds.includes(u.id) && u.playerId === pid && u.hp > 0 && u.type === 'Worker',
        )
        if (!worker) break
        // Clamp build location to map
        const bx = Math.max(1, Math.min(cmd.tx, 45))
        const bz = Math.max(1, Math.min(cmd.tz, 45))
        pl.gold -= BARRACKS_COST.gold; pl.lumber -= BARRACKS_COST.lumber
        state.buildings.push({
          id: uid('b'), playerId: pid, type: 'Barracks',
          tx: bx, tz: bz,
          hp: BUILDING_HP.Barracks, maxHp: BUILDING_HP.Barracks, level: 1,
          underConstruction: true, buildTicksLeft: BARRACKS_TICKS, upgrading: false,
          trainingQueue: [], attackCooldown: 0,
        })
        worker.state = 'idle'; worker.targetTx = null; worker.targetTz = null
        break
      }
    }
  }
}

// ── Game tick ──────────────────────────────────────────────────────────────────

export function gameTick(state: GameState): void {
  state.tick++

  // ─ Cooldowns
  for (const u of state.units)     if (u.attackCooldown > 0) u.attackCooldown--
  for (const b of state.buildings) if (b.attackCooldown > 0) b.attackCooldown--

  // ─ Units
  for (const u of state.units) {
    if (u.hp <= 0) continue

    // ── Opportunistic aggro: combat units auto-engage nearby enemies ──────────
    // Runs before all other target logic so units fight through enemies on their
    // way to a building target. targetBuildingId is kept so unit resumes after kill.
    if (u.type !== 'Worker' && !u.targetUnitId) {
      const aggroRange = u.type === 'Archer' ? 10 : 7
      const nearbyEnemy = state.units
        .filter(t => t.playerId !== u.playerId && t.hp > 0 && dist(u.tx, u.tz, t.tx, t.tz) <= aggroRange)
        .sort((a, b) => dist(u.tx, u.tz, a.tx, a.tz) - dist(u.tx, u.tz, b.tx, b.tz))[0]
      if (nearbyEnemy) {
        u.targetUnitId = nearbyEnemy.id
        // Note: keep targetBuildingId — unit resumes building attack once the unit is dead
      }
    }

    // ── Gather flow
    if (u.type === 'Worker' && u.targetResourceId) {
      const res = state.resources.find(r => r.id === u.targetResourceId && r.amount > 0)
      if (!res) {
        // Resource depleted — find another
        const alt = state.resources.find(r => r.amount > 0)
        if (alt) { u.targetResourceId = alt.id; u.targetTx = alt.tx; u.targetTz = alt.tz }
        else { u.targetResourceId = null; u.state = 'idle' }
        continue
      }

      if (u.state === 'returning') {
        const th = state.buildings.find(b => b.playerId === u.playerId && b.type === 'TownHall' && b.hp > 0)
        if (!th) { u.state = 'idle'; continue }
        if (dist(u.tx, u.tz, th.tx, th.tz) <= 2) {
          state.players[u.playerId].gold += u.carrying
          u.carrying = 0; u.state = 'moving'
        } else {
          stepToward(u, th.tx, th.tz)
        }
        continue
      }

      // Move to resource
      if (dist(u.tx, u.tz, res.tx, res.tz) > 2) {
        stepToward(u, res.tx, res.tz); u.state = 'moving'
      } else {
        u.state = 'gathering'; u.gatherTimer++
        if (u.gatherTimer >= GATHER_TICKS) {
          const take = Math.min(GATHER_AMOUNT, res.amount)
          res.amount -= take; u.carrying += take; u.gatherTimer = 0
          if (res.amount <= 0 || u.carrying >= CARRY_MAX) u.state = 'returning'
        }
      }
      continue
    }

    // ── Attack unit
    if (u.targetUnitId) {
      const target = state.units.find(t => t.id === u.targetUnitId && t.hp > 0)
      if (!target) { u.targetUnitId = null; u.state = 'idle'; continue }
      if (dist(u.tx, u.tz, target.tx, target.tz) <= UNIT_RANGE[u.type]) {
        u.state = 'attacking'
        if (u.attackCooldown === 0) {
          target.hp -= UNIT_ATK[u.type]
          u.attackCooldown = UNIT_CD[u.type]
        }
      } else {
        // Re-track moving target
        u.targetTx = target.tx; u.targetTz = target.tz
        stepToward(u, target.tx, target.tz); u.state = 'moving'
      }
      continue
    }

    // ── Attack building
    if (u.targetBuildingId) {
      const target = state.buildings.find(b => b.id === u.targetBuildingId && b.hp > 0)
      if (!target) {
        // Target destroyed — find next enemy building to attack
        const nextBuilding = state.buildings
          .filter(b => b.playerId !== u.playerId && b.hp > 0)
          .sort((a, b) => dist(u.tx, u.tz, a.tx, a.tz) - dist(u.tx, u.tz, b.tx, b.tz))[0]
        if (nextBuilding) {
          u.targetBuildingId = nextBuilding.id
          u.targetTx = nextBuilding.tx; u.targetTz = nextBuilding.tz
        } else {
          // No buildings left — chase nearest enemy unit
          const nearestUnit = state.units
            .filter(t => t.playerId !== u.playerId && t.hp > 0)
            .sort((a, b) => dist(u.tx, u.tz, a.tx, a.tz) - dist(u.tx, u.tz, b.tx, b.tz))[0]
          u.targetBuildingId = null
          if (nearestUnit) {
            u.targetUnitId = nearestUnit.id
            u.targetTx = nearestUnit.tx; u.targetTz = nearestUnit.tz
          } else {
            u.state = 'idle'
          }
        }
        continue
      }
      if (dist(u.tx, u.tz, target.tx, target.tz) <= UNIT_RANGE[u.type]) {
        u.state = 'attacking'
        if (u.attackCooldown === 0) {
          target.hp -= UNIT_ATK[u.type]
          u.attackCooldown = UNIT_CD[u.type]
          if (target.hp <= 0) { u.targetBuildingId = null; u.state = 'idle' }
        }
      } else {
        stepToward(u, target.tx, target.tz); u.state = 'moving'
      }
      continue
    }

    // ── Attack-move (opportunistic)
    if (u.targetTx !== null) {
      // Scan for nearby enemies within aggro range (wider than attack range)
      const aggroRange = u.type === 'Archer' ? 10 : 7
      const nearest = state.units
        .filter(t => t.playerId !== u.playerId && t.hp > 0 && dist(u.tx, u.tz, t.tx, t.tz) <= aggroRange)
        .sort((a, b) => dist(u.tx, u.tz, a.tx, a.tz) - dist(u.tx, u.tz, b.tx, b.tz))[0]
      if (nearest) {
        u.state = 'attacking'
        if (u.attackCooldown === 0) {
          nearest.hp -= UNIT_ATK[u.type]
          u.attackCooldown = UNIT_CD[u.type]
        }
      } else if (u.targetTx !== null && u.targetTz !== null && dist(u.tx, u.tz, u.targetTx, u.targetTz) <= 1) {
        // Also attack any enemy building in range at destination
        const nearBldg = state.buildings
          .filter(b => b.playerId !== u.playerId && b.hp > 0 && dist(u.tx, u.tz, b.tx, b.tz) <= UNIT_RANGE[u.type])
          [0]
        if (nearBldg) {
          u.targetBuildingId = nearBldg.id
          u.targetTx = null; u.targetTz = null
        } else {
          u.targetTx = null; u.targetTz = null; u.state = 'idle'
        }
      } else {
        stepToward(u, u.targetTx!, u.targetTz!); u.state = 'moving'
      }
    }
  }

  // ─ Buildings
  for (const b of state.buildings) {
    if (b.hp <= 0) continue

    if (b.underConstruction) {
      b.buildTicksLeft--
      if (b.buildTicksLeft <= 0) b.underConstruction = false
      continue
    }

    // Training queue
    if (b.trainingQueue.length > 0) {
      const job = b.trainingQueue[0]
      job.ticksLeft--
      if (job.ticksLeft <= 0) {
        b.trainingQueue.shift()
        state.units.push({
          id: uid('u'), playerId: b.playerId, type: job.unit,
          tx: b.tx + 2, tz: b.tz + 1,
          hp: UNIT_HP[job.unit], maxHp: UNIT_HP[job.unit], level: 1,
          state: 'idle', attackCooldown: 0, gatherTimer: 0, carrying: 0,
          targetUnitId: null, targetBuildingId: null, targetResourceId: null,
          targetTx: null, targetTz: null,
        })
      }
    }

    // Tower auto-attack
    if (b.type === 'Tower' && b.attackCooldown === 0) {
      const enemy = state.units.find(u =>
        u.playerId !== b.playerId && u.hp > 0 && dist(b.tx, b.tz, u.tx, u.tz) <= TOWER_RANGE,
      )
      if (enemy) { enemy.hp -= TOWER_ATK; b.attackCooldown = TOWER_CD }
    }
  }

  // ─ Prune dead units
  state.units = state.units.filter(u => u.hp > 0)

  // ─ Win condition: check each player's TownHall
  for (const pid of [0, 1]) {
    const th = state.buildings.find(b => b.playerId === pid && b.type === 'TownHall' && b.hp > 0)
    if (!th && state.winnerId === null) {
      state.winnerId   = 1 - pid
      state.finishedAt = Date.now()
    }
  }

  // ─ Tick limit
  if (state.tick >= MAX_TICKS && state.winnerId === null) {
    // Winner = player with more TownHall HP
    const th0 = state.buildings.find(b => b.playerId === 0 && b.type === 'TownHall')?.hp ?? 0
    const th1 = state.buildings.find(b => b.playerId === 1 && b.type === 'TownHall')?.hp ?? 0
    state.winnerId   = th0 >= th1 ? 0 : 1
    state.finishedAt = Date.now()
  }
}
