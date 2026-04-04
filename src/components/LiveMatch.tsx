/**
 * LiveMatch — real-time match viewer driven by the server SSE stream.
 * No local simulation: the server is the source of truth.
 * Same canvas rendering as MatchReplay but live.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { MAP_WIDTH, MAP_HEIGHT } from '../game/constants'

const API      = 'http://localhost:3001'
const CANVAS_W = 800
const CANVAS_H = 800

interface SerializedUnit {
  id: string; type: string; tx: number; tz: number
  hp: number; maxHp: number; state: string; level: number
  busy: boolean; carry?: { type: string; amount: number } | null
}
interface SerializedBuilding {
  id: string; type: string; tx: number; tz: number
  hp: number; maxHp: number; level: number
  underConstruction: boolean; upgrading: boolean
  trainingQueue?: Array<{ unit: string; progress: number }>
}
interface SerializedResource { id: string; type: string; tx: number; tz: number; amount: number }

interface PlayerSnap {
  tick: number; playerId: number
  gold: number; lumber: number; supply: number; supplyMax: number
  myUnits: SerializedUnit[]; myBuildings: SerializedBuilding[]
  enemyUnits: SerializedUnit[]; enemyBuildings: SerializedBuilding[]
  resources: SerializedResource[]
}

interface LiveFrame {
  tick: number
  player0: PlayerSnap
  player1: PlayerSnap
  r0: string; r1: string
}

interface GameOverEvent { winnerId: number; winnerAgentId: string; tick: number }

interface Props {
  matchId: string
  onMatchOver?: (e: GameOverEvent) => void
}

// ── Colours ───────────────────────────────────────────────────────────────────
const P_COLOR = ['#4488ff', '#ff3322'] as const

export function LiveMatch({ matchId, onMatchOver }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame]   = useState<LiveFrame | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting')
  const [winner, setWinner] = useState<GameOverEvent | null>(null)

  const zoom = useRef(1)
  const pan  = useRef({ x: 0, y: 0 })
  const drag = useRef({ active: false, sx: 0, sy: 0, px: 0, py: 0 })
  const [, forceRedraw] = useState(0)
  const redraw = useCallback(() => forceRedraw(n => n + 1), [])

  // ── SSE connection ────────────────────────────────────────────────────────
  useEffect(() => {
    const url = `${API}/game/stream/${matchId}`  // no playerId → spectator (both players)
    const es  = new EventSource(url)

    es.addEventListener('tick', (e) => {
      try {
        const data = JSON.parse(e.data) as LiveFrame
        setFrame(data)
        setStatus('live')
      } catch {}
    })

    es.addEventListener('gameover', (e) => {
      try {
        const data = JSON.parse(e.data) as GameOverEvent
        setWinner(data)
        setStatus('ended')
        onMatchOver?.(data)
      } catch {}
      es.close()
    })

    es.onerror = () => {
      if (status === 'connecting') setStatus('error')
      es.close()
    }

    return () => es.close()
  }, [matchId])  // eslint-disable-line

  // ── Draw canvas ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !frame) return
    drawLiveFrame(canvasRef.current, frame, zoom.current, pan.current)
  }, [frame, forceRedraw])  // eslint-disable-line

  // ── Zoom/pan events ───────────────────────────────────────────────────────
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
      const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.5, Math.min(8, zoom.current * factor))
      pan.current.x = cx - (cx - pan.current.x) * (newZoom / zoom.current)
      pan.current.y = cy - (cy - pan.current.y) * (newZoom / zoom.current)
      zoom.current  = newZoom
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
      pan.current.x = drag.current.px + (e.clientX - drag.current.sx) * (CANVAS_W / rect.width)
      pan.current.y = drag.current.py + (e.clientY - drag.current.sy) * (CANVAS_H / rect.height)
      redraw()
    }
    const onPointerUp = () => { drag.current.active = false }

    canvas.addEventListener('wheel',         onWheel,        { passive: false })
    canvas.addEventListener('pointerdown',   onPointerDown)
    canvas.addEventListener('pointermove',   onPointerMove)
    canvas.addEventListener('pointerup',     onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    return () => {
      canvas.removeEventListener('wheel',         onWheel)
      canvas.removeEventListener('pointerdown',   onPointerDown)
      canvas.removeEventListener('pointermove',   onPointerMove)
      canvas.removeEventListener('pointerup',     onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
    }
  }, [redraw])

  const fitView = () => { zoom.current = 1; pan.current = { x: 0, y: 0 }; redraw() }
  const zoomIn  = () => { zoom.current = Math.min(8, zoom.current * 1.3); redraw() }
  const zoomOut = () => { zoom.current = Math.max(0.5, zoom.current / 1.3); redraw() }

  const p0 = frame?.player0
  const p1 = frame?.player1

  const dimBtn    = 'font-pixel border border-[#222] text-[#555] hover:border-[#444] hover:text-[#777] transition-all'
  const activeBtn = 'font-pixel border border-[#33ff66]/60 text-[#33ff66] hover:bg-[#33ff66]/10 transition-all'

  return (
    <div className="p-4 space-y-3 fade-in-up select-none">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-pixel text-[#333]" style={{ fontSize: '8px' }}>
            {matchId.slice(0, 8).toUpperCase()}…
          </span>
          <StatusBadge status={status} tick={frame?.tick} />
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

      {/* Canvas */}
      <div className="flex justify-center">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="border border-[#222] cursor-crosshair block"
          style={{ width: '100%', maxWidth: '700px', aspectRatio: '1', imageRendering: 'pixelated', touchAction: 'none' }}
        />
      </div>

      {/* Game over banner */}
      {winner && (
        <div className="border border-[#33ff66]/40 bg-[#33ff66]/5 p-3 text-center">
          <div className="font-pixel text-[#33ff66]" style={{ fontSize: '12px' }}>GAME OVER</div>
          <div className="font-pixel text-[#aaa] mt-1" style={{ fontSize: '8px' }}>
            WINNER: {winner.winnerAgentId} in {winner.tick} ticks
          </div>
        </div>
      )}

      {/* Player panels */}
      <div className="grid grid-cols-2 gap-3">
        {([0, 1] as const).map(pid => {
          const snap   = pid === 0 ? p0 : p1
          const reason = pid === 0 ? frame?.r0 : frame?.r1
          const color  = P_COLOR[pid]
          const workers  = snap?.myUnits.filter(u => u.type === 'Worker').length  ?? 0
          const footmen  = snap?.myUnits.filter(u => u.type === 'Footman').length ?? 0
          const archers  = snap?.myUnits.filter(u => u.type === 'Archer').length  ?? 0

          return (
            <div key={pid} className="bg-[#0a0a0a] border border-[#1a1a1a] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="font-pixel" style={{ fontSize: '8px', color }}>P{pid + 1}</span>
              </div>
              {snap ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <StatRow label="GOLD"   value={snap.gold}   color="#ffd700" />
                    <StatRow label="LUMBER" value={snap.lumber} color="#4caf50" />
                    <StatRow label="SUPPLY" value={`${snap.supply}/${snap.supplyMax}`} color="#aaa" />
                    <StatRow label="BLDGS"  value={snap.myBuildings.length} color="#aaa" />
                  </div>
                  <div className="flex gap-3 pt-1 border-t border-[#111]">
                    <UnitBadge label="W" count={workers} color="#aaa"  />
                    <UnitBadge label="F" count={footmen} color={color} />
                    <UnitBadge label="A" count={archers} color={color} />
                  </div>
                  <div className="pt-1 border-t border-[#111]">
                    <div className="font-pixel text-[#333] mb-1" style={{ fontSize: '6px' }}>REASONING</div>
                    <div className="font-mono text-[10px] leading-snug max-h-16 overflow-y-auto pr-1"
                      style={{ color: reason ? '#888' : '#2a2a2a' }}>
                      {reason || '—'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="font-pixel text-[#333]" style={{ fontSize: '7px' }}>WAITING…</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, tick }: { status: string; tick?: number }) {
  const cfg: Record<string, { color: string; label: string }> = {
    connecting: { color: '#ffd700', label: 'CONNECTING' },
    live:       { color: '#33ff66', label: `LIVE  TICK ${tick ?? 0}` },
    ended:      { color: '#555',    label: 'ENDED' },
    error:      { color: '#ff4444', label: 'ERROR' },
  }
  const { color, label } = cfg[status] ?? cfg.error
  return (
    <span className="font-pixel" style={{ fontSize: '7px', color }}>
      {status === 'live' && <span className="blink">● </span>}
      {label}
    </span>
  )
}

function StatRow({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-pixel text-[#333]" style={{ fontSize: '6px' }}>{label}</span>
      <span className="font-mono text-xs font-bold" style={{ color }}>{value}</span>
    </div>
  )
}

function UnitBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-pixel" style={{ fontSize: '7px', color }}>{label}</span>
      <span className="font-mono text-xs text-[#666]">{count}</span>
    </div>
  )
}

// ── Canvas drawing (shared with MatchReplay) ──────────────────────────────────

function drawLiveFrame(
  canvas: HTMLCanvasElement,
  frame: LiveFrame,
  z: number,
  p: { x: number; y: number },
) {
  const ctx = canvas.getContext('2d')!
  const tw  = CANVAS_W / MAP_WIDTH
  const th  = CANVAS_H / MAP_HEIGHT

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#0a100a'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  ctx.setTransform(z, 0, 0, z, p.x, p.y)

  // Grid
  ctx.strokeStyle = '#111'; ctx.lineWidth = 0.5 / z
  for (let x = 0; x <= MAP_WIDTH; x++) {
    ctx.beginPath(); ctx.moveTo(x * tw, 0); ctx.lineTo(x * tw, CANVAS_H); ctx.stroke()
  }
  for (let zz = 0; zz <= MAP_HEIGHT; zz++) {
    ctx.beginPath(); ctx.moveTo(0, zz * th); ctx.lineTo(CANVAS_W, zz * th); ctx.stroke()
  }

  const snap = frame.player0  // use P0 perspective for main map

  // Resources
  for (const r of snap.resources) {
    ctx.fillStyle = r.type === 'gold' ? '#c9941a' : '#1e6b10'
    ctx.fillRect(r.tx * tw + 0.5, r.tz * th + 0.5, tw - 1, th - 1)
    if (z > 2) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.font = `${Math.max(4, tw * 0.3 * z) / z}px monospace`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(r.amount), (r.tx + 0.5) * tw, (r.tz + 0.5) * th)
    }
  }

  // Buildings
  const drawBuildings = (buildings: SerializedBuilding[], color: string) => {
    for (const b of buildings) {
      ctx.fillStyle   = color + (b.underConstruction ? '66' : 'cc')
      ctx.strokeStyle = color; ctx.lineWidth = 1 / z
      ctx.fillRect(b.tx * tw, b.tz * th, tw * 2, th * 2)
      ctx.strokeRect(b.tx * tw, b.tz * th, tw * 2, th * 2)
      if (z > 1.5) {
        const lbl = { TownHall: 'TH', Barracks: 'BR', Farm: 'FM', Tower: 'TW' }[b.type] ?? b.type[0]
        ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.font = `bold ${Math.max(5, tw * 0.5 * z) / z}px monospace`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(lbl, (b.tx + 1) * tw, (b.tz + 1) * th)
      }
    }
  }
  drawBuildings(snap.myBuildings,    P_COLOR[0])
  drawBuildings(snap.enemyBuildings, P_COLOR[1])

  // Units
  const drawUnit = (u: SerializedUnit, pid: number) => {
    const color = P_COLOR[pid]
    const r  = u.type === 'Footman' ? tw * 0.55 : u.type === 'Archer' ? tw * 0.4 : tw * 0.32
    const cx = (u.tx + 0.5) * tw; const cy = (u.tz + 0.5) * th
    if (u.type === 'Archer') {
      ctx.beginPath()
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.87, cy + r * 0.5); ctx.lineTo(cx - r * 0.87, cy + r * 0.5)
      ctx.closePath()
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
    ctx.fillStyle = color + 'cc'; ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 0.8 / z; ctx.stroke()

    if (z > 1.5 && u.maxHp > 0) {
      const pct  = Math.max(0, u.hp / u.maxHp)
      const barW = tw * 0.9; const barH = Math.max(1.5, th * 0.12) / z
      const barX = cx - barW / 2; const barY = cy - r - barH - 1 / z
      ctx.fillStyle = '#111'; ctx.fillRect(barX, barY, barW, barH)
      ctx.fillStyle = pct > 0.6 ? '#33ff66' : pct > 0.3 ? '#ffcc00' : '#ff3322'
      ctx.fillRect(barX, barY, barW * pct, barH)
    }
  }

  for (const u of snap.myUnits)    drawUnit(u, 0)
  for (const u of snap.enemyUnits) drawUnit(u, 1)
  // Use P1's own snap for richer P1 unit detail
  for (const u of frame.player1.myUnits) drawUnit(u, 1)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
