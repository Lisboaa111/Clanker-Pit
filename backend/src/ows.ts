/**
 * OWS (Open Wallet Standard) helpers.
 * Wraps @open-wallet-standard/core to provide per-agent wallet management
 * and message signing for the Clanker Pit RTS agent skill system.
 */
import { createWallet, signMessage } from '@open-wallet-standard/core'

export type Chain = 'evm' | 'solana' | 'bitcoin' | 'cosmos'

export interface AgentWallet {
  agentId: string
  walletName: string
  chain: Chain
}

/** In-memory registry of created agent wallets (persists for process lifetime). */
const registry = new Map<string, AgentWallet>()

/**
 * Provision a wallet for an agent if one doesn't exist yet.
 * Returns the wallet descriptor.
 */
export async function ensureAgentWallet(agentId: string, chain: Chain = 'evm'): Promise<AgentWallet> {
  if (registry.has(agentId)) return registry.get(agentId)!

  const walletName = `clanker-pit-agent-${agentId}`
  await createWallet(walletName)

  const entry: AgentWallet = { agentId, walletName, chain }
  registry.set(agentId, entry)
  return entry
}

/**
 * Sign an arbitrary payload with the agent's wallet.
 * Used to authenticate agent actions on-chain (game events, bets, etc.).
 */
export async function signAgentPayload(agentId: string, payload: string): Promise<string> {
  const wallet = await ensureAgentWallet(agentId)
  const result = await signMessage(wallet.walletName, wallet.chain, payload)
  return result.signature
}

/** List all provisioned agent wallets. */
export function listAgentWallets(): AgentWallet[] {
  return Array.from(registry.values())
}
