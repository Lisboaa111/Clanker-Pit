import * as THREE from 'three'
import {
  Worker, WorkerState, ResourceType, GameState, UnitType,
  CommandType, GameCommand, TileType, ProjectileRequest, LootPile,
} from '../types'
import {
  makeWorkerMesh, makeFootmanMesh, makeArcherMesh,
  makeSelectionRing, makeCarryIndicator,
  makeHealthBar, updateHealthBarFill,
  makePathLine, updateCarryIndicator, makeLevelIndicator,
} from '../../three/meshes'
import { findPath, tileToWorld, worldToTile } from '../pathfinding'
import { depleteResource } from './resource'
import { damageBuilding, getBuildingHpBarWidth, getBuildingBuildTime, completeConstruction } from './building'
import { adjacentGrassTile } from '../utils'
import {
  TILE_SIZE,
  WORKER_SPEED, WORKER_CARRY_GOLD, WORKER_CARRY_LUMBER,
  GATHER_TICK_RATE, DEPOSIT_DURATION,
  WORKER_HP, WORKER_ATTACK_DAMAGE, WORKER_ATTACK_RANGE, WORKER_ATTACK_COOLDOWN, WORKER_SIZE,
  FOOTMAN_HP, FOOTMAN_ATTACK_DAMAGE, FOOTMAN_ATTACK_RANGE, FOOTMAN_ATTACK_COOLDOWN, FOOTMAN_SPEED,
  ARCHER_HP, ARCHER_ATTACK_DAMAGE, ARCHER_ATTACK_RANGE, ARCHER_ATTACK_COOLDOWN, ARCHER_SPEED,
  ARCHER_PROJECTILE_SPEED, ARCHER_SIZE,
  AUTO_ATTACK_RADIUS, ATTACK_MOVE_SCAN,
  HP_REGEN_RATE, HP_REGEN_DELAY_TICKS,
  DEATH_ANIM_DURATION,
  FORMATION_SPACING,
  MAP_WIDTH, MAP_HEIGHT,
  XP_PER_KILL_WORKER, XP_PER_KILL_FOOTMAN, XP_PER_KILL_ARCHER, XP_LEVEL_2, XP_LEVEL_3, XP_LEVEL_DAMAGE_BONUS, XP_LEVEL_HP_BONUS, CRIT_CHANCE, CRIT_MULTIPLIER, KNOCKBACK_DIST, CLEAVE_RADIUS, CLEAVE_DAMAGE_RATIO, MULTISHOT_INTERVAL, MULTISHOT_TARGETS, MULTISHOT_RADIUS, WORKER_REPAIR_RANGE, WORKER_REPAIR_RATE, LOOT_COLLECT_RADIUS,
} from '../constants'

let uid = 0
function nextId() { return `w${uid++}` }

// ── Base factory helper ───────────────────────────────────────────────────────

function baseUnit(
  tileX: number,
  tileZ: number,
  playerId: number,
  unitType: UnitType,
  hp: number,
  speed: number,
  maxCarry: number,
  mesh: THREE.Mesh,
  scene: THREE.Scene,
): Worker {
  const { x: wx, z: wz } = tileToWorld(tileX, tileZ, TILE_SIZE)
  const ring  = makeSelectionRing(playerId)
  const carry = makeCarryIndicator()
  const { bg: hpBg, fill: hpFill } = makeHealthBar()

  mesh.position.set(wx, mesh.position.y, wz)
  mesh.add(ring, carry, hpBg, hpFill)
  scene.add(mesh)

  return {
    id: nextId(),
    playerId,
    unitType,
    state: WorkerState.IDLE,
    x: wx, z: wz,
    targetTileX: tileX, targetTileZ: tileZ,
    path: [], pathIndex: 0,
    targetResourceId: null,
    lastResourceId: null,
    gatherTileX: tileX, gatherTileZ: tileZ,
    carryType: null, carryAmount: 0,
    maxCarry,
    gatherTimer: 0, depositTimer: 0,
    hp, maxHp: hp,
    attackTargetId: null, attackTargetBuildingId: null, attackCooldown: 0,
    lastDamagedTick: -HP_REGEN_DELAY_TICKS - 1,
    buildTargetBuildingId: null,
    speed,
    attackMove: false,
    deathAnimTimer: 0,
    dead: false,
    mesh, selectionRing: ring, carryIndicator: carry, hpFill,
    pathLine: null, selected: false,
    xp: 0,
    level: 1,
    levelMesh: null,
    attackCount: 0,
  }
}

// ── Factories ─────────────────────────────────────────────────────────────────

export function createWorker(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene): Worker {
  return baseUnit(tileX, tileZ, playerId, UnitType.WORKER, WORKER_HP, WORKER_SPEED, WORKER_CARRY_GOLD, makeWorkerMesh(playerId), scene)
}

export function createFootman(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene): Worker {
  return baseUnit(tileX, tileZ, playerId, UnitType.FOOTMAN, FOOTMAN_HP, FOOTMAN_SPEED, 0, makeFootmanMesh(playerId), scene)
}

export function createArcher(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene): Worker {
  return baseUnit(tileX, tileZ, playerId, UnitType.ARCHER, ARCHER_HP, ARCHER_SPEED, 0, makeArcherMesh(playerId), scene)
}

export function createUnit(unitType: UnitType, tileX: number, tileZ: number, playerId: number, scene: THREE.Scene): Worker {
  switch (unitType) {
    case UnitType.FOOTMAN: return createFootman(tileX, tileZ, playerId, scene)
    case UnitType.ARCHER:  return createArcher(tileX, tileZ, playerId, scene)
    default:               return createWorker(tileX, tileZ, playerId, scene)
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

export function applyCommand(worker: Worker, cmd: GameCommand, state: GameState, scene: THREE.Scene) {
  if (!cmd.workerIds.includes(worker.id)) return

  if (cmd.type === CommandType.MOVE_TO_TILE || cmd.type === CommandType.ATTACK_MOVE) {
    const isAttackMove = cmd.type === CommandType.ATTACK_MOVE
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), cmd.tileX, cmd.tileZ, false)
    worker.state = WorkerState.MOVING_TO_TARGET
    worker.path = path; worker.pathIndex = 0
    worker.targetTileX = cmd.tileX; worker.targetTileZ = cmd.tileZ
    worker.targetResourceId = null
    worker.buildTargetBuildingId = null  // explicit move cancels any pending build
    worker.attackTargetId = null; worker.attackTargetBuildingId = null
    worker.attackMove = isAttackMove
    refreshPathLine(worker, scene)

  } else if (cmd.type === CommandType.GATHER_RESOURCE) {
    if (worker.unitType !== UnitType.WORKER) return
    const res = state.resources.find(r => r.id === cmd.resourceId)
    if (!res || res.depleted) return
    const dest = adjacentGrassTile(state.map, res.tileX, res.tileZ)
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
    // Empty path means either already at dest OR unreachable — only proceed if actually there
    const alreadyThere = currentTileX(worker) === dest.x && currentTileZ(worker) === dest.z
    if (path.length === 0 && !alreadyThere) return  // tree is unreachable, ignore command
    worker.state = WorkerState.MOVING_TO_RESOURCE
    worker.path = path; worker.pathIndex = 0
    worker.targetResourceId = res.id
    worker.lastResourceId = res.id
    worker.gatherTileX = dest.x; worker.gatherTileZ = dest.z
    worker.maxCarry = res.type === ResourceType.GOLD ? WORKER_CARRY_GOLD : WORKER_CARRY_LUMBER
    worker.attackTargetId = null; worker.attackTargetBuildingId = null
    worker.attackMove = false
    refreshPathLine(worker, scene)

  } else if (cmd.type === CommandType.ATTACK_UNIT) {
    const target = state.workers.find(w => w.id === cmd.targetWorkerId && !w.dead)
    if (!target) return
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), currentTileX(target), currentTileZ(target), false)
    worker.state = WorkerState.MOVING_TO_ATTACK
    worker.path = path; worker.pathIndex = 0
    worker.attackTargetId = cmd.targetWorkerId
    worker.attackTargetBuildingId = null
    worker.targetResourceId = null
    worker.attackMove = false
    refreshPathLine(worker, scene)

  } else if (cmd.type === CommandType.ATTACK_BUILDING) {
    const building = state.buildings.find(b => b.id === cmd.targetBuildingId && !b.destroyed)
    if (!building) return
    const dest = adjacentGrassTile(state.map, building.tileX, building.tileZ)
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
    worker.state = WorkerState.MOVING_TO_ATTACK
    worker.path = path; worker.pathIndex = 0
    worker.attackTargetBuildingId = cmd.targetBuildingId
    worker.attackTargetId = null
    worker.targetResourceId = null
    worker.attackMove = false
    refreshPathLine(worker, scene)

  } else if (cmd.type === CommandType.BUILD) {
    if (worker.unitType !== UnitType.WORKER) return
    const building = state.buildings.find(b => b.tileX === cmd.tileX && b.tileZ === cmd.tileZ)
    if (!building) return
    const dest = adjacentGrassTile(state.map, cmd.tileX, cmd.tileZ)
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
    worker.state = WorkerState.MOVING_TO_TARGET
    worker.path = path; worker.pathIndex = 0
    worker.targetTileX = dest.x; worker.targetTileZ = dest.z
    worker.buildTargetBuildingId = building.id
    worker.attackTargetId = null; worker.attackTargetBuildingId = null
    worker.attackMove = false
    refreshPathLine(worker, scene)
  }
}

// ── Apply command with formation offsets ──────────────────────────────────────
export function applyMoveCommandFormation(
  workers: Worker[],
  workerIds: string[],
  tileX: number,
  tileZ: number,
  attackMove: boolean,
  state: GameState,
  scene: THREE.Scene,
) {
  const offsets = spiralOffsets(workerIds.length)
  workerIds.forEach((id, i) => {
    const worker = workers.find(w => w.id === id)
    if (!worker || worker.dead) return
    const off = offsets[i]
    const dx = Math.round(off.x), dz = Math.round(off.z)
    const destX = Math.max(0, Math.min(MAP_WIDTH - 1, tileX + dx))
    const destZ = Math.max(0, Math.min(MAP_HEIGHT - 1, tileZ + dz))
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), destX, destZ, false)
    worker.state = WorkerState.MOVING_TO_TARGET
    worker.path = path; worker.pathIndex = 0
    worker.targetTileX = destX; worker.targetTileZ = destZ
    worker.targetResourceId = null
    worker.attackTargetId = null; worker.attackTargetBuildingId = null
    worker.attackMove = attackMove
    refreshPathLine(worker, scene)
  })
}

// ── Stop / Resume ─────────────────────────────────────────────────────────────

export function stopWorker(worker: Worker, scene: THREE.Scene) {
  worker.state = WorkerState.IDLE
  worker.path = []; worker.pathIndex = 0
  worker.attackTargetId = null; worker.attackTargetBuildingId = null
  worker.attackMove = false
  worker.buildTargetBuildingId = null
  clearPathLine(worker, scene)
}

export function resumeWorker(worker: Worker, state: GameState, scene: THREE.Scene) {
  const resId = worker.targetResourceId ?? worker.lastResourceId
  if (!resId) return
  const res = state.resources.find(r => r.id === resId && !r.depleted)
  if (!res) return
  const dest = adjacentGrassTile(state.map, res.tileX, res.tileZ)
  const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
  worker.state = WorkerState.MOVING_TO_RESOURCE
  worker.path = path; worker.pathIndex = 0
  worker.targetResourceId = res.id
  worker.gatherTileX = dest.x; worker.gatherTileZ = dest.z
  worker.maxCarry = res.type === ResourceType.GOLD ? WORKER_CARRY_GOLD : WORKER_CARRY_LUMBER
  refreshPathLine(worker, scene)
}

// ── Update ────────────────────────────────────────────────────────────────────

export function updateWorker(
  worker: Worker,
  dt: number,
  state: GameState,
  scene: THREE.Scene,
): ProjectileRequest[] {
  // Death animation — tick down timer and shrink mesh, then let gameLoop remove it
  if (worker.dead) {
    if (worker.deathAnimTimer > 0) {
      worker.deathAnimTimer -= dt
      const ratio = Math.max(0, worker.deathAnimTimer / DEATH_ANIM_DURATION)
      worker.mesh.scale.setScalar(ratio)
    }
    return []
  }

  // HP regeneration (when not in combat for a while)
  const ticksSinceDamage = state.tick - worker.lastDamagedTick
  if (ticksSinceDamage > HP_REGEN_DELAY_TICKS && worker.hp < worker.maxHp) {
    worker.hp = Math.min(worker.maxHp, worker.hp + HP_REGEN_RATE * dt)
    updateHealthBarFill(worker.hpFill, worker.hp / worker.maxHp)
  }

  let projectileReqs: ProjectileRequest[] = []

  switch (worker.state) {
    case WorkerState.IDLE:
      // Idle workers auto-repair nearby friendly damaged buildings
      if (worker.unitType === UnitType.WORKER) {
        for (const b of state.buildings) {
          if (b.playerId !== worker.playerId || b.destroyed || b.underConstruction || b.hp >= b.maxHp) continue
          const bx = b.tileX * TILE_SIZE + TILE_SIZE / 2
          const bz = b.tileZ * TILE_SIZE + TILE_SIZE / 2
          const repairDist = Math.sqrt((worker.x - bx) ** 2 + (worker.z - bz) ** 2)
          if (repairDist <= WORKER_REPAIR_RANGE) {
            b.hp = Math.min(b.maxHp, b.hp + WORKER_REPAIR_RATE * dt)
            updateHealthBarFill(b.hpFill, b.hp / b.maxHp, getBuildingHpBarWidth(b.type))
            break
          }
        }
      }
      break

    case WorkerState.MOVING_TO_TARGET:
    case WorkerState.MOVING_TO_RESOURCE:
    case WorkerState.MOVING_TO_TOWNHALL:
    case WorkerState.MOVING_TO_ATTACK:
      moveAlongPath(worker, dt, state, scene)
      break

    case WorkerState.GATHERING:
      gatherTick(worker, dt, state, scene)
      break

    case WorkerState.DEPOSITING:
      depositTick(worker, dt, state, scene)
      break

    case WorkerState.ATTACKING:
      projectileReqs = attackTick(worker, dt, state, scene)
      break

    case WorkerState.BUILDING:
      buildingTick(worker, dt, state, scene)
      break
  }

  syncMesh(worker)
  return projectileReqs
}

// ── Movement ──────────────────────────────────────────────────────────────────

function moveAlongPath(worker: Worker, dt: number, state: GameState, scene: THREE.Scene) {
  if (worker.state === WorkerState.MOVING_TO_ATTACK) {
    if (worker.attackTargetBuildingId) {
      const building = state.buildings.find(b => b.id === worker.attackTargetBuildingId && !b.destroyed)
      if (!building) {
        worker.attackTargetBuildingId = null
        engageNextTarget(worker, state, scene)
        return
      }
      const bpos = buildingWorldPos(building)
      if (dist(worker, bpos) <= getAtkRange(worker) * 1.5) {
        worker.state = WorkerState.ATTACKING; worker.attackCooldown = 0
        clearPathLine(worker, scene); return
      }
    } else {
      const target = state.workers.find(w => w.id === worker.attackTargetId && !w.dead)
      if (!target) {
        worker.attackTargetId = null
        engageNextTarget(worker, state, scene)
        return
      }
      if (dist(worker, target) <= getAtkRange(worker)) {
        worker.state = WorkerState.ATTACKING; worker.attackCooldown = 0
        clearPathLine(worker, scene); return
      }
      if (state.tick % 45 === 0) {
        const p = findPath(state.map, currentTileX(worker), currentTileZ(worker), currentTileX(target), currentTileZ(target), false)
        if (p.length > 0) { worker.path = p; worker.pathIndex = 0 }
      }
    }
  }

  // Attack-move: scan for enemies while walking
  if (worker.attackMove && worker.state === WorkerState.MOVING_TO_TARGET) {
    const nearby = nearestEnemyInRange(worker, state, ATTACK_MOVE_SCAN)
    if (nearby) {
      worker.attackTargetId = nearby.id
      worker.state = WorkerState.MOVING_TO_ATTACK
      worker.attackMove = false
      const p = findPath(state.map, currentTileX(worker), currentTileZ(worker), currentTileX(nearby), currentTileZ(nearby), false)
      worker.path = p; worker.pathIndex = 0
      refreshPathLine(worker, scene)
      return
    }
  }

  if (worker.path.length === 0 || worker.pathIndex >= worker.path.length) {
    onPathComplete(worker, state, scene)
    return
  }

  const step = worker.path[worker.pathIndex]
  const { x: tx, z: tz } = tileToWorld(step.x, step.z, TILE_SIZE)
  const dx = tx - worker.x, dz = tz - worker.z
  const d  = Math.sqrt(dx * dx + dz * dz)
  const move = worker.speed * dt * TILE_SIZE

  if (d <= move) {
    worker.x = tx; worker.z = tz
    worker.pathIndex++
    if (worker.pathIndex >= worker.path.length) onPathComplete(worker, state, scene)
  } else {
    worker.x += (dx / d) * move
    worker.z += (dz / d) * move
    worker.mesh.rotation.y = Math.atan2(dx, dz)
  }

  // Loot auto-collection for workers while moving
  if (worker.unitType === UnitType.WORKER) {
    for (const loot of state.lootPiles) {
      if (loot.amount <= 0) continue
      const ldx = worker.x - loot.x
      const ldz = worker.z - loot.z
      if (Math.sqrt(ldx * ldx + ldz * ldz) <= LOOT_COLLECT_RADIUS) {
        const pr = state.playerResources[worker.playerId]
        if (pr) {
          if (loot.type === ResourceType.GOLD) pr.gold += loot.amount
          else pr.lumber += loot.amount
        }
        loot.amount = 0
      }
    }
  }
}

function onPathComplete(worker: Worker, state: GameState, scene: THREE.Scene) {
  clearPathLine(worker, scene)

  if (worker.state === WorkerState.MOVING_TO_TARGET) {
    // Check if we arrived to build something
    if (worker.buildTargetBuildingId) {
      const building = state.buildings.find(b => b.id === worker.buildTargetBuildingId)
      if (building && building.underConstruction) {
        worker.state = WorkerState.BUILDING
        building.builderId = worker.id
        return
      }
      worker.buildTargetBuildingId = null
    }
    worker.state = WorkerState.IDLE
    return
  }

  if (worker.state === WorkerState.MOVING_TO_RESOURCE) {
    const res = state.resources.find(r => r.id === worker.targetResourceId)
    if (!res || res.depleted) { worker.state = WorkerState.IDLE; return }
    worker.state = WorkerState.GATHERING
    worker.gatherTimer = GATHER_TICK_RATE
    return
  }

  if (worker.state === WorkerState.MOVING_TO_TOWNHALL) {
    worker.state = WorkerState.DEPOSITING
    worker.depositTimer = DEPOSIT_DURATION
    return
  }

  if (worker.state === WorkerState.MOVING_TO_ATTACK) {
    if (worker.attackTargetBuildingId) {
      const building = state.buildings.find(b => b.id === worker.attackTargetBuildingId && !b.destroyed)
      if (building) { worker.state = WorkerState.ATTACKING; worker.attackCooldown = 0; return }
    }
    worker.state = WorkerState.IDLE
  }
}

// ── Gathering ─────────────────────────────────────────────────────────────────

function gatherTick(worker: Worker, dt: number, state: GameState, scene: THREE.Scene) {
  const res = state.resources.find(r => r.id === worker.targetResourceId)
  if (!res || res.depleted) {
    // Deposit whatever was already collected instead of silently discarding it
    if (worker.carryAmount > 0) goToTownHall(worker, state, scene)
    else worker.state = WorkerState.IDLE
    return
  }

  // Proximity guard — worker must be at (or 1 tile from) their assigned gather spot.
  // gatherTileX/Z is the forest-edge grass tile, which may be several tiles from
  // the actual (interior) resource tile, so we compare against the spot not the tree.
  const chebFromSpot = Math.max(
    Math.abs(currentTileX(worker) - worker.gatherTileX),
    Math.abs(currentTileZ(worker) - worker.gatherTileZ),
  )
  if (chebFromSpot > 1) {
    // Re-attempt pathing to the gather spot; go idle if still unreachable
    const dest = adjacentGrassTile(state.map, res.tileX, res.tileZ)
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
    const alreadyThere = currentTileX(worker) === dest.x && currentTileZ(worker) === dest.z
    if (path.length > 0 || alreadyThere) {
      worker.state = WorkerState.MOVING_TO_RESOURCE
      worker.path = path; worker.pathIndex = 0
      worker.gatherTileX = dest.x; worker.gatherTileZ = dest.z
    } else {
      worker.state = WorkerState.IDLE
    }
    return
  }

  worker.gatherTimer -= dt
  if (worker.gatherTimer > 0) return
  worker.gatherTimer = GATHER_TICK_RATE

  worker.carryType = res.type
  worker.carryAmount = Math.min(worker.carryAmount + 1, worker.maxCarry)
  res.amount = Math.max(0, res.amount - 1)

  const ratio = res.amount / res.maxAmount
  ;(res.mesh as unknown as THREE.Group).scale.set(ratio * 0.4 + 0.6, ratio * 0.4 + 0.6, ratio * 0.4 + 0.6)
  if (res.amount <= 0) depleteResource(res, scene, state.map)

  updateCarryIndicator(worker.carryIndicator, res.type === ResourceType.GOLD ? 'gold' : 'lumber')

  if (worker.carryAmount >= worker.maxCarry || res.depleted) {
    goToTownHall(worker, state, scene)
  }
}

function depositTick(worker: Worker, dt: number, state: GameState, scene: THREE.Scene) {
  worker.depositTimer -= dt
  if (worker.depositTimer > 0) return

  const pr = state.playerResources[worker.playerId]
  if (pr) {
    if (worker.carryType === ResourceType.GOLD) pr.gold += worker.carryAmount
    else pr.lumber += worker.carryAmount
  }
  worker.carryAmount = 0; worker.carryType = null
  updateCarryIndicator(worker.carryIndicator, null)

  const res = state.resources.find(r => r.id === worker.targetResourceId && !r.depleted)
  if (res) {
    // Return to the same resource
    const dest = adjacentGrassTile(state.map, res.tileX, res.tileZ)
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
    const alreadyThere = currentTileX(worker) === dest.x && currentTileZ(worker) === dest.z
    if (path.length === 0 && !alreadyThere) {
      worker.state = WorkerState.IDLE; worker.targetResourceId = null
    } else {
      worker.state = WorkerState.MOVING_TO_RESOURCE
      worker.path = path; worker.pathIndex = 0
      worker.gatherTileX = dest.x; worker.gatherTileZ = dest.z
    }
  } else {
    // Original resource gone — auto-find nearest resource of the same type
    const lastRes = state.resources.find(r => r.id === worker.lastResourceId)
    const gatherType = lastRes?.type ?? null
    let foundAlternative = false

    if (gatherType !== null) {
      const SEARCH_RADIUS = TILE_SIZE * 15  // 15 tiles
      const workerWorldX = worker.x, workerWorldZ = worker.z
      // Sort by proximity so we pick the nearest one
      const candidates = state.resources
        .filter(r => !r.depleted && r.type === gatherType)
        .map(r => {
          const rx = r.tileX * TILE_SIZE + TILE_SIZE / 2
          const rz = r.tileZ * TILE_SIZE + TILE_SIZE / 2
          return { r, d: Math.sqrt((workerWorldX - rx) ** 2 + (workerWorldZ - rz) ** 2) }
        })
        .filter(({ d }) => d <= SEARCH_RADIUS)
        .sort((a, b) => a.d - b.d)

      for (const { r: nearest } of candidates) {
        const dest = adjacentGrassTile(state.map, nearest.tileX, nearest.tileZ)
        const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
        const alreadyThere = currentTileX(worker) === dest.x && currentTileZ(worker) === dest.z
        if (path.length > 0 || alreadyThere) {
          worker.targetResourceId = nearest.id
          worker.lastResourceId   = nearest.id
          worker.gatherTileX = dest.x; worker.gatherTileZ = dest.z
          worker.maxCarry = nearest.type === ResourceType.GOLD ? WORKER_CARRY_GOLD : WORKER_CARRY_LUMBER
          worker.state = WorkerState.MOVING_TO_RESOURCE
          worker.path = path; worker.pathIndex = 0
          foundAlternative = true
          break
        }
      }
    }

    if (!foundAlternative) {
      worker.state = WorkerState.IDLE; worker.targetResourceId = null
    }
  }
}

function goToTownHall(worker: Worker, state: GameState, scene: THREE.Scene) {
  const th = state.buildings.find(
    b => b.playerId === worker.playerId && b.type === 'town_hall' as any && !b.destroyed,
  )
  if (!th) { worker.state = WorkerState.IDLE; return }

  // The town hall mesh centre sits 1 tile offset from the registered tileX/Z.
  // Workers must stop ≥2 tiles from that centre so they park *outside* the
  // visual building footprint instead of being buried inside it.
  const bCX = th.tileX + 1
  const bCZ = th.tileZ + 1
  const workerX = currentTileX(worker), workerZ = currentTileZ(worker)

  // Four candidate "door" spots, one on each side of the building
  const doors = [
    { x: bCX + 2, z: bCZ },
    { x: bCX - 2, z: bCZ },
    { x: bCX,     z: bCZ + 2 },
    { x: bCX,     z: bCZ - 2 },
  ].filter(c =>
    c.x >= 0 && c.z >= 0 && c.x < MAP_WIDTH && c.z < MAP_HEIGHT &&
    state.map[c.z][c.x].type === TileType.GRASS,
  )

  // Sort by Manhattan distance so the worker walks to the nearest door
  doors.sort(
    (a, b) => (Math.abs(a.x - workerX) + Math.abs(a.z - workerZ)) -
              (Math.abs(b.x - workerX) + Math.abs(b.z - workerZ)),
  )

  let depositX = bCX + 2, depositZ = bCZ
  if (doors.length > 0) { depositX = doors[0].x; depositZ = doors[0].z }

  let path = findPath(state.map, workerX, workerZ, depositX, depositZ, false)
  // If first choice is blocked, try remaining doors
  if (path.length === 0 && !(workerX === depositX && workerZ === depositZ)) {
    for (const c of doors.slice(1)) {
      path = findPath(state.map, workerX, workerZ, c.x, c.z, false)
      if (path.length > 0) { depositX = c.x; depositZ = c.z; break }
    }
  }

  worker.state = WorkerState.MOVING_TO_TOWNHALL
  worker.path = path; worker.pathIndex = 0
  clearPathLine(worker, scene)
}

// ── Building (construction) ───────────────────────────────────────────────────

function buildingTick(worker: Worker, dt: number, state: GameState, scene: THREE.Scene) {
  const building = state.buildings.find(b => b.id === worker.buildTargetBuildingId)
  if (!building || !building.underConstruction) {
    worker.state = WorkerState.IDLE
    worker.buildTargetBuildingId = null
    return
  }

  const buildTime = getBuildingBuildTime(building.type)
  if (buildTime <= 0) { worker.state = WorkerState.IDLE; return }

  building.buildProgress = Math.min(1, building.buildProgress + dt / buildTime)

  if (building.buildProgress >= 1) {
    completeConstruction(building, scene)
    worker.state = WorkerState.IDLE
    worker.buildTargetBuildingId = null
  }
}

// ── Combat ────────────────────────────────────────────────────────────────────

function attackTick(worker: Worker, dt: number, state: GameState, scene: THREE.Scene): ProjectileRequest[] {
  const atkDmg  = getAtkDmg(worker)
  const atkRange = getAtkRange(worker)
  const atkCd   = getAtkCd(worker)

  // ── Building target ─────────────────────────────────────────────────────────
  if (worker.attackTargetBuildingId) {
    const building = state.buildings.find(b => b.id === worker.attackTargetBuildingId && !b.destroyed)
    if (!building) {
      worker.attackTargetBuildingId = null
      engageNextTarget(worker, state, scene)
      return []
    }
    const bpos = buildingWorldPos(building)
    if (dist(worker, bpos) > atkRange * 2.5) {
      const dest = adjacentGrassTile(state.map, building.tileX, building.tileZ)
      const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
      worker.state = WorkerState.MOVING_TO_ATTACK
      worker.path = path; worker.pathIndex = 0
      return []
    }
    worker.mesh.rotation.y = Math.atan2(bpos.x - worker.x, bpos.z - worker.z)
    worker.attackCooldown -= dt
    if (worker.attackCooldown > 0) return []
    worker.attackCooldown = atkCd

    if (worker.unitType === UnitType.ARCHER) {
      // Archers fire projectile at buildings too
      return [archerProjectileReq(worker, null, building.id, atkDmg)]
    }

    damageBuilding(building, atkDmg)
    flashObject(building.mesh as unknown as THREE.Group)
    if (building.destroyed) {
      worker.attackTargetBuildingId = null
      engageNextTarget(worker, state, scene)
    }
    return []
  }

  // ── Unit target ─────────────────────────────────────────────────────────────
  const target = state.workers.find(w => w.id === worker.attackTargetId && !w.dead)
  if (!target) {
    worker.attackTargetId = null
    engageNextTarget(worker, state, scene)
    return []
  }

  if (dist(worker, target) > atkRange * 1.5) {
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), currentTileX(target), currentTileZ(target), false)
    worker.state = WorkerState.MOVING_TO_ATTACK
    worker.path = path; worker.pathIndex = 0
    return []
  }

  worker.mesh.rotation.y = Math.atan2(target.x - worker.x, target.z - worker.z)
  worker.attackCooldown -= dt
  if (worker.attackCooldown > 0) return []
  worker.attackCooldown = atkCd

  // Archer fires projectile
  if (worker.unitType === UnitType.ARCHER) {
    worker.attackCount++
    const reqs: ProjectileRequest[] = [archerProjectileReq(worker, target.id, null, atkDmg)]

    if (worker.attackCount % MULTISHOT_INTERVAL === 0) {
      let extraCount = 0
      for (const w of state.workers) {
        if (extraCount >= MULTISHOT_TARGETS) break
        if (w === target || w.dead || w.playerId === worker.playerId) continue
        const ad = Math.sqrt((w.x - worker.x) ** 2 + (w.z - worker.z) ** 2)
        if (ad <= MULTISHOT_RADIUS) {
          reqs.push(archerProjectileReq(worker, w.id, null, atkDmg))
          extraCount++
        }
      }
    }
    return reqs
  }

  // Melee damage

  // Critical hit roll
  const isCrit = Math.random() < CRIT_CHANCE
  const finalDmg = isCrit ? Math.round(atkDmg * CRIT_MULTIPLIER) : atkDmg

  target.hp = Math.max(0, target.hp - finalDmg)
  target.lastDamagedTick = state.tick
  updateHealthBarFill(target.hpFill, target.hp / target.maxHp)

  // Knockback: push target away from attacker
  const kbDx = target.x - worker.x
  const kbDz = target.z - worker.z
  const kbD  = Math.sqrt(kbDx * kbDx + kbDz * kbDz) || 1
  target.x += (kbDx / kbD) * KNOCKBACK_DIST
  target.z += (kbDz / kbD) * KNOCKBACK_DIST

  // Footman Cleave: hit one adjacent enemy for 50% damage
  if (worker.unitType === UnitType.FOOTMAN) {
    const cleaveDmg = Math.round(finalDmg * CLEAVE_DAMAGE_RATIO)
    let bestCleave: Worker | null = null
    let bestCleaveDist = CLEAVE_RADIUS
    for (const w of state.workers) {
      if (w === target || w === worker || w.dead || w.playerId === worker.playerId) continue
      const cd = Math.sqrt((w.x - target.x) ** 2 + (w.z - target.z) ** 2)
      if (cd < bestCleaveDist) { bestCleaveDist = cd; bestCleave = w }
    }
    if (bestCleave) {
      bestCleave.hp = Math.max(0, bestCleave.hp - cleaveDmg)
      bestCleave.lastDamagedTick = state.tick
      updateHealthBarFill(bestCleave.hpFill, bestCleave.hp / bestCleave.maxHp)
      window.dispatchEvent(new CustomEvent('dmg-number', {
        detail: { x: bestCleave.x, y: bestCleave.mesh.position.y + 0.4, z: bestCleave.z, amount: cleaveDmg, crit: false },
      }))
      if (bestCleave.hp <= 0) {
        bestCleave.dead = true
        bestCleave.deathAnimTimer = DEATH_ANIM_DURATION
        grantXp(worker, bestCleave, scene)
      }
    }
  }

  // Retaliation
  if (
    target.attackTargetId === null &&
    target.attackTargetBuildingId === null &&
    target.state !== WorkerState.MOVING_TO_ATTACK &&
    target.state !== WorkerState.ATTACKING
  ) {
    target.attackTargetId = worker.id
    target.state = WorkerState.MOVING_TO_ATTACK
  }

  // Flash hit
  flashUnit(target)

  // Dispatch damage number
  window.dispatchEvent(new CustomEvent('dmg-number', {
    detail: { x: target.x, y: target.mesh.position.y + 0.4, z: target.z, amount: finalDmg, crit: isCrit },
  }))

  if (target.hp <= 0) {
    target.dead = true
    target.deathAnimTimer = DEATH_ANIM_DURATION
    grantXp(worker, target, scene)
    worker.attackTargetId = null
    engageNextTarget(worker, state, scene)
  }

  return []
}

function archerProjectileReq(
  archer: Worker,
  targetId: string | null,
  targetBuildingId: string | null,
  damage: number,
): ProjectileRequest {
  return {
    fromX: archer.x,
    fromY: archer.mesh.position.y + 0.3,
    fromZ: archer.z,
    targetId,
    targetBuildingId,
    damage,
    speed: ARCHER_PROJECTILE_SPEED,
    fromPlayerId: archer.playerId,
    fromWorkerId: archer.id,
  }
}

// ── Auto-engage after kill ────────────────────────────────────────────────────

function engageNextTarget(worker: Worker, state: GameState, scene: THREE.Scene) {
  const next = nearestEnemyInRange(worker, state, AUTO_ATTACK_RADIUS)
  if (!next) {
    // If this worker was mid-construction when interrupted, walk back and resume
    if (worker.buildTargetBuildingId) {
      const building = state.buildings.find(b => b.id === worker.buildTargetBuildingId && !b.destroyed)
      if (building && building.underConstruction) {
        const dest = adjacentGrassTile(state.map, building.tileX, building.tileZ)
        const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), dest.x, dest.z, false)
        worker.state = WorkerState.MOVING_TO_TARGET
        worker.path = path; worker.pathIndex = 0
        worker.targetTileX = dest.x; worker.targetTileZ = dest.z
        refreshPathLine(worker, scene)
        return
      }
      worker.buildTargetBuildingId = null
    }
    worker.state = WorkerState.IDLE
    return
  }

  worker.attackTargetId = next.id
  if (dist(worker, next) <= getAtkRange(worker)) {
    worker.state = WorkerState.ATTACKING
    worker.attackCooldown = 0
  } else {
    const path = findPath(state.map, currentTileX(worker), currentTileZ(worker), currentTileX(next), currentTileZ(next), false)
    worker.state = WorkerState.MOVING_TO_ATTACK
    worker.path = path; worker.pathIndex = 0
    refreshPathLine(worker, scene)
  }
}

function nearestEnemyInRange(worker: Worker, state: GameState, radius: number): Worker | null {
  let nearest: Worker | null = null
  let nearestScore = Infinity
  for (const w of state.workers) {
    if (w.playerId === worker.playerId || w.dead || w.deathAnimTimer > 0) continue
    const d = dist(worker, w)
    if (d > radius) continue
    // Score: prefer low-HP enemies (focus fire), tiebreak by distance
    const score = d + w.hp * 0.5
    if (score < nearestScore) { nearestScore = score; nearest = w }
  }
  return nearest
}

// ── Mesh sync + selection ─────────────────────────────────────────────────────

function syncMesh(worker: Worker) {
  worker.mesh.position.x = worker.x
  worker.mesh.position.z = worker.z
  worker.selectionRing.visible = worker.selected
}

export function setWorkerSelected(worker: Worker, selected: boolean, scene: THREE.Scene) {
  worker.selected = selected
  worker.selectionRing.visible = selected
  if (!selected) clearPathLine(worker, scene)
  else if (worker.path.length > 0) drawPathLine(worker, scene)
}

function refreshPathLine(worker: Worker, scene: THREE.Scene) {
  clearPathLine(worker, scene)
  if (worker.selected) drawPathLine(worker, scene)
}

function drawPathLine(worker: Worker, scene: THREE.Scene) {
  clearPathLine(worker, scene)
  if (worker.path.length === 0) return
  const points = [new THREE.Vector3(worker.x, 0.2, worker.z)]
  for (let i = worker.pathIndex; i < worker.path.length; i++) {
    const { x, z } = tileToWorld(worker.path[i].x, worker.path[i].z, TILE_SIZE)
    points.push(new THREE.Vector3(x, 0.2, z))
  }
  worker.pathLine = makePathLine(points)
  scene.add(worker.pathLine)
}

function clearPathLine(worker: Worker, scene: THREE.Scene) {
  if (worker.pathLine) { scene.remove(worker.pathLine); worker.pathLine = null }
}

export function removeDeadWorker(worker: Worker, scene: THREE.Scene) {
  clearPathLine(worker, scene)
  scene.remove(worker.mesh)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function currentTileX(w: Worker) { return worldToTile(w.x, w.z, TILE_SIZE).x }
export function currentTileZ(w: Worker) { return worldToTile(w.x, w.z, TILE_SIZE).z }

function dist(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2)
}

function buildingWorldPos(b: import('../types').Building) {
  return { x: b.tileX * TILE_SIZE + TILE_SIZE / 2, z: b.tileZ * TILE_SIZE + TILE_SIZE / 2 }
}

function getAtkDmg(w: Worker): number {
  let base: number
  if (w.unitType === UnitType.FOOTMAN) base = FOOTMAN_ATTACK_DAMAGE
  else if (w.unitType === UnitType.ARCHER) base = ARCHER_ATTACK_DAMAGE
  else base = WORKER_ATTACK_DAMAGE
  return base * (1 + (w.level - 1) * XP_LEVEL_DAMAGE_BONUS)
}

function getUnitXpValue(w: Worker): number {
  if (w.unitType === UnitType.FOOTMAN) return XP_PER_KILL_FOOTMAN
  if (w.unitType === UnitType.ARCHER)  return XP_PER_KILL_ARCHER
  return XP_PER_KILL_WORKER
}

function getBaseMaxHp(w: Worker): number {
  if (w.unitType === UnitType.FOOTMAN) return FOOTMAN_HP
  if (w.unitType === UnitType.ARCHER)  return ARCHER_HP
  return WORKER_HP
}

export function grantXp(killer: Worker, victim: Worker, scene: THREE.Scene): void {
  if (killer.dead) return
  const gain = getUnitXpValue(victim)
  killer.xp += gain
  const oldLevel = killer.level
  if (killer.level < 2 && killer.xp >= XP_LEVEL_2) killer.level = 2
  if (killer.level < 3 && killer.xp >= XP_LEVEL_3) killer.level = 3
  if (killer.level !== oldLevel) {
    const newMax = getBaseMaxHp(killer) * (1 + (killer.level - 1) * XP_LEVEL_HP_BONUS)
    const diff = newMax - killer.maxHp
    killer.maxHp = newMax
    killer.hp = Math.min(killer.maxHp, killer.hp + diff)
    updateHealthBarFill(killer.hpFill, killer.hp / killer.maxHp)
    if (killer.levelMesh) {
      killer.mesh.remove(killer.levelMesh)
      killer.levelMesh = null
    }
    const newIndicator = makeLevelIndicator(killer.level)
    if (newIndicator) {
      killer.mesh.add(newIndicator)
      killer.levelMesh = newIndicator
    }
  }
}

function getAtkRange(w: Worker): number {
  if (w.unitType === UnitType.FOOTMAN) return FOOTMAN_ATTACK_RANGE
  if (w.unitType === UnitType.ARCHER)  return ARCHER_ATTACK_RANGE
  return WORKER_ATTACK_RANGE
}

function getAtkCd(w: Worker): number {
  if (w.unitType === UnitType.FOOTMAN) return FOOTMAN_ATTACK_COOLDOWN
  if (w.unitType === UnitType.ARCHER)  return ARCHER_ATTACK_COOLDOWN
  return WORKER_ATTACK_COOLDOWN
}

function flashUnit(target: Worker) {
  const mat = target.mesh.material as THREE.MeshLambertMaterial
  if (!mat?.color) return
  const orig = mat.color.getHex()
  mat.color.setHex(0xff0000)
  setTimeout(() => { if (mat.color) mat.color.setHex(orig) }, 80)
}

function flashObject(obj: THREE.Object3D) {
  obj.traverse(child => {
    const mat = (child as THREE.Mesh).material as THREE.MeshLambertMaterial
    if (!mat?.color) return
    const orig = mat.color.getHex()
    mat.color.setHex(0xff2200)
    setTimeout(() => { if (mat.color) mat.color.setHex(orig) }, 100)
  })
}

/** Spiral offsets for formation movement: center → right → left → up → down → … */
function spiralOffsets(count: number): Array<{ x: number; z: number }> {
  const sp = FORMATION_SPACING / TILE_SIZE  // in tile units
  const base = [
    { x: 0, z: 0 }, { x: sp, z: 0 }, { x: -sp, z: 0 },
    { x: 0, z: sp }, { x: 0, z: -sp },
    { x: sp, z: sp }, { x: -sp, z: sp }, { x: sp, z: -sp }, { x: -sp, z: -sp },
    { x: 2*sp, z: 0 }, { x: -2*sp, z: 0 }, { x: 0, z: 2*sp }, { x: 0, z: -2*sp },
  ]
  const result: Array<{ x: number; z: number }> = []
  for (let i = 0; i < count; i++) result.push(base[i % base.length] ?? { x: 0, z: 0 })
  return result
}
