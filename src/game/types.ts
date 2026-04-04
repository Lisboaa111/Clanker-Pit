import * as THREE from 'three'

// ── Tile ──────────────────────────────────────────────────────────────────────
export const enum TileType {
  GRASS     = 0,
  WATER     = 1,
  TREE      = 2,
  GOLD_MINE = 3,
}

export interface Tile {
  type: TileType
  x: number
  z: number
  mesh: THREE.Mesh
}

// ── Resources ─────────────────────────────────────────────────────────────────
export const enum ResourceType {
  GOLD   = 'gold',
  LUMBER = 'lumber',
}

export interface ResourceNode {
  id: string
  type: ResourceType
  tileX: number
  tileZ: number
  amount: number
  maxAmount: number
  mesh: THREE.Mesh
  depleted: boolean
}

export interface LootPile {
  id: string
  x: number
  z: number
  type: ResourceType
  amount: number
  mesh: THREE.Mesh
  spawnTick: number
  rotation: number
}

// ── Buildings ─────────────────────────────────────────────────────────────────
export const enum BuildingType {
  TOWN_HALL = 'town_hall',
  BARRACKS  = 'barracks',
  FARM      = 'farm',
  TOWER     = 'tower',
}

export const enum UnitType {
  WORKER  = 'worker',
  FOOTMAN = 'footman',
  ARCHER  = 'archer',
}

export interface TrainingQueueItem {
  unitType: UnitType
  timer: number
  duration: number
}

export interface Building {
  id: string
  type: BuildingType
  playerId: number
  tileX: number
  tileZ: number
  mesh: THREE.Mesh
  hp: number
  maxHp: number
  hpFill: THREE.Mesh
  destroyed: boolean
  trainingQueue: TrainingQueueItem[]
  // Construction
  underConstruction: boolean
  buildProgress: number     // 0..1
  builderId: string | null  // worker ID currently building
  // Tower
  attackCooldown: number
  level: number
  upgrading: boolean
  upgradeProgress: number
  upgradeTime: number
}

// ── Units (Workers / Footmen / Archers) ───────────────────────────────────────
export const enum WorkerState {
  IDLE                = 'IDLE',
  MOVING_TO_TARGET    = 'MOVING_TO_TARGET',
  MOVING_TO_RESOURCE  = 'MOVING_TO_RESOURCE',
  GATHERING           = 'GATHERING',
  MOVING_TO_TOWNHALL  = 'MOVING_TO_TOWNHALL',
  DEPOSITING          = 'DEPOSITING',
  MOVING_TO_ATTACK    = 'MOVING_TO_ATTACK',
  ATTACKING           = 'ATTACKING',
  BUILDING            = 'BUILDING',
}

export interface Worker {
  id: string
  playerId: number
  unitType: UnitType
  state: WorkerState
  x: number
  z: number
  targetTileX: number
  targetTileZ: number
  path: Array<{ x: number; z: number }>
  pathIndex: number
  // gathering (workers only)
  targetResourceId: string | null
  lastResourceId: string | null
  gatherTileX: number
  gatherTileZ: number
  carryType: ResourceType | null
  carryAmount: number
  maxCarry: number
  gatherTimer: number
  depositTimer: number
  // combat
  hp: number
  maxHp: number
  attackTargetId: string | null
  attackTargetBuildingId: string | null
  attackCooldown: number
  lastDamagedTick: number   // game tick when last took damage (for HP regen)
  // construction (workers only)
  buildTargetBuildingId: string | null
  // movement
  speed: number
  attackMove: boolean       // true when in attack-move mode
  // death animation
  deathAnimTimer: number    // > 0: playing death shrink anim
  dead: boolean
  xp: number
  level: number
  levelMesh: THREE.Mesh | null
  attackCount: number
  // three.js
  mesh: THREE.Mesh
  selectionRing: THREE.Mesh
  carryIndicator: THREE.Mesh
  hpFill: THREE.Mesh
  pathLine: THREE.Line | null
  selected: boolean
}

// ── Projectiles ───────────────────────────────────────────────────────────────
export interface ProjectileRequest {
  fromX: number
  fromY: number
  fromZ: number
  targetId: string | null
  targetBuildingId: string | null
  damage: number
  speed: number
  fromPlayerId: number
  fromWorkerId: string | null
}

export interface Projectile {
  id: string
  fromPlayerId: number
  x: number
  y: number
  z: number
  targetId: string | null
  targetBuildingId: string | null
  damage: number
  speed: number
  mesh: THREE.Mesh
  done: boolean
  fromWorkerId: string | null
}

// ── Game State ────────────────────────────────────────────────────────────────
export interface Resources {
  gold: number
  lumber: number
}

export interface GameState {
  map: Tile[][]
  workers: Worker[]
  buildings: Building[]
  resources: ResourceNode[]
  projectiles: Projectile[]
  lootPiles: LootPile[]
  playerResources: [Resources, Resources]
  playerSupply: [number, number]
  playerSupplyMax: [number, number]
  selectedWorkerIds: Set<string>
  currentPlayerId: number
  tick: number
  paused: boolean
}

// ── Input Commands ─────────────────────────────────────────────────────────────
export const enum CommandType {
  MOVE_TO_TILE     = 'MOVE_TO_TILE',
  GATHER_RESOURCE  = 'GATHER_RESOURCE',
  ATTACK_UNIT      = 'ATTACK_UNIT',
  ATTACK_BUILDING  = 'ATTACK_BUILDING',
  ATTACK_MOVE        = 'ATTACK_MOVE',
  BUILD              = 'BUILD',
  UPGRADE_BUILDING   = 'UPGRADE_BUILDING',
  TRAIN_UNIT         = 'TRAIN_UNIT',
}

export interface MoveCommand {
  type: CommandType.MOVE_TO_TILE
  workerIds: string[]
  tileX: number
  tileZ: number
}

export interface GatherCommand {
  type: CommandType.GATHER_RESOURCE
  workerIds: string[]
  resourceId: string
}

export interface AttackCommand {
  type: CommandType.ATTACK_UNIT
  workerIds: string[]
  targetWorkerId: string
}

export interface AttackBuildingCommand {
  type: CommandType.ATTACK_BUILDING
  workerIds: string[]
  targetBuildingId: string
}

export interface AttackMoveCommand {
  type: CommandType.ATTACK_MOVE
  workerIds: string[]
  tileX: number
  tileZ: number
}

export interface BuildCommand {
  type: CommandType.BUILD
  workerIds: string[]
  buildingType: BuildingType
  tileX: number
  tileZ: number
}

export interface UpgradeBuildingCommand {
  type: CommandType.UPGRADE_BUILDING
  buildingId: string
}

export interface TrainUnitCommand {
  type: CommandType.TRAIN_UNIT
  buildingId: string
  unitType: UnitType
}

export type GameCommand =
  | MoveCommand
  | GatherCommand
  | AttackCommand
  | AttackBuildingCommand
  | AttackMoveCommand
  | BuildCommand
  | UpgradeBuildingCommand
  | TrainUnitCommand

// ── HUD ───────────────────────────────────────────────────────────────────────
export interface BuildingInfo {
  id: string
  playerId: number
  type: BuildingType
  hp: number
  maxHp: number
  trainingQueue: TrainingQueueItem[]
  underConstruction: boolean
  buildProgress: number
  level: number
  upgrading: boolean
  upgradeProgress: number
}

export interface HUDUpdate {
  gold: number
  lumber: number
  fps: number
  workerCount: number
  goldMinesRemaining: number
  treesRemaining: number
  selectedWorkers: SelectedWorkerInfo[]
  allWorkers: SelectedWorkerInfo[]
  buildings: BuildingInfo[]
  playerSupply: number
  playerSupplyMax: number
  cameraX: number
  cameraZ: number
  lastRaycastTile: { x: number; z: number } | null
  currentPlayerId: number
}

export interface SelectedWorkerInfo {
  id: string
  playerId: number
  unitType: UnitType
  state: WorkerState
  carryType: ResourceType | null
  carryAmount: number
  maxCarry: number
  tileX: number
  tileZ: number
  pathLength: number
  hp: number
  maxHp: number
  xp: number
  level: number
  maxXp: number
}
