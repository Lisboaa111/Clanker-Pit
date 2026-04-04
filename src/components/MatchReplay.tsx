import { useEffect, useRef, useState, useCallback } from 'react'
import { MAP_WIDTH, MAP_HEIGHT } from '../game/constants'

const API      = 'http://localhost:3001'
const CANVAS_W = 800
const CANVAS_H = 800

// ── Types ─────────────────────────────────────────────────────────────────────

interface TickRow {
  id: number
  match_id: string
  tick: number
  player_id: number
  commands: string
  state_snap: string | null
  reasoning: string | null
}

interface SerializedUnit {
  id: string; type: string; tx: number; tz: number
  hp: number; maxHp: number; state: string; level: number; busy: boolean
  carry?: { type: string; amount: number } | null
}

interface SerializedBuilding {
  id: string; type: string; tx: number; tz: number
  hp: number; maxHp: number; level: number
  underConstruction: boolean; upgrading: boolean
  trainingQueue?: unknown[]
}

interface SerializedResource {
  id: string; type: string; tx: number; tz: number; amount: number
}

interface StateSnap {
  tick: number
  playerId: number
  gold: number
  lumber: number
  supply: number
  supplyMax: number
  myUnits: SerializedUnit[]
  myBuildings: SerializedBuilding[]
  enemyUnits: SerializedUnit[]
  enemyBuildings: SerializedBuilding[]
  resources: SerializedResource[]
}

interface FramePair {
  tick: number
  p0: { snap: StateSnap; reasoning: string | null } | null
  p1: { snap: StateSnap; reasoning: string | null } | null
}

interface MatchMeta {
  agent0_id: string
  agent1_id: string
  winner_id: string | null
  duration_ticks: number | null
}

interface AgentInfo { id: string; name: string }

interface Props {
  matchId: string
}

// ── Colours ───────────────────────────────────────────────────────────────────
const P_COLOR  = ['#4488ff', '#ff3322'] as const
const P_DIM    = ['#1a3566', '#661411'] as const

// ── Component ─────────────────────────────────────────────────────────────────

export function MatchReplay({ matchId }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)

  const [frames, setFrames]   = useState<FramePair[]>([])
  const [cursor, setCursor]   = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed]     = useState(1)
  const [loading, setLoading] = useState(true)
  const [matchMeta, setMatchMeta]   = useState<MatchMeta | null>(null)
  const [agents, setAgents]         = useState<[AgentInfo, AgentInfo] | null>(null)

  // zoom/pan stored in refs so canvas events don't need re-binding
  const zoom     = useRef(1)
  const pan      = useRef({ x: 0, y: 0 })
  const drag     = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number }>({ active: false, sx: 0, sy: 0, px: 0, py: 0 })

  // redraw trigger
  const [, forceRedraw] = useState(0)
  const redraw = useCallback(() => forceRedraw(n => n + 1), [])

  // ── Load ticks ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/match/${matchId}/replay`)
      .then(r => r.json())
      .then(d => {
        setMatchMeta(d.match ?? null)
        setAgents(d.agents ?? null)
        const all = (d.ticks ?? []) as TickRow[]

        // Build frame pairs: group by tick, keep only ticks with a snapshot
        const map = new Map<number, { p0?: TickRow; p1?: TickRow }>()
        for (const t of all) {
          if (!t.state_snap) continue
          const entry = map.get(t.tick) ?? {}
          if (t.player_id === 0) entry.p0 = t
          else entry.p1 = t
          map.set(t.tick, entry)
        }

        const pairs: FramePair[] = []
        for (const [tick, { p0, p1 }] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
          let p0data: FramePair['p0'] = null
          let p1data: FramePair['p1'] = null
          try { if (p0?.state_snap) p0data = { snap: JSON.parse(p0.state_snap) as StateSnap, reasoning: p0.reasoning ?? null } } catch {}
          try { if (p1?.state_snap) p1data = { snap: JSON.parse(p1.state_snap) as StateSnap, reasoning: p1.reasoning ?? null } } catch {}
          if (p0data || p1data) pairs.push({ tick, p0: p0data, p1: p1data })
        }

        setFrames(pairs)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [matchId])

  // ── Playback interval ───────────────────────────────────────────────────────
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!playing) {
      if (playRef.current) { clearInterval(playRef.current); playRef.current = null }
      return
    }
    const ms = Math.round(500 / speed)  // snapshots are 500ms apart in real time
    playRef.current = setInterval(() => {
      setCursor(c => {
        if (c >= frames.length - 1) { setPlaying(false); return c }
        return c + 1
      })
    }, ms)
    return () => { if (playRef.current) clearInterval(playRef.current) }
  }, [playing, speed, frames.length])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'Space')       { e.preventDefault(); setPlaying(p => !p) }
      if (e.code === 'ArrowLeft')   { e.preventDefault(); setPlaying(false); setCursor(c => Math.max(0, c - 1)) }
      if (e.code === 'ArrowRight')  { e.preventDefault(); setPlaying(false); setCursor(c => Math.min(frames.length - 1, c + 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frames.length])

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frames.length) return
    const frame = frames[cursor]
    if (!frame) return
    drawFrame(canvas, frame, zoom.current, pan.current)
  }, [cursor, frames, forceRedraw])  // eslint-disable-line

  // ── Canvas events (zoom + pan) ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect  = canvas.getBoundingClientRect()
      const scaleX = CANVAS_W / rect.width
      const scaleY = CANVAS_H / rect.height
      const cx = (e.clientX - rect.left) * scaleX
      const cy = (e.clientY - rect.top)  * scaleY

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.5, Math.min(8, zoom.current * factor))

      // Zoom towards cursor
      pan.current.x = cx - (cx - pan.current.x) * (newZoom / zoom.current)
      pan.current.y = cy - (cy - pan.current.y) * (newZoom / zoom.current)
      zoom.current = newZoom
      redraw()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      canvas.setPointerCapture(e.pointerId)
      drag.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.current.x, py: pan.current.y }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current.active) return
      const rect   = canvas.getBoundingClientRect()
      const scaleX = CANVAS_W / rect.width
      const scaleY = CANVAS_H / rect.height
      pan.current.x = drag.current.px + (e.clientX - drag.current.sx) * scaleX
      pan.current.y = drag.current.py + (e.clientY - drag.current.sy) * scaleY
      redraw()
    }
    const onPointerUp = () => { drag.current.active = false }

    canvas.addEventListener('wheel',        onWheel,       { passive: false })
    canvas.addEventListener('pointerdown',  onPointerDown)
    canvas.addEventListener('pointermove',  onPointerMove)
    canvas.addEventListener('pointerup',    onPointerUp)
    canvas.addEventListener('pointercancel',onPointerUp)

    return () => {
      canvas.removeEventListener('wheel',        onWheel)
      canvas.removeEventListener('pointerdown',  onPointerDown)
      canvas.removeEventListener('pointermove',  onPointerMove)
      canvas.removeEventListener('pointerup',    onPointerUp)
      canvas.removeEventListener('pointercancel',onPointerUp)
    }
  }, [redraw])

  // ── Derived current frame data ──────────────────────────────────────────────
  const frame   = frames[cursor]
  const p0snap  = frame?.p0?.snap  ?? null
  const p1snap  = frame?.p1?.snap  ?? null
  const p0reason = frame?.p0?.reasoning ?? null
  const p1reason = frame?.p1?.reasoning ?? null

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const fitView = () => {
    zoom.current = 1
    pan.current  = { x: 0, y: 0 }
    redraw()
  }
  const zoomIn  = () => { zoom.current = Math.min(8, zoom.current * 1.3); redraw() }
  const zoomOut = () => { zoom.current = Math.max(0.5, zoom.current / 1.3); redraw() }

  const btnBase   = 'font-pixel border transition-all'
  const activeBtn = `${btnBase} border-[#33ff66]/60 text-[#33ff66] hover:bg-[#33ff66]/10 hover:border-[#33ff66]`
  const dimBtn    = `${btnBase} border-[#222] text-[#555] hover:border-[#444] hover:text-[#777]`

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="p-8 font-pixel text-[#555] text-center" style={{ fontSize: '10px' }}>
      LOADING REPLAY…
    </div>
  )
  if (!frames.length) return (
    <div className="p-8 font-pixel text-[#444] text-center" style={{ fontSize: '10px' }}>
      NO SNAPSHOT DATA FOR THIS MATCH
    </div>
  )

  return (
    <div className="p-4 space-y-3 fade-in-up select-none">

      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <span className="font-pixel text-[#333]" style={{ fontSize: '8px' }}>
            MATCH {matchId.slice(0, 8).toUpperCase()}…
          </span>
          {agents && (
            <div className="font-pixel flex items-center gap-1.5" style={{ fontSize: '7px' }}>
              <span style={{ color: P_COLOR[0] }}>{agents[0].name.toUpperCase()}</span>
              <span className="text-[#333]">VS</span>
              <span style={{ color: P_COLOR[1] }}>{agents[1].name.toUpperCase()}</span>
              {matchMeta?.winner_id && agents && (
                <>
                  <span className="text-[#333] mx-1">·</span>
                  <span style={{ color: '#ffd700' }}>
                    {(matchMeta.winner_id === agents[0].id ? agents[0].name : agents[1].name).toUpperCase()} WINS
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className={`${dimBtn} px-2 py-1 text-[9px]`}>−</button>
          <span className="font-pixel text-[#444] px-1" style={{ fontSize: '7px' }}>
            {Math.round(zoom.current * 100)}%
          </span>
          <button onClick={zoomIn}  className={`${dimBtn} px-2 py-1 text-[9px]`}>+</button>
          <button onClick={fitView} className={`${dimBtn} px-2 py-1 text-[9px] ml-1`}>FIT</button>
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <div ref={wrapRef} className="flex justify-center">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="border border-[#222] cursor-crosshair block"
          style={{ width: '100%', maxWidth: '700px', aspectRatio: '1', imageRendering: 'pixelated', touchAction: 'none' }}
        />
      </div>

      {/* ── Player stat panels ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {([0, 1] as const).map(pid => {
          const snap      = pid === 0 ? p0snap : p1snap
          const reason    = pid === 0 ? p0reason : p1reason
          const color     = P_COLOR[pid]
          const agentInfo = agents?.[pid]
          const agentId   = pid === 0 ? matchMeta?.agent0_id : matchMeta?.agent1_id
          const isWinner  = matchMeta?.winner_id != null && matchMeta.winner_id === agentId
          const isLoser   = matchMeta?.winner_id != null && matchMeta.winner_id !== agentId
          const name      = agentInfo?.name ?? (pid === 0 ? 'P1' : 'P2')
          const workers   = snap?.myUnits.filter(u => u.type === 'Worker').length  ?? 0
          const footmen   = snap?.myUnits.filter(u => u.type === 'Footman').length ?? 0
          const archers   = snap?.myUnits.filter(u => u.type === 'Archer').length  ?? 0
          const buildings = snap?.myBuildings.length ?? 0

          return (
            <div key={pid}
              className="bg-[#0a0a0a] p-3 space-y-2"
              style={{
                border: isWinner ? `1px solid ${color}` : '1px solid #1a1a1a',
                boxShadow: isWinner ? `0 0 12px ${color}33` : 'none',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-block w-2 h-2 flex-shrink-0 rounded-full" style={{ background: color }} />
                  <span className="font-pixel truncate" style={{ fontSize: '8px', color }} title={name}>{name.toUpperCase()}</span>
                </div>
                {isWinner && (
                  <span className="font-pixel flex-shrink-0 px-1.5 py-0.5" style={{ fontSize: '6px', color: '#ffd700', border: '1px solid #ffd70066' }}>
                    🏆 WINNER
                  </span>
                )}
                {isLoser && matchMeta?.winner_id && (
                  <span className="font-pixel flex-shrink-0 px-1.5 py-0.5" style={{ fontSize: '6px', color: '#555', border: '1px solid #333' }}>
                    DEFEATED
                  </span>
                )}
              </div>

              {snap ? (
                <>
                  {/* Resources */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <StatRow label="GOLD"   value={snap.gold}     color="#ffd700" />
                    <StatRow label="LUMBER" value={snap.lumber}   color="#4caf50" />
                    <StatRow label="SUPPLY" value={`${snap.supply}/${snap.supplyMax}`} color="#aaa" />
                    <StatRow label="BLDGS"  value={buildings}     color="#aaa" />
                  </div>

                  {/* Unit counts */}
                  <div className="flex gap-3 pt-1 border-t border-[#111]">
                    <UnitBadge label="W" count={workers}  color="#aaa" title="Workers" />
                    <UnitBadge label="F" count={footmen}  color={color} title="Footmen" />
                    <UnitBadge label="A" count={archers}  color={color} title="Archers" />
                  </div>

                  {/* Reasoning */}
                  <div className="pt-1 border-t border-[#111]">
                    <div className="font-pixel text-[#333] mb-1" style={{ fontSize: '6px' }}>REASONING</div>
                    <div
                      className="font-mono text-[10px] leading-snug max-h-24 overflow-y-auto pr-1"
                      style={{ color: reason ? '#888' : '#2a2a2a' }}
                    >
                      {reason ?? '—'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="font-pixel text-[#333]" style={{ fontSize: '7px' }}>NO DATA</div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Timeline ────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span className="font-pixel text-[#444]" style={{ fontSize: '7px' }}>
            TICK {frame?.tick ?? 0}
          </span>
          <span className="font-pixel text-[#333]" style={{ fontSize: '7px' }}>
            {cursor + 1} / {frames.length} SNAPSHOTS
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={cursor}
          onChange={e => { setPlaying(false); setCursor(Number(e.target.value)) }}
          className="w-full accent-[#33ff66]"
        />
      </div>

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setPlaying(false); setCursor(0) }}                             className={`${dimBtn}    px-2 py-1.5 text-[9px]`}>◄◄</button>
        <button onClick={() => { setPlaying(false); setCursor(c => Math.max(0, c - 1)) }}       className={`${dimBtn}    px-2 py-1.5 text-[9px]`}>◄</button>
        <button onClick={() => setPlaying(p => !p)}                                             className={`${activeBtn} px-3 py-1.5 text-[9px]`}>{playing ? '⏸ PAUSE' : '► PLAY'}</button>
        <button onClick={() => { setPlaying(false); setCursor(c => Math.min(frames.length - 1, c + 1)) }} className={`${dimBtn} px-2 py-1.5 text-[9px]`}>►</button>
        <button onClick={() => { setPlaying(false); setCursor(frames.length - 1) }}             className={`${dimBtn}    px-2 py-1.5 text-[9px]`}>▶▶</button>

        <div className="flex items-center gap-2 ml-auto">
          <span className="font-pixel text-[#444]" style={{ fontSize: '7px' }}>SPEED</span>
          <select
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="bg-black border border-[#222] text-[#777] font-pixel px-2 py-1 text-[9px] hover:border-[#444] focus:outline-none"
          >
            {[0.5, 1, 2, 4, 8].map(s => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>

        <span className="font-pixel text-[#333] text-[7px] hidden sm:inline">SPACE=play  ←/→=step</span>
      </div>
    </div>
  )
}

// ── Small stat helpers ─────────────────────────────────────────────────────────

function StatRow({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-pixel text-[#333]" style={{ fontSize: '6px' }}>{label}</span>
      <span className="font-mono text-xs font-bold" style={{ color }}>{value}</span>
    </div>
  )
}

function UnitBadge({ label, count, color, title }: { label: string; count: number; color: string; title: string }) {
  return (
    <div className="flex items-center gap-1" title={title}>
      <span className="font-pixel" style={{ fontSize: '7px', color }}>{label}</span>
      <span className="font-mono text-xs text-[#666]">{count}</span>
    </div>
  )
}

// ── Canvas drawing ─────────────────────────────────────────────────────────────

function drawFrame(
  canvas: HTMLCanvasElement,
  frame: FramePair,
  z: number,
  p: { x: number; y: number },
) {
  const ctx = canvas.getContext('2d')!
  const tw  = CANVAS_W / MAP_WIDTH
  const th  = CANVAS_H / MAP_HEIGHT

  // Clear
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#0a100a'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  // Apply zoom/pan transform
  ctx.setTransform(z, 0, 0, z, p.x, p.y)

  // Grid lines (subtle)
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 0.5 / z
  for (let x = 0; x <= MAP_WIDTH; x++) {
    ctx.beginPath(); ctx.moveTo(x * tw, 0); ctx.lineTo(x * tw, CANVAS_H); ctx.stroke()
  }
  for (let zz = 0; zz <= MAP_HEIGHT; zz++) {
    ctx.beginPath(); ctx.moveTo(0, zz * th); ctx.lineTo(CANVAS_W, zz * th); ctx.stroke()
  }

  // Use P0's snapshot for the main map view (has all positions)
  const snap = frame.p0?.snap ?? frame.p1?.snap
  if (!snap) return

  // Resources
  for (const r of snap.resources) {
    ctx.fillStyle = r.type === 'gold' ? '#c9941a' : '#1e6b10'
    ctx.fillRect(r.tx * tw + 0.5, r.tz * th + 0.5, tw - 1, th - 1)
    if (z > 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.font = `${Math.max(4, tw * z * 0.3) / z}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(r.amount), (r.tx + 0.5) * tw, (r.tz + 0.5) * th)
    }
  }

  // Buildings — P0 (myBuildings from P0 snap)
  drawBuildings(ctx, snap.myBuildings, P_COLOR[0], tw, th, z)

  // Buildings — P1 (enemyBuildings from P0 snap = P1's buildings)
  drawBuildings(ctx, snap.enemyBuildings, P_COLOR[1], tw, th, z)

  // Units — P0 (myUnits from P0 snap)
  for (const u of snap.myUnits) {
    drawUnit(ctx, u, 0, tw, th, z)
  }

  // Units — P1 (enemyUnits from P0 snap = P1's units)
  for (const u of snap.enemyUnits) {
    drawUnit(ctx, u, 1, tw, th, z)
  }

  // If we have P1's own snapshot, use it to get richer P1 unit data (hp bars etc.)
  if (frame.p1?.snap) {
    for (const u of frame.p1.snap.myUnits) {
      drawUnit(ctx, u, 1, tw, th, z)
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

function drawBuildings(
  ctx: CanvasRenderingContext2D,
  buildings: SerializedBuilding[],
  color: string,
  tw: number,
  th: number,
  z: number,
) {
  for (const b of buildings) {
    const alpha = b.underConstruction ? '88' : 'dd'
    ctx.fillStyle = color + alpha
    ctx.fillRect(b.tx * tw, b.tz * th, tw * 2, th * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 1 / z
    ctx.strokeRect(b.tx * tw, b.tz * th, tw * 2, th * 2)

    if (z > 1.5) {
      const initial = { TownHall: 'TH', Barracks: 'BR', Farm: 'FM', Tower: 'TW' }[b.type] ?? b.type[0]
      ctx.fillStyle = 'rgba(0,0,0,0.8)'
      ctx.font = `bold ${Math.max(5, tw * z * 0.5) / z}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(initial, (b.tx + 1) * tw, (b.tz + 1) * th)
    }
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  u: SerializedUnit,
  pid: number,
  tw: number,
  th: number,
  z: number,
) {
  const color = P_COLOR[pid]
  const r = u.type === 'Footman' ? tw * 0.55 : u.type === 'Archer' ? tw * 0.4 : tw * 0.32
  const cx = (u.tx + 0.5) * tw
  const cy = (u.tz + 0.5) * th

  if (u.type === 'Archer') {
    // Triangle for archers
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r * 0.87, cy + r * 0.5)
    ctx.lineTo(cx - r * 0.87, cy + r * 0.5)
    ctx.closePath()
    ctx.fillStyle = color + 'cc'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 0.8 / z
    ctx.stroke()
  } else {
    // Circle for workers and footmen
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + 'cc'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 0.8 / z
    ctx.stroke()
  }

  // HP bar (only when zoomed enough to be useful)
  if (z > 1.5 && u.maxHp > 0) {
    const barW = tw * 0.9
    const barH = Math.max(1.5, th * 0.12) / z
    const barX = cx - barW / 2
    const barY = cy - r - barH - 1 / z
    const pct  = Math.max(0, u.hp / u.maxHp)
    const hpColor = pct > 0.6 ? '#33ff66' : pct > 0.3 ? '#ffcc00' : '#ff3322'

    ctx.fillStyle = '#111'
    ctx.fillRect(barX, barY, barW, barH)
    ctx.fillStyle = hpColor
    ctx.fillRect(barX, barY, barW * pct, barH)
  }
}
