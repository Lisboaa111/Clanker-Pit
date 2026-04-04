/**
 * OWS (Open Wallet Standard) helpers.
 * Wraps @open-wallet-standard/core (sync NAPI-RS) for per-agent wallet management.
 * Falls back to a deterministic stub when the native binary is unavailable (win32-x64).
 */
import { createHash, createHmac } from 'node:crypto'

// ---------------------------------------------------------------------------
// OWS types (matches index.d.ts)
// ---------------------------------------------------------------------------
interface AccountInfo { chainId: string; address: string; derivationPath: string }
interface WalletInfo  { id: string; name: string; accounts: AccountInfo[]; createdAt: string }
interface SignResult  { signature: string; recoveryId?: number }

interface OWSCore {
  createWallet(name: string): WalletInfo
  signMessage(wallet: string, chain: string, message: string): SignResult
  listWallets(): WalletInfo[]
  signAndSend(wallet: string, chain: string, txHex: string,
    passphrase?: string, index?: number, rpcUrl?: string): { txHash: string }
}

// ---------------------------------------------------------------------------
// Load native module; fall back to stub on Windows (win32-x64 not yet on npm)
// ---------------------------------------------------------------------------
let ows: OWSCore

try {
  // Static import would crash the process if binary is missing — use dynamic
  const mod = await import('@open-wallet-standard/core') as OWSCore
  ows = mod
  console.log('[ows] Native @open-wallet-standard/core loaded.')
} catch {
  console.warn(
    '[ows] Native binary unavailable — using deterministic stub. ' +
    'DO NOT use in production.',
  )
  ows = makeStub()
}

function makeStub(): OWSCore {
  const store = new Map<string, WalletInfo>()
  return {
    createWallet(name: string): WalletInfo {
      const hash    = createHash('sha256').update(name).digest('hex')
      const address = '0x' + hash.slice(0, 40)
      const info: WalletInfo = {
        id: hash.slice(0, 16),
        name,
        accounts: [
          { chainId: 'eip155:1',       address,                             derivationPath: "m/44'/60'/0'/0/0" },
          { chainId: 'solana:mainnet', address: hash.slice(0, 44),          derivationPath: "m/44'/501'/0'/0'" },
          { chainId: 'bip122:000000000019d6689c085ae165831e93', address: '1' + hash.slice(0, 33), derivationPath: "m/44'/0'/0'/0/0" },
          { chainId: 'cosmos:cosmoshub-4', address: 'cosmos1' + hash.slice(0, 38), derivationPath: "m/44'/118'/0'/0/0" },
        ],
        createdAt: new Date().toISOString(),
      }
      store.set(name, info)
      return info
    },
    signMessage(wallet: string, _chain: string, message: string): SignResult {
      const sig = '0x' + createHmac('sha256', wallet).update(message).digest('hex').repeat(2).slice(0, 130)
      return { signature: sig }
    },
    listWallets(): WalletInfo[] { return Array.from(store.values()) },
    signAndSend(wallet: string, _chain: string, _txHex: string): { txHash: string } {
      const txHash = '0x' + createHash('sha256').update(wallet + Date.now()).digest('hex')
      return { txHash }
    },
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export type Chain = 'evm' | 'solana' | 'bitcoin' | 'cosmos'

export interface AgentWallet {
  agentId: string
  walletName: string
  chain: Chain
  address: string
}

const CHAIN_ID: Record<Chain, string> = {
  evm:     'eip155:1',
  solana:  'solana:mainnet',
  bitcoin: 'bip122:000000000019d6689c085ae165831e93',
  cosmos:  'cosmos:cosmoshub-4',
}

const registry = new Map<string, AgentWallet>()

export async function ensureAgentWallet(agentId: string, chain: Chain = 'evm'): Promise<AgentWallet> {
  if (registry.has(agentId)) return registry.get(agentId)!

  const walletName = `clanker-pit-agent-${agentId}`
  const info       = ows.createWallet(walletName)
  const account    = info.accounts.find(a => a.chainId === CHAIN_ID[chain]) ?? info.accounts[0]

  const entry: AgentWallet = { agentId, walletName, chain, address: account.address }
  registry.set(agentId, entry)
  return entry
}

export async function signAgentPayload(agentId: string, payload: string): Promise<string> {
  const wallet = await ensureAgentWallet(agentId)
  return ows.signMessage(wallet.walletName, wallet.chain, payload).signature
}

/** Sign and broadcast a tx on-chain. Returns tx hash. */
export async function sendAgentTx(
  agentId: string,
  chain: Chain,
  txHex: string,
  rpcUrl?: string,
): Promise<string> {
  const wallet = await ensureAgentWallet(agentId, chain)
  return ows.signAndSend(wallet.walletName, chain, txHex, undefined, undefined, rpcUrl).txHash
}

export function listAgentWallets(): AgentWallet[] {
  return Array.from(registry.values())
}
