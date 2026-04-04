import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const db = new Database(path.join(__dirname, '../../clankerpit.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_addr  TEXT NOT NULL,
    elo         REAL NOT NULL DEFAULT 1200,
    wins        INTEGER NOT NULL DEFAULT 0,
    losses      INTEGER NOT NULL DEFAULT 0,
    pnl_wei     TEXT NOT NULL DEFAULT '0',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS matches (
    id              TEXT PRIMARY KEY,
    agent0_id       TEXT NOT NULL REFERENCES agents(id),
    agent1_id       TEXT NOT NULL REFERENCES agents(id),
    status          TEXT NOT NULL DEFAULT 'pending_deposit',
    winner_id       TEXT,
    wager_wei       TEXT NOT NULL DEFAULT '0',
    prize_wei       TEXT NOT NULL DEFAULT '0',
    deposit0_addr   TEXT,
    deposit1_addr   TEXT,
    deposit0_tx     TEXT,
    deposit1_tx     TEXT,
    duration_ticks  INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    finished_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS match_participants (
    match_id   TEXT NOT NULL REFERENCES matches(id),
    agent_id   TEXT NOT NULL REFERENCES agents(id),
    player_idx INTEGER NOT NULL,
    elo_before REAL NOT NULL,
    elo_after  REAL,
    PRIMARY KEY (match_id, agent_id)
  );

  CREATE TABLE IF NOT EXISTS match_ticks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id   TEXT NOT NULL REFERENCES matches(id),
    tick       INTEGER NOT NULL,
    player_id  INTEGER NOT NULL,
    commands   TEXT NOT NULL,
    state_snap TEXT,
    reasoning  TEXT,
    ts         INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_match_ticks ON match_ticks(match_id, tick);

  CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash     TEXT NOT NULL UNIQUE,
    from_addr   TEXT NOT NULL,
    amount_wei  TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    match_id    TEXT REFERENCES matches(id),
    verified_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`)

// ── Column migrations (idempotent) ────────────────────────────────────────────
// Add new columns to existing DBs that were created before these were added.
const newMatchCols: [string, string][] = [
  ['wager_wei',     "TEXT NOT NULL DEFAULT '0'"],
  ['deposit0_addr', 'TEXT'],
  ['deposit1_addr', 'TEXT'],
  ['deposit0_tx',   'TEXT'],
  ['deposit1_tx',   'TEXT'],
]
for (const [col, def] of newMatchCols) {
  try { db.exec(`ALTER TABLE matches ADD COLUMN ${col} ${def}`) } catch { /* already exists */ }
}

try { db.exec(`ALTER TABLE match_ticks ADD COLUMN reasoning TEXT`) } catch { /* already exists */ }

// ── Typed rows ────────────────────────────────────────────────────────────────
export interface AgentRow {
  id: string; name: string; owner_addr: string; elo: number
  wins: number; losses: number; pnl_wei: string; created_at: number
}

export interface MatchRow {
  id: string; agent0_id: string; agent1_id: string; status: string
  winner_id: string | null
  wager_wei: string; prize_wei: string
  deposit0_addr: string | null; deposit1_addr: string | null
  deposit0_tx: string | null;   deposit1_tx: string | null
  duration_ticks: number | null; created_at: number; finished_at: number | null
}

export interface TickRow {
  id: number; match_id: string; tick: number; player_id: number
  commands: string; state_snap: string | null; reasoning: string | null; ts: number
}

// ── Prepared statements ───────────────────────────────────────────────────────
export const q = {
  // agents
  insertAgent:  db.prepare(`INSERT INTO agents (id, name, owner_addr) VALUES (?, ?, ?)`),
  getAgent:     db.prepare(`SELECT * FROM agents WHERE id = ?`),
  listAgents:   db.prepare(`SELECT * FROM agents ORDER BY elo DESC`),
  updateAgent:  db.prepare(`UPDATE agents SET elo=?, wins=?, losses=?, pnl_wei=? WHERE id=?`),

  // matches
  insertMatch:   db.prepare(`INSERT INTO matches (id, agent0_id, agent1_id, wager_wei) VALUES (?, ?, ?, ?)`),
  getMatch:      db.prepare(`SELECT * FROM matches WHERE id = ?`),
  listMatches:   db.prepare(`SELECT * FROM matches ORDER BY created_at DESC`),
  activateMatch: db.prepare(`UPDATE matches SET status='active', prize_wei=? WHERE id=?`),
  settleMatch:   db.prepare(`UPDATE matches SET status='completed', winner_id=?, duration_ticks=?, finished_at=unixepoch() WHERE id=?`),
  matchesByAgent: db.prepare(`SELECT * FROM matches WHERE agent0_id=? OR agent1_id=? ORDER BY created_at DESC`),
  recordDeposit0: db.prepare(`UPDATE matches SET deposit0_addr=?, deposit0_tx=? WHERE id=?`),
  recordDeposit1: db.prepare(`UPDATE matches SET deposit1_addr=?, deposit1_tx=? WHERE id=?`),

  // participants
  insertParticipant:    db.prepare(`INSERT INTO match_participants (match_id, agent_id, player_idx, elo_before) VALUES (?, ?, ?, ?)`),
  updateParticipantElo: db.prepare(`UPDATE match_participants SET elo_after=? WHERE match_id=? AND agent_id=?`),

  // ticks
  insertTick:   db.prepare(`INSERT INTO match_ticks (match_id, tick, player_id, commands, state_snap, reasoning) VALUES (?, ?, ?, ?, ?, ?)`),
  ticksByMatch: db.prepare(`SELECT * FROM match_ticks WHERE match_id=? ORDER BY tick ASC`),
  latestTick:   db.prepare(`SELECT * FROM match_ticks WHERE match_id=? ORDER BY tick DESC LIMIT 1`),

  // payments
  insertPayment:    db.prepare(`INSERT INTO payments (tx_hash, from_addr, amount_wei, purpose, match_id) VALUES (?, ?, ?, ?, ?)`),
  getPaymentByHash: db.prepare(`SELECT id FROM payments WHERE tx_hash=?`),
}
