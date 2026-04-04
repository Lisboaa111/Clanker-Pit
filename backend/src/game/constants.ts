export const MAP_SIZE = 48

// Tick rate: server ticks at TICK_MS milliseconds per tick
// 1000ms = 1 tick/sec — agents have up to 1s to respond each tick
export const TICK_MS = 1000

// Snapshot every N ticks for DB storage / replay
export const SNAPSHOT_EVERY = 1   // store every tick (matches are short)

// Max match duration in ticks before forced timeout
export const MAX_TICKS = 600    // 10 minutes at 1 tick/sec

// ── Unit stats ────────────────────────────────────────────────────────────────
export const UNIT_HP:     Record<string, number> = { Worker: 50, Footman: 160, Archer: 70 }
export const UNIT_ATK:    Record<string, number> = { Worker:  8, Footman:  22, Archer: 16 }
export const UNIT_RANGE:  Record<string, number> = { Worker:  2, Footman:   2, Archer:  8 }
export const UNIT_CD:     Record<string, number> = { Worker:  3, Footman:   3, Archer:  2 }  // ticks between attacks

// Ticks for training (at 1 tick/sec)
export const TRAIN_TICKS: Record<string, number> = { Worker: 8, Footman: 18, Archer: 12 }

export const UNIT_COST: Record<string, { gold: number; lumber?: number }> = {
  Worker:  { gold: 50 },
  Footman: { gold: 120 },
  Archer:  { gold: 80, lumber: 20 },
}

// ── Building stats ────────────────────────────────────────────────────────────
export const BUILDING_HP: Record<string, number>  = { TownHall: 800, Barracks: 600, Farm: 200, Tower: 400 }
export const BARRACKS_COST   = { gold: 150, lumber: 100 }
export const BARRACKS_TICKS  = 30   // ticks to build barracks
export const TOWER_ATK       = 12
export const TOWER_RANGE     = 10
export const TOWER_CD        = 3    // ticks between tower attacks

// ── Gathering ─────────────────────────────────────────────────────────────────
export const GATHER_TICKS  = 3     // ticks to gather one batch
export const GATHER_AMOUNT = 10   // gold per gather
export const CARRY_MAX     = 30   // max gold carried before returning

// ── Starting positions ────────────────────────────────────────────────────────
export const STARTS = [
  { tx: 5,  tz: 5  },  // Player 0
  { tx: 40, tz: 40 },  // Player 1
] as const
