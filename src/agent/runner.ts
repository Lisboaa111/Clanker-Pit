import { AgentConfig, AgentDecision, AgentCommandRaw } from './agentTypes'
import { serializeState } from './serializer'
import { GameState, GameCommand, CommandType, BuildingType, UnitType } from '../game/types'

// ── OpenRouter call ───────────────────────────────────────────────────────────

async function callOpenRouter(
  apiKey: string,
  model: string,
  systemPrompt: string,
  context: object,
): Promise<AgentDecision | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Clanker Pit RTS',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: JSON.stringify(context) },
        ],
        max_tokens: 1024,
        temperature: 0.2,
      }),
    })

    if (!res.ok) {
      console.warn('[Agent] OpenRouter error', res.status, await res.text())
      return null
    }

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ''

    // Strip accidental markdown fences if model ignores instructions
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as AgentDecision

    if (!Array.isArray(parsed.commands)) {
      console.warn('[Agent] Response missing commands array:', parsed)
      return null
    }
    return parsed
  } catch (e) {
    console.warn('[Agent] Failed to parse response', e)
    return null
  }
}

// ── Command translation ───────────────────────────────────────────────────────

function translateCommand(raw: AgentCommandRaw, state: GameState, playerId: number): GameCommand | null {
  const myUnitIds = new Set(
    state.workers.filter(w => w.playerId === playerId && !w.dead).map(w => w.id),
  )
  const myBuildingIds = new Set(
    state.buildings.filter(b => b.playerId === playerId && !b.destroyed).map(b => b.id),
  )
  const resourceIds       = new Set(state.resources.filter(r => !r.depleted).map(r => r.id))
  const enemyUnitIds      = new Set(state.workers.filter(w => w.playerId !== playerId && !w.dead).map(w => w.id))
  const enemyBuildingIds  = new Set(state.buildings.filter(b => b.playerId !== playerId && !b.destroyed).map(b => b.id))

  switch (raw.type) {
    case 'MOVE': {
      const ids = raw.unitIds.filter(id => myUnitIds.has(id))
      if (!ids.length) return null
      return { type: CommandType.MOVE_TO_TILE, workerIds: ids, tileX: raw.tx, tileZ: raw.tz }
    }
    case 'GATHER': {
      const ids = raw.unitIds.filter(id => myUnitIds.has(id))
      if (!ids.length) { console.warn('[Agent] GATHER: no valid unitIds'); return null }
      if (!resourceIds.has(raw.resourceId)) { console.warn('[Agent] GATHER: resourceId not found:', raw.resourceId); return null }
      return { type: CommandType.GATHER_RESOURCE, workerIds: ids, resourceId: raw.resourceId }
    }
    case 'ATTACK': {
      const ids = raw.unitIds.filter(id => myUnitIds.has(id))
      if (!ids.length) return null
      if (!enemyUnitIds.has(raw.targetId)) { console.warn('[Agent] ATTACK: target not found:', raw.targetId); return null }
      return { type: CommandType.ATTACK_UNIT, workerIds: ids, targetWorkerId: raw.targetId }
    }
    case 'ATTACK_BUILDING': {
      const ids = raw.unitIds.filter(id => myUnitIds.has(id))
      if (!ids.length) { console.warn('[Agent] ATTACK_BUILDING: no valid unitIds'); return null }
      if (!enemyBuildingIds.has(raw.targetId)) { console.warn('[Agent] ATTACK_BUILDING: building not found:', raw.targetId, '| valid:', [...enemyBuildingIds]); return null }
      return { type: CommandType.ATTACK_BUILDING, workerIds: ids, targetBuildingId: raw.targetId }
    }
    case 'ATTACK_MOVE': {
      const ids = raw.unitIds.filter(id => myUnitIds.has(id))
      if (!ids.length) return null
      return { type: CommandType.ATTACK_MOVE, workerIds: ids, tileX: raw.tx, tileZ: raw.tz }
    }
    case 'TRAIN': {
      if (!myBuildingIds.has(raw.buildingId)) { console.warn('[Agent] TRAIN: buildingId not found:', raw.buildingId); return null }
      const unitTypeMap: Record<string, UnitType> = {
        Worker:  UnitType.WORKER,
        Footman: UnitType.FOOTMAN,
        Archer:  UnitType.ARCHER,
      }
      const unitType = unitTypeMap[raw.unit]
      if (!unitType) { console.warn('[Agent] TRAIN: unknown unit type:', raw.unit); return null }
      return { type: CommandType.TRAIN_UNIT, buildingId: raw.buildingId, unitType }
    }
    case 'BUILD': {
      const ids = raw.unitIds.filter(id => myUnitIds.has(id))
      if (!ids.length) return null
      const btMap: Record<string, BuildingType> = {
        barracks: BuildingType.BARRACKS,
        farm:     BuildingType.FARM,
        tower:    BuildingType.TOWER,
      }
      const bt = btMap[raw.building]
      if (!bt) return null
      return { type: CommandType.BUILD, workerIds: ids, buildingType: bt, tileX: raw.tx, tileZ: raw.tz }
    }
    case 'UPGRADE': {
      if (!myBuildingIds.has(raw.buildingId)) return null
      return { type: CommandType.UPGRADE_BUILDING, buildingId: raw.buildingId }
    }
    default:
      return null
  }
}

// ── AgentRunner class ─────────────────────────────────────────────────────────

export class AgentRunner {
  private config: AgentConfig
  private playerId: number
  private apiKey: string
  private isPending = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  private stateRef: GameState | null = null
  private lastContextHash = ''
  public lastReasoning = ''
  public lastCommandCount = 0
  public isRunning = false

  constructor(config: AgentConfig, playerId: number, apiKey: string) {
    this.config   = config
    this.playerId = playerId
    this.apiKey   = apiKey
  }

  start(state: GameState) {
    this.stateRef  = state
    this.isRunning = true
    // First think after a short delay so the game renders first
    setTimeout(() => this.think(), 1500)
    this.intervalId = setInterval(() => this.think(), this.config.thinkIntervalMs)
  }

  stop() {
    this.isRunning = false
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.stateRef = null
  }

  private async think() {
    if (this.isPending || !this.stateRef || !this.isRunning) return
    if ((this.stateRef as any).paused) return

    this.isPending = true
    try {
      const context  = serializeState(this.stateRef, this.playerId)
      const ctxStr   = JSON.stringify(context)

      // Skip API call if nothing meaningful changed (same tick bracket)
      // But always call if urgentAction is set
      const ctx = context as any
      const hasUrgent = ctx.situation?.urgentAction && ctx.situation.urgentAction !== 'none'
      const ctxHash   = `${ctx.tick >> 4}_${ctx.gold}_${ctx.lumber}_${ctx.supply}_${ctx.myUnits?.length}_${ctx.enemyUnits?.length}_${ctx.situation?.urgentAction}`
      if (!hasUrgent && ctxHash === this.lastContextHash) return
      this.lastContextHash = ctxHash

      console.debug(`[Agent P${this.playerId}] thinking... urgent="${ctx.situation?.urgentAction?.slice(0,60) ?? 'none'}"`)

      const decision = await callOpenRouter(
        this.apiKey,
        this.config.model,
        this.config.systemPrompt,
        context,
      )

      if (!decision) return

      this.lastReasoning    = decision.reasoning ?? ''
      this.lastCommandCount = decision.commands.length

      // Dispatch a UI update event so the HUD can show reasoning
      window.dispatchEvent(new CustomEvent('agent-thinking', {
        detail: {
          playerId:  this.playerId,
          reasoning: this.lastReasoning,
          agentName: this.config.name,
        },
      }))

      let translated = 0
      let skipped    = 0
      for (const raw of decision.commands) {
        const cmd = translateCommand(raw, this.stateRef, this.playerId)
        if (cmd) {
          this.stateRef.pendingAgentCommands.push({ playerId: this.playerId, command: cmd })
          translated++
        } else {
          skipped++
        }
      }

      if (skipped > 0) {
        console.warn(`[Agent P${this.playerId}] ${skipped}/${decision.commands.length} commands skipped (invalid IDs)`)
      }
      console.debug(`[Agent P${this.playerId}] "${this.lastReasoning}" → ${translated} commands queued`)

    } finally {
      this.isPending = false
    }
  }
}
