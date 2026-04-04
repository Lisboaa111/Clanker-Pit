import * as THREE from 'three'
import {
  Building, BuildingType, GameState, UnitType,
  ProjectileRequest, Worker,
} from '../types'
import {
  makeTownHallMesh, makeBarracksMesh, makeFarmMesh, makeTowerMesh,
  makeConstructionSite, makeBuildingHealthBar, updateHealthBarFill,
} from '../../three/meshes'
import {
  TILE_SIZE,
  TOWN_HALL_HP, TOWN_HALL_HP_BAR_WIDTH, TOWN_HALL_SIZE,
  BARRACKS_HP, BARRACKS_HP_BAR_WIDTH, BARRACKS_BUILD_TIME,
  FARM_HP, FARM_HP_BAR_WIDTH, FARM_BUILD_TIME,
  TOWER_HP, TOWER_HP_BAR_WIDTH, TOWER_ATTACK_RANGE, TOWER_ATTACK_DAMAGE, TOWER_ATTACK_COOLDOWN, TOWER_BUILD_TIME,
  SUPPLY_FROM_TOWNHALL, SUPPLY_FROM_FARM,
} from '../constants'
import { adjacentGrassTile } from '../utils'

let uid = 0
function nextId() { return `bld_${uid++}` }

// ── Return types from updateBuilding ─────────────────────────────────────────
export interface SpawnRequest {
  unitType: UnitType
  playerId: number
  tileX: number
  tileZ: number
}

export interface BuildingUpdate {
  spawn?: SpawnRequest
  projectile?: ProjectileRequest
  constructionComplete?: boolean
}

// ── HP/supply data helpers ────────────────────────────────────────────────────
export function getBuildingMaxHp(type: BuildingType): number {
  switch (type) {
    case BuildingType.TOWN_HALL: return TOWN_HALL_HP
    case BuildingType.BARRACKS:  return BARRACKS_HP
    case BuildingType.FARM:      return FARM_HP
    case BuildingType.TOWER:     return TOWER_HP
  }
}

export function getBuildingHpBarWidth(type: BuildingType): number {
  switch (type) {
    case BuildingType.TOWN_HALL: return TOWN_HALL_HP_BAR_WIDTH
    case BuildingType.BARRACKS:  return BARRACKS_HP_BAR_WIDTH
    case BuildingType.FARM:      return FARM_HP_BAR_WIDTH
    case BuildingType.TOWER:     return TOWER_HP_BAR_WIDTH
  }
}

export function getBuildingHpBarY(type: BuildingType): number {
  switch (type) {
    case BuildingType.TOWN_HALL: return TOWN_HALL_SIZE * 0.6 + TOWN_HALL_SIZE * 0.4 + 0.4
    case BuildingType.BARRACKS:  return 1.6
    case BuildingType.FARM:      return 1.2
    case BuildingType.TOWER:     return 3.4
  }
}

export function getBuildingBuildTime(type: BuildingType): number {
  switch (type) {
    case BuildingType.BARRACKS:  return BARRACKS_BUILD_TIME
    case BuildingType.FARM:      return FARM_BUILD_TIME
    case BuildingType.TOWER:     return TOWER_BUILD_TIME
    default:                     return 0
  }
}

export function calcSupplyMax(buildings: Building[], playerId: number): number {
  return Math.min(
    buildings
      .filter(b => b.playerId === playerId && !b.destroyed && !b.underConstruction)
      .reduce((acc, b) => {
        if (b.type === BuildingType.TOWN_HALL) return acc + SUPPLY_FROM_TOWNHALL
        if (b.type === BuildingType.FARM)      return acc + SUPPLY_FROM_FARM
        return acc
      }, 0),
    30,
  )
}

// ── Building tag (for raycasting) ─────────────────────────────────────────────
function tagGroup(group: THREE.Group, id: string) {
  group.userData.buildingId = id
  group.traverse(child => { child.userData.buildingId = id })
}

// ── Base building factory ─────────────────────────────────────────────────────
function makeBuilding(
  type: BuildingType,
  playerId: number,
  tileX: number,
  tileZ: number,
  mesh: THREE.Group,
  underConstruction: boolean,
): Building {
  const id        = nextId()
  const maxHp     = getBuildingMaxHp(type)
  const barWidth  = getBuildingHpBarWidth(type)
  const barY      = getBuildingHpBarY(type)

  tagGroup(mesh, id)
  const { bg: hpBg, fill: hpFill } = makeBuildingHealthBar(barWidth, barY)
  mesh.add(hpBg, hpFill)

  return {
    id,
    type,
    playerId,
    tileX,
    tileZ,
    mesh: mesh as unknown as THREE.Mesh,
    hp: maxHp,
    maxHp,
    hpFill,
    destroyed: false,
    trainingQueue: [],
    underConstruction,
    buildProgress: underConstruction ? 0 : 1,
    builderId: null,
    attackCooldown: 0,
  }
}

// ── Town Hall ─────────────────────────────────────────────────────────────────
export function createTownHall(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene): Building {
  const wx    = tileX * TILE_SIZE + TILE_SIZE
  const wz    = tileZ * TILE_SIZE + TILE_SIZE
  const group = makeTownHallMesh(wx, wz, playerId)
  scene.add(group)
  return makeBuilding(BuildingType.TOWN_HALL, playerId, tileX, tileZ, group, false)
}

// ── Barracks ──────────────────────────────────────────────────────────────────
export function createBarracks(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene, underConstruction = true): Building {
  const wx    = tileX * TILE_SIZE + TILE_SIZE
  const wz    = tileZ * TILE_SIZE + TILE_SIZE
  const group = underConstruction
    ? makeConstructionSite(wx, wz, 3.8, 1.0, 2.8)
    : makeBarracksMesh(wx, wz, playerId)
  scene.add(group)
  const b = makeBuilding(BuildingType.BARRACKS, playerId, tileX, tileZ, group, underConstruction)
  if (underConstruction) {
    // Store playerId on scaffold for later mesh swap
    ;(group as THREE.Group).userData.playerId = playerId
  }
  return b
}

// ── Farm ──────────────────────────────────────────────────────────────────────
export function createFarm(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene, underConstruction = true): Building {
  const wx    = tileX * TILE_SIZE + TILE_SIZE / 2
  const wz    = tileZ * TILE_SIZE + TILE_SIZE / 2
  const group = underConstruction
    ? makeConstructionSite(wx, wz, 1.6, 0.6, 1.6)
    : makeFarmMesh(wx, wz, playerId)
  scene.add(group)
  const b = makeBuilding(BuildingType.FARM, playerId, tileX, tileZ, group, underConstruction)
  ;(group as THREE.Group).userData.playerId = playerId
  return b
}

// ── Guard Tower ───────────────────────────────────────────────────────────────
export function createTower(tileX: number, tileZ: number, playerId: number, scene: THREE.Scene, underConstruction = true): Building {
  const wx    = tileX * TILE_SIZE + TILE_SIZE / 2
  const wz    = tileZ * TILE_SIZE + TILE_SIZE / 2
  const group = underConstruction
    ? makeConstructionSite(wx, wz, 0.9, 2.8, 0.9)
    : makeTowerMesh(wx, wz, playerId)
  scene.add(group)
  const b = makeBuilding(BuildingType.TOWER, playerId, tileX, tileZ, group, underConstruction)
  ;(group as THREE.Group).userData.playerId = playerId
  return b
}

// ── Factory by type ───────────────────────────────────────────────────────────
export function createBuilding(
  type: BuildingType,
  tileX: number,
  tileZ: number,
  playerId: number,
  scene: THREE.Scene,
  underConstruction = true,
): Building {
  switch (type) {
    case BuildingType.BARRACKS: return createBarracks(tileX, tileZ, playerId, scene, underConstruction)
    case BuildingType.FARM:     return createFarm(tileX, tileZ, playerId, scene, underConstruction)
    case BuildingType.TOWER:    return createTower(tileX, tileZ, playerId, scene, underConstruction)
    default:                    return createTownHall(tileX, tileZ, playerId, scene)
  }
}

// ── Complete construction (swap scaffold → real mesh) ─────────────────────────
export function completeConstruction(building: Building, scene: THREE.Scene) {
  const playerId = (building.mesh as unknown as THREE.Group).userData.playerId ?? building.playerId
  const wx = (building.mesh as unknown as THREE.Group).position.x
  const wz = (building.mesh as unknown as THREE.Group).position.z

  // Remove scaffold
  scene.remove(building.mesh as unknown as THREE.Object3D)

  // Create real mesh
  let realGroup: THREE.Group
  switch (building.type) {
    case BuildingType.BARRACKS: realGroup = makeBarracksMesh(wx, wz, playerId); break
    case BuildingType.FARM:     realGroup = makeFarmMesh(wx, wz, playerId);     break
    case BuildingType.TOWER:    realGroup = makeTowerMesh(wx, wz, playerId);    break
    default:                    realGroup = makeTownHallMesh(wx, wz, playerId); break
  }

  tagGroup(realGroup, building.id)
  const barWidth = getBuildingHpBarWidth(building.type)
  const barY     = getBuildingHpBarY(building.type)
  const { bg: hpBg, fill: hpFill } = makeBuildingHealthBar(barWidth, barY)
  realGroup.add(hpBg, hpFill)

  scene.add(realGroup)
  building.mesh    = realGroup as unknown as THREE.Mesh
  building.hpFill  = hpFill
  building.underConstruction = false
  building.buildProgress     = 1

  // Update HP bar to full
  updateHealthBarFill(hpFill, building.hp / building.maxHp, barWidth)
}

// ── Per-frame update ──────────────────────────────────────────────────────────
export function updateBuilding(
  building: Building,
  dt: number,
  state: GameState,
  scene: THREE.Scene,
): BuildingUpdate | null {
  if (building.destroyed) return null

  // ── Tower: auto-attack nearby enemies ──────────────────────────────────────
  if (building.type === BuildingType.TOWER && !building.underConstruction) {
    building.attackCooldown -= dt
    if (building.attackCooldown <= 0) {
      const target = findNearestEnemy(building, state.workers)
      if (target) {
        building.attackCooldown = TOWER_ATTACK_COOLDOWN
        const wx = building.tileX * TILE_SIZE + TILE_SIZE / 2
        const wz = building.tileZ * TILE_SIZE + TILE_SIZE / 2
        return {
          projectile: {
            fromX: wx, fromY: 2.8, fromZ: wz,
            targetId: target.id,
            targetBuildingId: null,
            damage: TOWER_ATTACK_DAMAGE,
            speed: 16,
            fromPlayerId: building.playerId,
          },
        }
      }
    }
    return null
  }

  // ── Training queue ─────────────────────────────────────────────────────────
  if (!building.underConstruction && building.trainingQueue.length > 0) {
    const item = building.trainingQueue[0]
    item.timer -= dt
    if (item.timer <= 0) {
      building.trainingQueue.shift()
      const spawnTile = adjacentGrassTile(state.map, building.tileX, building.tileZ)
      return { spawn: { unitType: item.unitType, playerId: building.playerId, tileX: spawnTile.x, tileZ: spawnTile.z } }
    }
  }

  return null
}

// ── Damage building ───────────────────────────────────────────────────────────
export function damageBuilding(building: Building, amount: number) {
  building.hp = Math.max(0, building.hp - amount)
  updateHealthBarFill(building.hpFill, building.hp / building.maxHp, getBuildingHpBarWidth(building.type))
  if (building.hp <= 0) building.destroyed = true
}

export function removeDestroyedBuilding(building: Building, scene: THREE.Scene) {
  scene.remove(building.mesh as unknown as THREE.Object3D)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function findNearestEnemy(building: Building, workers: Worker[]): Worker | null {
  const bx = building.tileX * TILE_SIZE + TILE_SIZE / 2
  const bz = building.tileZ * TILE_SIZE + TILE_SIZE / 2
  let nearest: Worker | null = null
  let nearestD = TOWER_ATTACK_RANGE
  for (const w of workers) {
    if (w.dead || w.playerId === building.playerId || w.deathAnimTimer > 0) continue
    const dx = w.x - bx, dz = w.z - bz
    const d  = Math.sqrt(dx * dx + dz * dz)
    if (d < nearestD) { nearestD = d; nearest = w }
  }
  return nearest
}
