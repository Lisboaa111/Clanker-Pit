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
  TOWER_L2_GOLD, TOWER_L2_LUMBER, TOWER_L2_TIME, TOWER_L3_GOLD, TOWER_L3_LUMBER, TOWER_L3_TIME,
  BARRACKS_L2_GOLD, BARRACKS_L2_LUMBER, BARRACKS_L2_TIME, BARRACKS_L2_BONUS_XP,
  BARRACKS_L3_GOLD, BARRACKS_L3_LUMBER, BARRACKS_L3_TIME, BARRACKS_L3_BONUS_XP,
  FARM_L2_GOLD, FARM_L2_LUMBER, FARM_L2_TIME, FARM_L2_SUPPLY,
  FARM_L3_GOLD, FARM_L3_LUMBER, FARM_L3_TIME, FARM_L3_SUPPLY,
  TOWNHALL_L2_GOLD, TOWNHALL_L2_LUMBER, TOWNHALL_L2_TIME, TOWNHALL_L2_SUPPLY, TOWNHALL_L2_TRAIN_BONUS,
  TOWNHALL_L3_GOLD, TOWNHALL_L3_LUMBER, TOWNHALL_L3_TIME, TOWNHALL_L3_SUPPLY, TOWNHALL_L3_TRAIN_BONUS,
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
  bonusXp: number
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
        if (b.type === BuildingType.TOWN_HALL) {
          const thBonus = b.level === 2 ? TOWNHALL_L2_SUPPLY : b.level === 3 ? TOWNHALL_L3_SUPPLY : 0
          return acc + SUPPLY_FROM_TOWNHALL + thBonus
        }
        if (b.type === BuildingType.FARM) {
          const farmBonus = b.level === 2 ? FARM_L2_SUPPLY : b.level === 3 ? FARM_L3_SUPPLY : 0
          return acc + SUPPLY_FROM_FARM + farmBonus
        }
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
    level: 1,
    upgrading: false,
    upgradeProgress: 0,
    upgradeTime: 0,
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

// ── Upgrade cost lookup ───────────────────────────────────────────────────────
export function getBuildingUpgradeCost(
  type: BuildingType,
  currentLevel: number,
): { gold: number; lumber: number; time: number } | null {
  if (currentLevel >= 3) return null
  const isL2 = currentLevel === 1
  switch (type) {
    case BuildingType.TOWER:
      return isL2
        ? { gold: TOWER_L2_GOLD, lumber: TOWER_L2_LUMBER, time: TOWER_L2_TIME }
        : { gold: TOWER_L3_GOLD, lumber: TOWER_L3_LUMBER, time: TOWER_L3_TIME }
    case BuildingType.BARRACKS:
      return isL2
        ? { gold: BARRACKS_L2_GOLD, lumber: BARRACKS_L2_LUMBER, time: BARRACKS_L2_TIME }
        : { gold: BARRACKS_L3_GOLD, lumber: BARRACKS_L3_LUMBER, time: BARRACKS_L3_TIME }
    case BuildingType.FARM:
      return isL2
        ? { gold: FARM_L2_GOLD, lumber: FARM_L2_LUMBER, time: FARM_L2_TIME }
        : { gold: FARM_L3_GOLD, lumber: FARM_L3_LUMBER, time: FARM_L3_TIME }
    case BuildingType.TOWN_HALL:
      return isL2
        ? { gold: TOWNHALL_L2_GOLD, lumber: TOWNHALL_L2_LUMBER, time: TOWNHALL_L2_TIME }
        : { gold: TOWNHALL_L3_GOLD, lumber: TOWNHALL_L3_LUMBER, time: TOWNHALL_L3_TIME }
    default:
      return null
  }
}

// ── Start an upgrade ──────────────────────────────────────────────────────────
export function startBuildingUpgrade(
  building: Building,
  playerResources: { gold: number; lumber: number },
): boolean {
  const cost = getBuildingUpgradeCost(building.type, building.level)
  if (!cost) return false
  if (playerResources.gold < cost.gold || playerResources.lumber < cost.lumber) return false
  playerResources.gold   -= cost.gold
  playerResources.lumber -= cost.lumber
  building.upgrading       = true
  building.upgradeProgress = 0
  building.upgradeTime     = cost.time
  return true
}

// ── Per-frame update ──────────────────────────────────────────────────────────
export function updateBuilding(
  building: Building,
  dt: number,
  state: GameState,
  scene: THREE.Scene,
): BuildingUpdate | null {
  if (building.destroyed) return null

  // Upgrade progress tick
  if (building.upgrading) {
    building.upgradeProgress = Math.min(1, building.upgradeProgress + dt / building.upgradeTime)
    if (building.upgradeProgress >= 1) {
      building.level++
      building.upgrading = false
      building.upgradeProgress = 0
      window.dispatchEvent(new CustomEvent('building-upgraded', {
        detail: { buildingId: building.id, level: building.level },
      }))
    }
    return null  // no shooting or training while upgrading
  }

  // ── Tower: auto-attack nearby enemies ──────────────────────────────────────
  if (building.type === BuildingType.TOWER && !building.underConstruction) {
    building.attackCooldown -= dt
    if (building.attackCooldown <= 0) {
      const towerDamage = TOWER_ATTACK_DAMAGE * (1 + (building.level - 1) * 0.5)
      const towerRange  = TOWER_ATTACK_RANGE  + (building.level - 1) * 1.5
      const towerCd     = building.level === 3 ? TOWER_ATTACK_COOLDOWN * 0.7 : TOWER_ATTACK_COOLDOWN
      const target = findNearestEnemy(building, state.workers, towerRange)
      if (target) {
        building.attackCooldown = towerCd
        const wx = building.tileX * TILE_SIZE + TILE_SIZE / 2
        const wz = building.tileZ * TILE_SIZE + TILE_SIZE / 2
        return {
          projectile: {
            fromX: wx, fromY: 2.8, fromZ: wz,
            targetId: target.id,
            targetBuildingId: null,
            damage: towerDamage,
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
    const trainSpeedBonus = (building.type as string) === 'town_hall'
      ? (building.level === 2 ? TOWNHALL_L2_TRAIN_BONUS : building.level === 3 ? TOWNHALL_L3_TRAIN_BONUS : 0)
      : 0
    item.timer -= dt * (1 + trainSpeedBonus)
    if (item.timer <= 0) {
      building.trainingQueue.shift()
      const spawnTile = adjacentGrassTile(state.map, building.tileX, building.tileZ)
      const bonusXp = (building.type as string) === 'barracks'
        ? (building.level === 2 ? BARRACKS_L2_BONUS_XP : building.level === 3 ? BARRACKS_L3_BONUS_XP : 0)
        : 0
      return { spawn: { unitType: item.unitType, playerId: building.playerId, tileX: spawnTile.x, tileZ: spawnTile.z, bonusXp } }
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
function findNearestEnemy(building: Building, workers: Worker[], range: number): Worker | null {
  const bx = building.tileX * TILE_SIZE + TILE_SIZE / 2
  const bz = building.tileZ * TILE_SIZE + TILE_SIZE / 2
  let nearest: Worker | null = null
  let nearestD = range
  for (const w of workers) {
    if (w.dead || w.playerId === building.playerId || w.deathAnimTimer > 0) continue
    const dx = w.x - bx, dz = w.z - bz
    const d  = Math.sqrt(dx * dx + dz * dz)
    if (d < nearestD) { nearestD = d; nearest = w }
  }
  return nearest
}
