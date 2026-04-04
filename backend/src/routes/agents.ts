import { Router } from 'express'
import { z } from 'zod'
import { ethers } from 'ethers'
import { q, type AgentRow, type MatchRow } from '../db.js'
import { requirePayment } from '../x402.js'

export const agentsRouter = Router()

// ELO helper
function calcElo(a: number, b: number, aWon: boolean): [number, number] {
  const K    = 32
  const expA = 1 / (1 + 10 ** ((b - a) / 400))
  const newA = Math.round(a + K * ((aWon ? 1 : 0) - expA))
  const newB = Math.round(b + K * ((aWon ? 0 : 1) - (1 - expA)))
  return [newA, newB]
}

export { calcElo }

const ARENA_ADDRESS        = process.env.ARENA_ADDRESS ?? ''
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? ''
const SEPOLIA_RPC_URL      = process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'

const ARENA_ABI = [
  'function registerAgent(bytes32 agentId, address agentOwnerAddr) external payable',
]

/**
 * Call arena.registerAgent() on-chain.
 * The platform wallet pays the 0.001 ETH fee; the agent's wallet is recorded as owner.
 * Fire-and-forget — DB record is the source of truth, chain record is bonus.
 */
async function registerAgentOnChain(agentId: string, ownerAddr: string) {
  if (!ARENA_ADDRESS || !DEPLOYER_PRIVATE_KEY) {
    console.warn('[contract] ARENA_ADDRESS or DEPLOYER_PRIVATE_KEY not set — skipping on-chain registration')
    return
  }
  try {
    const provider   = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL)
    const signer     = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider)
    const arena      = new ethers.Contract(ARENA_ADDRESS, ARENA_ABI, signer)
    const agentIdB32 = ethers.id(agentId)  // keccak256(agentId) → bytes32
    const tx = await arena.registerAgent(agentIdB32, ownerAddr, {
      value: ethers.parseEther('0.001'),
    })
    await tx.wait()
    console.log(`[contract] agent ${agentId} registered on-chain (tx ${tx.hash})`)
  } catch (err) {
    console.error('[contract] registerAgent failed:', (err as Error).message)
  }
}

/**
 * POST /agents/register
 * x402 gated — requires X-Payment header with a verified tx.
 * In CHAIN=local mode any non-empty X-Payment is accepted.
 */
agentsRouter.post('/register', requirePayment('register'), async (req, res) => {
  const schema = z.object({
    id:   z.string().min(1).max(64).regex(/^[\w-]+$/),
    name: z.string().min(1).max(80),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })

  const { id, name } = parsed.data
  const payment = res.locals.payment as { txHash: string; fromAddr: string; amountWei: bigint }

  const existing = q.getAgent.get(id) as AgentRow | undefined
  if (existing) return res.status(409).json({ error: 'Agent ID already registered' })

  q.insertAgent.run(id, name, payment.fromAddr)
  q.insertPayment.run(payment.txHash, payment.fromAddr, payment.amountWei.toString(), 'register', null)

  // Register on-chain asynchronously (non-blocking)
  registerAgentOnChain(id, payment.fromAddr).catch(console.error)

  res.status(201).json({ ok: true, agent: q.getAgent.get(id) })
})

/** GET /agents */
agentsRouter.get('/', (_req, res) => {
  const agents = q.listAgents.all() as AgentRow[]
  res.json({ ok: true, agents })
})

/** GET /agents/:id */
agentsRouter.get('/:id', (req, res) => {
  const agent = q.getAgent.get(req.params.id) as AgentRow | undefined
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const matches = q.matchesByAgent.all(agent.id, agent.id) as MatchRow[]
  res.json({ ok: true, agent, matches: matches.slice(0, 20) })
})

/** GET /agents/:id/matches */
agentsRouter.get('/:id/matches', (req, res) => {
  const agent = q.getAgent.get(req.params.id) as AgentRow | undefined
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const matches = q.matchesByAgent.all(agent.id, agent.id) as MatchRow[]
  res.json({ ok: true, matches })
})
