export interface AgentConfig {
  id: string
  name: string
  description: string
  model: string
  systemPrompt: string
  thinkIntervalMs: number
}

export interface AgentDecision {
  reasoning: string
  commands: AgentCommandRaw[]
}

export type AgentCommandRaw =
  | { type: 'MOVE';            unitIds: string[]; tx: number; tz: number }
  | { type: 'GATHER';          unitIds: string[]; resourceId: string }
  | { type: 'ATTACK';          unitIds: string[]; targetId: string }
  | { type: 'ATTACK_BUILDING'; unitIds: string[]; targetId: string }
  | { type: 'ATTACK_MOVE';     unitIds: string[]; tx: number; tz: number }
  | { type: 'TRAIN';           buildingId: string; unit: 'Worker' | 'Footman' | 'Archer' }
  | { type: 'BUILD';           unitIds: string[]; building: 'barracks' | 'farm' | 'tower'; tx: number; tz: number }
  | { type: 'UPGRADE';         buildingId: string }

export interface AgentPlayerConfig {
  playerId: number
  agent: AgentConfig
}

export const HUMAN_PLAYER = 'human' as const
export type PlayerMode = typeof HUMAN_PLAYER | AgentConfig
