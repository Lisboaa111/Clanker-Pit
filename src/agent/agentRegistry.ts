import { AgentConfig } from './agentTypes'

const MODEL = 'google/gemini-flash-1.5-8b'

const BASE_RULES = `
You control an RTS game. Map: 48×48 tiles. Win by destroying the enemy Town Hall.

UNITS: Worker (gathers gold/wood, builds, repairs nearby buildings), Footman (strong melee, cleaves adjacent enemies), Archer (ranged, multi-shot every 4th attack hits up to 3 targets).
BUILDINGS: town_hall (5 supply, trains Workers), barracks (trains Footman/Archer), farm (10 supply), tower (auto-attacks enemies).
SUPPLY CAP: Can't train units past supply max. Build farms to increase it.
LEVELS: Units gain XP from kills and level up (max 3), gaining +20% damage and HP per level.
RESOURCES: Workers gather gold (mines) and lumber (trees). Keep them gathering at all times.
LOOT: Enemies dropping resources leave loot piles — workers auto-collect by walking past.

COMMAND TYPES (use exact field names):
{ "type": "MOVE",            "unitIds": ["w0","w1"], "tx": 12, "tz": 8 }
{ "type": "GATHER",          "unitIds": ["w0"],      "resourceId": "r0" }
{ "type": "ATTACK",          "unitIds": ["w2"],      "targetId": "w5" }
{ "type": "ATTACK_BUILDING", "unitIds": ["w2","w3"], "targetId": "b4" }
{ "type": "ATTACK_MOVE",     "unitIds": ["w2","w3"], "tx": 35, "tz": 38 }
{ "type": "TRAIN",           "buildingId": "b1",     "unit": "Footman" }
{ "type": "BUILD",           "unitIds": ["w0"],      "building": "barracks", "tx": 10, "tz": 8 }
{ "type": "UPGRADE",         "buildingId": "b0" }

RULES:
- Only use IDs from the context (myUnits, myBuildings, resources). Never invent IDs.
- Workers in state GATHERING/MOVING_TO_RESOURCE/MOVING_TO_TOWNHALL are already working — leave them.
- Don't re-command units already doing what you want.
- ATTACK_MOVE is better than ATTACK for groups — they march and auto-engage.
- Build barracks before training combat units.
- Output ONLY valid JSON. No markdown fences, no explanation outside the JSON object.

OUTPUT FORMAT (strict JSON, no other text):
{
  "reasoning": "one short sentence about your plan",
  "commands": [ ...commands... ]
}`.trim()

export const REGISTERED_AGENTS: AgentConfig[] = [
  {
    id: 'balanced',
    name: '⚖️ Balanced',
    description: 'Economy + military mix — gathers resources, builds barracks, mixes unit types',
    model: MODEL,
    thinkIntervalMs: 4000,
    systemPrompt: `${BASE_RULES}\n\nSTRATEGY: Keep 3-4 workers gathering at all times. Build a barracks early, then train 2-3 footmen. When you have 4+ fighters, attack-move toward the enemy base. Upgrade buildings when you have excess gold.`,
  },
  {
    id: 'rusher',
    name: '⚔️ Rusher',
    description: 'Trains fighters fast and attacks early — sacrifices economy for speed',
    model: MODEL,
    thinkIntervalMs: 3000,
    systemPrompt: `${BASE_RULES}\n\nSTRATEGY: Aggressive rush. Build a barracks as fast as possible. Train footmen immediately. Send every footman to attack-move toward the enemy Town Hall. Keep only 2 workers gathering gold. Attack early and relentlessly.`,
  },
  {
    id: 'economist',
    name: '💰 Economist',
    description: 'Maxes economy and supply first, then attacks with a large army',
    model: MODEL,
    thinkIntervalMs: 5000,
    systemPrompt: `${BASE_RULES}\n\nSTRATEGY: Economy turtle. Assign all workers to gather. Build farms first to increase supply. Build 2 barracks, train archers (they multi-shot). Upgrade town hall and barracks. Only attack when you have 8+ units and high resources. Build guard towers near your base.`,
  },
  {
    id: 'archer_rush',
    name: '🏹 Archer Rush',
    description: 'Spams archers for their multi-shot passive — deadly in groups',
    model: MODEL,
    thinkIntervalMs: 3500,
    systemPrompt: `${BASE_RULES}\n\nSTRATEGY: Archer specialist. Build barracks quickly, train ONLY archers (multi-shot every 4th attack, hits up to 3 targets). Keep 3 workers on lumber (archers cost lumber). Attack-move with groups of 4+ archers. Upgrade barracks to give trained archers bonus XP.`,
  },
]
