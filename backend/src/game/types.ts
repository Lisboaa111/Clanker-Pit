// ── Server-side game types (no Three.js / browser deps) ──────────────────────

export type UnitType     = 'Worker' | 'Footman' | 'Archer'
export type BuildingType = 'TownHall' | 'Barracks' | 'Farm' | 'Tower'
export type UnitState    = 'idle' | 'moving' | 'gathering' | 'attacking' | 'returning'

export interface Unit {
  id: string
  playerId: number
  type: UnitType
  tx: number     // tile-x
  tz: number     // tile-z
  hp: number
  maxHp: number
  level: number
  state: UnitState
  attackCooldown: number
  gatherTimer: number
  carrying: number          // gold being carried
  targetUnitId:     string | null
  targetBuildingId: string | null
  targetResourceId: string | null
  targetTx: number | null
  targetTz: number | null
}

export interface Building {
  id: string
  playerId: number
  type: BuildingType
  tx: number
  tz: number
  hp: number
  maxHp: number
  level: number
  underConstruction: boolean
  buildTicksLeft: number
  upgrading: boolean
  trainingQueue: Array<{ unit: UnitType; ticksLeft: number; totalTicks: number }>
  attackCooldown: number
}

export interface Resource {
  id: string
  type: 'gold' | 'lumber'
  tx: number
  tz: number
  amount: number
}

export interface GameState {
  tick: number
  units: Unit[]
  buildings: Building[]
  resources: Resource[]
  players: [PlayerResources, PlayerResources]
  winnerId: number | null
  finishedAt: number | null
}

export interface PlayerResources {
  gold: number
  lumber: number
}

export type AgentCommand =
  | { type: 'GATHER';          unitIds: string[]; resourceId: string }
  | { type: 'ATTACK_MOVE';     unitIds: string[]; tx: number; tz: number }
  | { type: 'ATTACK_BUILDING'; unitIds: string[]; targetId: string }
  | { type: 'ATTACK';          unitIds: string[]; targetId: string }
  | { type: 'TRAIN';           buildingId: string; unit: UnitType }
  | { type: 'BUILD';           unitIds: string[]; building: 'barracks' | 'farm'; tx: number; tz: number }

export interface CommandEnvelope {
  agentId:   string
  playerId:  number
  command:   AgentCommand
  signature: string
  ts:        number
}

// Serialized state sent to agents / frontend
export interface SerializedState {
  tick: number
  playerId: number
  gold: number
  lumber: number
  supply: number
  supplyMax: number
  supplyFree: number
  myBaseCenter: { tx: number; tz: number }
  suggestedBuildSpots: Array<{ tx: number; tz: number }>
  myUnits: SerializedUnit[]
  myBuildings: SerializedBuilding[]
  enemyUnits: SerializedEnemyUnit[]
  enemyBuildings: SerializedEnemyBuilding[]
  resources: SerializedResource[]
  lootPiles: never[]
  situation: Situation
}

export interface SerializedUnit {
  id: string; type: string; tx: number; tz: number
  hp: number; maxHp: number; state: string; level: number
  busy: boolean; carry: { type: string; amount: number } | null
}

export interface SerializedBuilding {
  id: string; type: string; tx: number; tz: number
  hp: number; maxHp: number; level: number
  underConstruction: boolean; upgrading: boolean
  trainingQueue: Array<{ unit: string; progress: number }>
}

export interface SerializedEnemyUnit   { id: string; type: string; tx: number; tz: number; hp: number; level: number }
export interface SerializedEnemyBuilding { id: string; type: string; tx: number; tz: number; hp: number; maxHp: number }

export interface SerializedResource { id: string; type: string; tx: number; tz: number; amount: number }

export interface Situation {
  urgentAction:         string
  idleWorkerIds:        string[]
  idleCombatIds:        string[]
  hasBarracks:          boolean
  enemyDefenseless:     boolean
  dominantAdvantage:    boolean
  crushingAdvantage:    boolean
  canAffordNow:         string[]
  underAttack:          boolean
  enemiesNearBaseCount: number
  nearestEnemyDist:     number
  myTHHpPct:            number
  enemyTHHpPct:         number
  myWorkerCount:        number
  myCombatCount:        number
  enemyCombatCount:     number
  totalResources:       number
  recommendedActions:   string[]
}
