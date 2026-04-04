import { ethers } from 'ethers'
import type { Request, Response, NextFunction } from 'express'
import { q } from './db.js'

const PLATFORM_ADDRESS = (process.env.PLATFORM_ADDRESS ?? '0x0000000000000000000000000000000000000000').toLowerCase()
const SEPOLIA_RPC_URL  = process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org'

/**
 * When CHAIN=local the backend is running against a local Hardhat node.
 * Skip on-chain tx verification — payment is accepted if `X-Payment` is any
 * non-empty string (use any dummy value in dev).
 */
const LOCAL_MODE = process.env.CHAIN === 'local'
if (LOCAL_MODE) console.log('[x402] LOCAL mode — payment verification bypassed')

export const FEES = {
  register:         ethers.parseEther('0.001'),
  matchmaking_join: ethers.parseEther('0.01'),   // wager amount locked at pool entry
}

let _provider: ethers.JsonRpcProvider | null = null
function provider(): ethers.JsonRpcProvider {
  if (!_provider) _provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL)
  return _provider
}

export interface VerifiedPayment {
  txHash: string
  fromAddr: string
  amountWei: bigint
}

export async function verifyPayment(txHash: string, requiredWei: bigint): Promise<VerifiedPayment> {
  // Replay protection
  if (q.getPaymentByHash.get(txHash)) throw new Error('Payment already used')

  const tx = await provider().getTransaction(txHash)
  if (!tx) throw new Error('Transaction not found on Sepolia')
  if (!tx.blockNumber) throw new Error('Transaction not yet confirmed')

  const latest = await provider().getBlockNumber()
  if (latest - tx.blockNumber < 1) throw new Error('Needs at least 1 confirmation')

  if (!tx.to || tx.to.toLowerCase() !== PLATFORM_ADDRESS)
    throw new Error(`Payment not sent to platform address ${PLATFORM_ADDRESS}`)

  if (tx.value < requiredWei)
    throw new Error(`Insufficient: got ${tx.value} wei, need ${requiredWei} wei`)

  return { txHash, fromAddr: tx.from.toLowerCase(), amountWei: tx.value }
}

function paymentInstructions(purpose: string, requiredWei: bigint, resource: string) {
  return {
    x402Version: 1,
    error: 'Payment required',
    accepts: [{
      scheme: 'ethereum',
      network: 'sepolia',
      maxAmountRequired: requiredWei.toString(),
      to: PLATFORM_ADDRESS,
      description: `Clanker Pit: ${purpose}`,
      resource,
    }],
  }
}

export function requirePayment(purpose: keyof typeof FEES) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requiredWei = FEES[purpose]
    const txHash = req.headers['x-payment'] as string | undefined

    if (!txHash) {
      return res.status(402).json(paymentInstructions(purpose, requiredWei, req.originalUrl))
    }

    // Local Hardhat dev mode: skip on-chain verification
    if (LOCAL_MODE) {
      res.locals.payment = {
        txHash,
        fromAddr:  (req.headers['x-from-address'] as string | undefined) ?? '0x' + '0'.repeat(40),
        amountWei: requiredWei,
      }
      return next()
    }

    try {
      const payment = await verifyPayment(txHash, requiredWei)
      res.locals.payment = payment
      next()
    } catch (err) {
      res.status(402).json({
        ...paymentInstructions(purpose, requiredWei, req.originalUrl),
        error: (err as Error).message,
      })
    }
  }
}
