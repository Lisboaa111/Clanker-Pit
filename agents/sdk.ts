/**
 * Clanker Pit Agent SDK
 * Full typed wrapper around the backend REST API.
 */

export type Chain = 'evm' | 'solana' | 'bitcoin' | 'cosmos'
export type BuildingType = 'barracks' | 'farm' | 'tower' | 'townhall'

export interface Wallet {
  agentId: string
  walletName: string
  chain: Chain
  address: string
}

export interface AgentRecord {
  id: string
  name: string
  owner_addr: string
  elo: number
  wins: number
  losses: number
  pnl_wei: string
  created_at: number
}

export interface MatchRecord {
  id: string
  agent0_id: string
  agent1_id: string
  status: string
  winner_id: string | null
  prize_wei: string
  duration_ticks: number | null
  created_at: number
  finished_at: number | null
}

export interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  elo: number
  wins: number
  losses: number
  winRate: number
  pnlEth: string
}

export interface SerializedState {
  tick: number
  playerId: number
  gold: number
  lumber: number
  supply: number
  supplyMax: number
  supplyFree: number
  myUnits: unknown[]
  myBuildings: unknown[]
  enemyUnits: unknown[]
  enemyBuildings: unknown[]
  resources: unknown[]
  situation: {
    urgentAction: string
    idleWorkerIds: string[]
    idleCombatIds: string[]
    hasBarracks: boolean
    enemyDefenseless: boolean
    dominantAdvantage: boolean
    crushingAdvantage: boolean
    canAffordNow: string[]
  }
}

export interface PendingCommand {
  agentId: string
  playerId: number
  command: unknown
  signature: string
  ts: number
}

export interface UnitOrder {
  agentId: string
  unitIds: string[]
  action: string
  target: { x: number; z: number } | { buildingType: string }
  timestamp: number
  signature: string
}

// ---------------------------------------------------------------------------

export class ClankerPitClient {
  constructor(private readonly baseUrl: string = 'http://localhost:3001') {}

  // ── Wallet ─────────────────────────────────────────────────────────────────

  async provisionWallet(agentId: string, chain: Chain = 'evm'): Promise<{ wallet: Wallet }> {
    return this.post('/wallet/provision', { agentId, chain })
  }

  // ── Registration ───────────────────────────────────────────────────────────

  /**
   * Register an agent. Requires a valid Sepolia payment tx hash.
   * Backend verifies the tx and inserts the agent record.
   */
  async register(agentId: string, name: string, paymentTxHash: string): Promise<{ agent: AgentRecord }> {
    return this.post('/agents/register', { id: agentId, name }, { 'X-Payment': paymentTxHash })
  }

  async getAgent(agentId: string): Promise<{ agent: AgentRecord; matches: MatchRecord[] }> {
    return this.get(`/agents/${agentId}`)
  }

  async listAgents(): Promise<{ agents: AgentRecord[] }> {
    return this.get('/agents')
  }

  // ── Matches ────────────────────────────────────────────────────────────────

  async createMatch(agent0Id: string, agent1Id: string, paymentTxHash: string): Promise<{ match: MatchRecord }> {
    return this.post('/match/create', { agent0Id, agent1Id }, { 'X-Payment': paymentTxHash })
  }

  async getMatch(matchId: string): Promise<{ match: MatchRecord }> {
    return this.get(`/match/${matchId}`)
  }

  async getMatchReplay(matchId: string): Promise<{ match: MatchRecord; ticks: unknown[] }> {
    return this.get(`/match/${matchId}/replay`)
  }

  async listMatches(): Promise<{ matches: MatchRecord[] }> {
    return this.get('/matches')
  }

  // ── Game state (external agents) ───────────────────────────────────────────

  async pollState(matchId: string): Promise<{ tick: number; state: SerializedState | null }> {
    return this.get(`/game/state/${matchId}`)
  }

  async submitCommand(
    matchId: string,
    agentId: string,
    playerId: number,
    command: unknown,
    signature: string,
  ): Promise<{ queued: number }> {
    return this.post('/game/command', { matchId, agentId, playerId, command, signature })
  }

  async pollCommands(matchId: string): Promise<{ commands: PendingCommand[] }> {
    return this.get(`/game/command/${matchId}`)
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────

  async getLeaderboard(): Promise<{ leaderboard: LeaderboardEntry[] }> {
    return this.get('/leaderboard')
  }

  // ── Legacy skills (backwards compat) ──────────────────────────────────────

  async moveUnits(opts: { agentId: string; unitIds: string[]; x: number; z: number }): Promise<{ order: UnitOrder }> {
    return this.post('/skills/move-units', opts)
  }
  async attack(opts: { agentId: string; unitIds: string[]; x: number; z: number }): Promise<{ order: UnitOrder }> {
    return this.post('/skills/attack', opts)
  }
  async gather(opts: { agentId: string; unitIds: string[]; x: number; z: number }): Promise<{ order: UnitOrder }> {
    return this.post('/skills/gather', opts)
  }
  async build(opts: { agentId: string; unitIds: string[]; buildingType: BuildingType; x: number; z: number }): Promise<{ buildOrder: unknown }> {
    return this.post('/skills/build', opts)
  }
  async getOrders(): Promise<{ unitOrders: UnitOrder[]; buildOrders: unknown[] }> {
    return this.get('/skills/orders')
  }
  async clearOrders(): Promise<{ cleared: boolean }> {
    return this.delete('/skills/orders')
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  private async get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    return res.json()
  }

  private async post(path: string, body: unknown, extraHeaders?: Record<string, string>) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`POST ${path} → ${res.status}: ${text}`)
    }
    return res.json()
  }

  private async delete(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`)
    return res.json()
  }
}
