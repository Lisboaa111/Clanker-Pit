/**
 * OWS (Open Wallet Standard) helpers.
 * Wraps @open-wallet-standard/core to provide per-agent wallet management
 * and message signing for the Clanker Pit RTS agent skill system.
 *
 * NOTE: @open-wallet-standard/core is a native NAPI-RS module.
 * The win32-x64 binary is not yet published to npm (only darwin/linux builds exist).
 * On Windows we fall back to a deterministic stub so the backend still runs.
 */

import { createHash, createHmac } from 'crypto'

// ---------------------------------------------------------------------------
// Load OWS — graceful fallback if native binary is missing (Windows dev)
// ---------------------------------------------------------------------------
let ows: typeof import('@open-wallet-standard/core') | null = null
try {
  ows = await import('@open-wallet-standard/core')
} catch {
  console.warn(
    '[ows] @open-wallet-standard/core native binary not available on this platform. ' +
    'Using deterministic stub — DO NOT use in production.',
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Chain = 'evm' | 'solana' | 'bitcoin' | 'cosmos'

export interface AgentWallet {
  agentId: string
  walletName: string
  chain: Chain
  address: string   // derived address for the chosen chain
}

/** In-memory registry — persists for process lifetime. */
const registry = new Map<string, AgentWallet>()

// ---------------------------------------------------------------------------
// Stub helpers (Windows / no native binary)
// ---------------------------------------------------------------------------
function stubAddress(name: string, chain: Chain): string {
  const hash = createHash('sha256').update(`${name}:${chain}`).digest('hex')
  if (chain === 'evm')     return '0x' + hash.slice(0, 40)
  if (chain === 'solana')  return hash.slice(0, 44)
  if (chain === 'bitcoin') return '1' + hash.slice(0, 33)
  return hash.slice(0, 45)   // cosmos
}

function stubSign(walletName: string, chain: Chain, message: string): string {
  return createHmac('sha256', `${walletName}:${chain}`).update(message).digest('hex')
}

// ---------------------------------------------------------------------------
// Chain ID for OWS (CAIP-2 format)
// ---------------------------------------------------------------------------
const CHAIN_ID: Record<Chain, string> = {
  evm:     'eip155:1',
  solana:  'solana:mainnet',
  bitcoin: 'bip122:000000000019d6689c085ae165831e93',
  cosmos:  'cosmos:cosmoshub-4',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Provision a wallet for an agent if one doesn't exist yet.
 * Uses OWS createWallet if available; stubs otherwise.
 */
export async function ensureAgentWallet(agentId: string, chain: Chain = 'evm'): Promise<AgentWallet> {
  if (registry.has(agentId)) return registry.get(agentId)!

  const walletName = `clanker-pit-agent-${agentId}`
  let address: string

  if (ows) {
    const info = ows.createWallet(walletName)
    const account = info.accounts.find(a => a.chainId === CHAIN_ID[chain])
    address = account?.address ?? info.accounts[0].address
  } else {
    address = stubAddress(walletName, chain)
  }

  const entry: AgentWallet = { agentId, walletName, chain, address }
  registry.set(agentId, entry)
  return entry
}

/**
 * Sign an arbitrary payload string with the agent's wallet.
 * Returns a hex-encoded signature.
 */
export async function signAgentPayload(agentId: string, payload: string): Promise<string> {
  const wallet = await ensureAgentWallet(agentId)

  if (ows) {
    const result = ows.signMessage(wallet.walletName, wallet.chain, payload)
    return result.signature
  }

  return stubSign(wallet.walletName, wallet.chain, payload)
}

/** List all provisioned agent wallets. */
export function listAgentWallets(): AgentWallet[] {
  return Array.from(registry.values())
}
