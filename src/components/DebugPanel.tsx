import { useEffect, useState } from 'react'
import { HUDUpdate, SelectedWorkerInfo, UnitType, WorkerState } from '../game/types'

const STATE_COLOR: Record<WorkerState, string> = {
  [WorkerState.IDLE]:               'text-gray-400',
  [WorkerState.MOVING_TO_TARGET]:   'text-blue-300',
  [WorkerState.MOVING_TO_RESOURCE]: 'text-cyan-400',
  [WorkerState.GATHERING]:          'text-yellow-400',
  [WorkerState.MOVING_TO_TOWNHALL]: 'text-orange-400',
  [WorkerState.DEPOSITING]:         'text-green-400',
  [WorkerState.MOVING_TO_ATTACK]:   'text-red-400',
  [WorkerState.ATTACKING]:          'text-red-500',
  [WorkerState.BUILDING]:           'text-purple-400',
}

const STATE_DOT: Record<WorkerState, string> = {
  [WorkerState.IDLE]:               'bg-gray-500',
  [WorkerState.MOVING_TO_TARGET]:   'bg-blue-400',
  [WorkerState.MOVING_TO_RESOURCE]: 'bg-cyan-400',
  [WorkerState.GATHERING]:          'bg-yellow-400',
  [WorkerState.MOVING_TO_TOWNHALL]: 'bg-orange-400',
  [WorkerState.DEPOSITING]:         'bg-green-400',
  [WorkerState.MOVING_TO_ATTACK]:   'bg-red-400',
  [WorkerState.ATTACKING]:          'bg-red-500',
  [WorkerState.BUILDING]:           'bg-purple-400',
}

const UNIT_ICON: Record<UnitType, string> = {
  [UnitType.WORKER]:  '⛏',
  [UnitType.FOOTMAN]: '🛡',
  [UnitType.ARCHER]:  '🏹',
}

export function DebugPanel() {
  const [open, setOpen] = useState(true)
  const [data, setData] = useState<HUDUpdate | null>(null)

  useEffect(() => {
    const h = (e: Event) => setData((e as CustomEvent<HUDUpdate>).detail)
    window.addEventListener('hud-update', h)
    return () => window.removeEventListener('hud-update', h)
  }, [])

  if (!data) return null

  const p0 = data.allWorkers.filter(w => w.playerId === 0)
  const p1 = data.allWorkers.filter(w => w.playerId === 1)

  return (
    <div className="absolute top-14 right-2 z-10 select-none font-mono text-xs w-56">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left bg-black/80 border border-white/20 rounded-t px-3 py-1
                   text-white/60 hover:text-white/90 transition-colors flex justify-between"
      >
        <span>DEBUG</span><span>{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="bg-black/85 border border-t-0 border-white/20 rounded-b p-3
                        space-y-1 max-h-[80vh] overflow-y-auto">
          <Row label="FPS"        value={data.fps} />
          <Row label="Supply"     value={`${data.playerSupply}/${data.playerSupplyMax}`} />
          <Row label="Gold mines" value={data.goldMinesRemaining} />
          <Row label="Trees"      value={data.treesRemaining} />
          <Row label="Camera"     value={`${data.cameraX}, ${data.cameraZ}`} />
          {data.lastRaycastTile && (
            <Row label="Tile" value={`${data.lastRaycastTile.x},${data.lastRaycastTile.z}`} />
          )}

          <PlayerSection label="Blue" workers={p0} dotClass="bg-blue-500" labelClass="text-blue-400" />
          <PlayerSection label="Red"  workers={p1} dotClass="bg-red-500"  labelClass="text-red-400"  />
        </div>
      )}
    </div>
  )
}

function PlayerSection({ label, workers, dotClass, labelClass }: {
  label: string; workers: SelectedWorkerInfo[]; dotClass: string; labelClass: string
}) {
  return (
    <>
      <div className={`border-t border-white/10 mt-2 pt-2 text-[10px] uppercase tracking-wider
                       flex items-center gap-1.5 ${labelClass}`}>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        {label} ({workers.length})
      </div>
      {workers.map(w => <WorkerRow key={w.id} worker={w} />)}
    </>
  )
}

function WorkerRow({ worker: w }: { worker: SelectedWorkerInfo }) {
  const hpPct  = w.hp / w.maxHp
  const carPct = w.maxCarry > 0 ? w.carryAmount / w.maxCarry : 0
  const hpCol  = hpPct > 0.6 ? 'bg-green-500' : hpPct > 0.3 ? 'bg-yellow-400' : 'bg-red-500'

  return (
    <div className="border-l-2 border-white/10 pl-2 py-0.5 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATE_DOT[w.state as WorkerState] ?? 'bg-gray-500'}`} />
        <span className="text-white/50 text-[10px]">
          {UNIT_ICON[w.unitType] ?? '?'} {w.id}
        </span>
      </div>
      <div className={`text-[10px] font-bold pl-3 ${STATE_COLOR[w.state as WorkerState] ?? 'text-white/40'}`}>
        {w.state.replace(/_/g, ' ')}
      </div>
      {/* HP bar */}
      <div className="pl-3">
        <div className="w-full h-1 bg-white/10 rounded">
          <div className={`h-full rounded ${hpCol}`} style={{ width: `${hpPct * 100}%` }} />
        </div>
        <div className="text-[9px] text-white/30">{Math.ceil(w.hp)}/{w.maxHp} hp · path:{w.pathLength}</div>
      </div>
      {w.carryAmount > 0 && (
        <div className="pl-3">
          <div className="w-full h-1 bg-white/10 rounded">
            <div
              className={`h-full rounded ${w.carryType === 'gold' ? 'bg-yellow-400' : 'bg-green-500'}`}
              style={{ width: `${carPct * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-white/40">{label}</span>
      <span className="text-white/80">{String(value)}</span>
    </div>
  )
}
