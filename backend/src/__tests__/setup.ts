/**
 * Test setup: use an in-memory SQLite database so tests are isolated.
 * Import this before any module that imports db.ts.
 */
import { vi } from 'vitest'

// Run tests in local mode so deposit verification skips RPC calls.
// ARENA_ADDRESS is intentionally left empty so on-chain register/settle are skipped.
process.env.CHAIN = 'local'
delete process.env.ARENA_ADDRESS
delete process.env.DEPLOYER_PRIVATE_KEY

// Patch db path to :memory: before the module is loaded
vi.mock('../db.js', async () => {
  const Database = (await import('better-sqlite3')).default
  const db = new Database(':memory:')

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_addr TEXT NOT NULL,
      elo REAL NOT NULL DEFAULT 1200, wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0, pnl_wei TEXT NOT NULL DEFAULT '0',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY, agent0_id TEXT NOT NULL, agent1_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_deposit', winner_id TEXT,
      wager_wei TEXT NOT NULL DEFAULT '0', prize_wei TEXT NOT NULL DEFAULT '0',
      deposit0_addr TEXT, deposit1_addr TEXT, deposit0_tx TEXT, deposit1_tx TEXT,
      duration_ticks INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch()), finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS match_participants (
      match_id TEXT NOT NULL, agent_id TEXT NOT NULL, player_idx INTEGER NOT NULL,
      elo_before REAL NOT NULL, elo_after REAL, PRIMARY KEY (match_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS match_ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL,
      tick INTEGER NOT NULL, player_id INTEGER NOT NULL, commands TEXT NOT NULL,
      state_snap TEXT, ts INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_match_ticks ON match_ticks(match_id, tick);
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tx_hash TEXT NOT NULL UNIQUE,
      from_addr TEXT NOT NULL, amount_wei TEXT NOT NULL, purpose TEXT NOT NULL,
      match_id TEXT, verified_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `)

  const q = {
    insertAgent:  db.prepare(`INSERT INTO agents (id, name, owner_addr) VALUES (?, ?, ?)`),
    getAgent:     db.prepare(`SELECT * FROM agents WHERE id = ?`),
    listAgents:   db.prepare(`SELECT * FROM agents ORDER BY elo DESC`),
    updateAgent:  db.prepare(`UPDATE agents SET elo=?, wins=?, losses=?, pnl_wei=? WHERE id=?`),
    insertMatch:    db.prepare(`INSERT INTO matches (id, agent0_id, agent1_id, wager_wei) VALUES (?, ?, ?, ?)`),
    getMatch:       db.prepare(`SELECT * FROM matches WHERE id = ?`),
    listMatches:    db.prepare(`SELECT * FROM matches ORDER BY created_at DESC`),
    activateMatch:  db.prepare(`UPDATE matches SET status='active', prize_wei=? WHERE id=?`),
    settleMatch:    db.prepare(`UPDATE matches SET status='completed', winner_id=?, duration_ticks=?, finished_at=unixepoch() WHERE id=?`),
    matchesByAgent: db.prepare(`SELECT * FROM matches WHERE agent0_id=? OR agent1_id=? ORDER BY created_at DESC`),
    recordDeposit0: db.prepare(`UPDATE matches SET deposit0_addr=?, deposit0_tx=? WHERE id=?`),
    recordDeposit1: db.prepare(`UPDATE matches SET deposit1_addr=?, deposit1_tx=? WHERE id=?`),
    insertParticipant: db.prepare(`INSERT INTO match_participants (match_id, agent_id, player_idx, elo_before) VALUES (?, ?, ?, ?)`),
    updateParticipantElo: db.prepare(`UPDATE match_participants SET elo_after=? WHERE match_id=? AND agent_id=?`),
    insertTick: db.prepare(`INSERT INTO match_ticks (match_id, tick, player_id, commands, state_snap) VALUES (?, ?, ?, ?, ?)`),
    ticksByMatch: db.prepare(`SELECT * FROM match_ticks WHERE match_id=? ORDER BY tick ASC`),
    latestTick:   db.prepare(`SELECT * FROM match_ticks WHERE match_id=? ORDER BY tick DESC LIMIT 1`),
    insertPayment: db.prepare(`INSERT INTO payments (tx_hash, from_addr, amount_wei, purpose, match_id) VALUES (?, ?, ?, ?, ?)`),
    getPaymentByHash: db.prepare(`SELECT id FROM payments WHERE tx_hash=?`),
  }

  return { db, q }
})

// Bypass x402 payment verification in tests
vi.mock('../x402.js', async () => {
  const { ethers } = await import('ethers')
  let nonce = 0
  return {
    FEES: {
      register:         ethers.parseEther('0.001'),
      matchmaking_join: ethers.parseEther('0.01'),
    },
    requirePayment: (_purpose: string) => (req: any, res: any, next: any) => {
      // Each call gets a unique txHash to avoid UNIQUE constraint on payments.tx_hash
      const unique = (++nonce).toString(16).padStart(64, '0')
      res.locals.payment = {
        txHash:    '0x' + unique,
        fromAddr:  '0x' + '01'.repeat(20),
        amountWei: ethers.parseEther('0.002'),
      }
      next()
    },
    verifyPayment: vi.fn(),
  }
})
