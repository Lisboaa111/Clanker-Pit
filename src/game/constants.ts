// ── Map ───────────────────────────────────────────────────────────────────────
export const MAP_WIDTH  = 48
export const MAP_HEIGHT = 48
export const TILE_SIZE  = 2

// ── Resources ─────────────────────────────────────────────────────────────────
export const GOLD_MINE_STARTING_AMOUNT = 500
export const TREE_STARTING_AMOUNT      = 5
export const GOLD_MINE_COUNT           = 10
export const FOREST_PATCH_COUNT        = 12
export const FOREST_PATCH_SIZE_MIN     = 4
export const FOREST_PATCH_SIZE_MAX     = 16

// ── Worker ────────────────────────────────────────────────────────────────────
export const WORKER_SPEED        = 6
export const WORKER_CARRY_GOLD   = 10
export const WORKER_CARRY_LUMBER = 5
export const GATHER_TICK_RATE    = 0.4
export const DEPOSIT_DURATION    = 0.4
export const WORKER_HP           = 50
export const WORKER_ATTACK_DAMAGE   = 8
export const WORKER_ATTACK_RANGE    = 2.2
export const WORKER_ATTACK_COOLDOWN = 1.0
export const WORKER_SIZE            = 0.45
export const HP_BAR_WIDTH           = 0.6

// ── Footman ───────────────────────────────────────────────────────────────────
export const FOOTMAN_HP              = 160
export const FOOTMAN_ATTACK_DAMAGE   = 18
export const FOOTMAN_ATTACK_RANGE    = 2.4
export const FOOTMAN_ATTACK_COOLDOWN = 1.3
export const FOOTMAN_SPEED           = 4.5
export const FOOTMAN_SIZE            = 0.55

// ── Archer ────────────────────────────────────────────────────────────────────
export const ARCHER_HP               = 70
export const ARCHER_ATTACK_DAMAGE    = 14
export const ARCHER_ATTACK_RANGE     = 9.0
export const ARCHER_ATTACK_COOLDOWN  = 0.9
export const ARCHER_SPEED            = 6.5
export const ARCHER_SIZE             = 0.38
export const ARCHER_PROJECTILE_SPEED = 20

// ── Building stats ────────────────────────────────────────────────────────────
export const TOWN_HALL_HP           = 800
export const TOWN_HALL_HP_BAR_WIDTH = 2.2
export const TOWN_HALL_SIZE         = 3.0

export const BARRACKS_HP            = 600
export const BARRACKS_HP_BAR_WIDTH  = 2.0

export const FARM_HP                = 200
export const FARM_HP_BAR_WIDTH      = 1.2

export const TOWER_HP               = 400
export const TOWER_HP_BAR_WIDTH     = 1.0
export const TOWER_ATTACK_DAMAGE    = 12
export const TOWER_ATTACK_RANGE     = 10.0
export const TOWER_ATTACK_COOLDOWN  = 1.5

// ── Building construction ─────────────────────────────────────────────────────
export const BARRACKS_GOLD        = 150
export const BARRACKS_LUMBER      = 100
export const BARRACKS_BUILD_TIME  = 30

export const FARM_GOLD            = 80
export const FARM_LUMBER          = 30
export const FARM_BUILD_TIME      = 15

export const TOWER_GOLD           = 120
export const TOWER_LUMBER         = 80
export const TOWER_BUILD_TIME     = 20

// ── Training ──────────────────────────────────────────────────────────────────
export const TRAIN_WORKER_GOLD    = 50
export const TRAIN_WORKER_LUMBER  = 0
export const TRAIN_WORKER_TIME    = 8

export const TRAIN_FOOTMAN_GOLD   = 120
export const TRAIN_FOOTMAN_LUMBER = 0
export const TRAIN_FOOTMAN_TIME   = 18

export const TRAIN_ARCHER_GOLD    = 80
export const TRAIN_ARCHER_LUMBER  = 20
export const TRAIN_ARCHER_TIME    = 12

// ── Population ────────────────────────────────────────────────────────────────
export const SUPPLY_FROM_TOWNHALL = 5
export const SUPPLY_FROM_FARM     = 10
export const SUPPLY_MAX           = 30

// ── Combat ────────────────────────────────────────────────────────────────────
export const AUTO_ATTACK_RADIUS   = 9
export const ATTACK_MOVE_SCAN     = 7.0
export const HP_REGEN_RATE        = 2.0
export const HP_REGEN_DELAY_TICKS = 300   // ~5 seconds at 60fps
export const DEATH_ANIM_DURATION  = 0.35
export const FORMATION_SPACING    = 1.4

// ── Players ───────────────────────────────────────────────────────────────────
export const PLAYER_COLORS      = [0x4488ff, 0xff3322] as const
export const PLAYER_SEL_COLORS  = [0x88bbff, 0xff7766] as const
export const PLAYER_NAMES       = ['Blue', 'Red'] as const

// ── Map generation ────────────────────────────────────────────────────────────
export const WATER_THRESHOLD     = 0.30
export const NOISE_SCALE         = 0.12

// ── Camera ────────────────────────────────────────────────────────────────────
export const CAMERA_PAN_SPEED   = 20
export const CAMERA_ZOOM_MIN    = 8
export const CAMERA_ZOOM_MAX    = 60
export const CAMERA_ZOOM_SPEED  = 3

// ── Environment meshes ────────────────────────────────────────────────────────
export const TREE_WIDTH       = 0.5
export const TREE_HEIGHT      = 1.6
export const GOLD_MINE_RADIUS = 0.7

// ── Colors ────────────────────────────────────────────────────────────────────
export const COLOR_GRASS      = 0x4a7c3f
export const COLOR_GRASS_DARK = 0x3d6835
export const COLOR_WATER      = 0x2a5fa5
export const COLOR_WATER_FOAM = 0x4a8fd4
export const COLOR_TREE       = 0x2d5a27
export const COLOR_TREE_TRUNK = 0x5c3d1e
export const COLOR_GOLD_MINE  = 0xf5c518
export const COLOR_GOLD_DARK  = 0xc9941a
export const COLOR_TOWN_HALL  = 0x8b7355
export const COLOR_WORKER     = 0x4488ff
export const COLOR_WORKER_SEL = 0x66aaff
export const COLOR_SELECTION  = 0xffffff
export const COLOR_PATH       = 0xff4444
export const COLOR_CARRY_GOLD = 0xffd700
export const COLOR_CARRY_WOOD = 0x8B4513

// ── HUD ───────────────────────────────────────────────────────────────────────
export const HUD_UPDATE_INTERVAL = 100
