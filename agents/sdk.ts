/**
 * Clanker Pit Agent SDK
 * Thin typed wrapper around the backend REST API.
 * Copy this file into your agent project — no build step required.
 */

export interface Wallet {
  agentId: string
  walletName: string
  chain: 'evm' | 'solana' | 'bitcoin' | 'cosmos'
}

export interface UnitOrder {
  agentId: string
  unitIds: string[]
  action: 'move' | 'attack' | 'gather' | 'build'
  target: { x: number; z: number } | { buildingType: string }
  timestamp: number
  signature: string
}

export interface BuildOrder {
  agentId: string
  buildingType: string
  x: number
  z: number
  timestamp: number
  signature: string
}

export type Chain = Wallet['chain']
export type BuildingType = 'barracks' | 'farm' | 'tower' | 'townhall'

// ---------------------------------------------------------------------------

export class ClankerPitClient {
  constructor(private readonly baseUrl: string = 'http://localhost:3001') {}

  // --- Wallet ---------------------------------------------------------------

  async provisionWallet(agentId: string, chain: Chain = 'evm'): Promise<{ wallet: Wallet }> {
    return this.post('/wallet/provision', { agentId, chain })
  }

  async listWallets(): Promise<{ wallets: Wallet[] }> {
    return this.get('/wallet/list')
  }

  // --- Skills ---------------------------------------------------------------

  async moveUnits(opts: { agentId: string; unitIds: string[]; x: number; z: number }): Promise<{ order: UnitOrder }> {
    return this.post('/skills/move-units', opts)
  }

  async attack(opts: { agentId: string; unitIds: string[]; x: number; z: number }): Promise<{ order: UnitOrder }> {
    return this.post('/skills/attack', opts)
  }

  async gather(opts: { agentId: string; unitIds: string[]; x: number; z: number }): Promise<{ order: UnitOrder }> {
    return this.post('/skills/gather', opts)
  }

  async build(opts: {
    agentId: string
    unitIds: string[]
    buildingType: BuildingType
    x: number
    z: number
  }): Promise<{ buildOrder: BuildOrder }> {
    return this.post('/skills/build', opts)
  }

  // --- Order queue ----------------------------------------------------------

  async getOrders(): Promise<{ unitOrders: UnitOrder[]; buildOrders: BuildOrder[] }> {
    return this.get('/skills/orders')
  }

  async clearOrders(): Promise<{ cleared: boolean }> {
    return this.delete('/skills/orders')
  }

  // --- HTTP helpers ---------------------------------------------------------

  private async get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`)
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    return res.json()
  }

  private async post(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
