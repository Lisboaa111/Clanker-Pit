import { useEffect, useState } from 'react'
import { HUDUpdate, SelectedWorkerInfo, WorkerState, ResourceType, UnitType } from '../game/types'

const STATE_COLORS: Record<WorkerState, string> = {
  [WorkerState.IDLE]:               'text-gray-400',
  [WorkerState.MOVING_TO_TARGET]:   'text-blue-400',
  [WorkerState.MOVING_TO_RESOURCE]: 'text-cyan-400',
  [WorkerState.GATHERING]:          'text-yellow-400',
  [WorkerState.MOVING_TO_TOWNHALL]: 'text-orange-400',
  [WorkerState.DEPOSITING]:         'text-green-400',
  [WorkerState.MOVING_TO_ATTACK]:   'text-red-400',
  [WorkerState.ATTACKING]:          'text-red-500',
  [WorkerState.BUILDING]:           'text-purple-400',
}

const STATE_ICONS: Record<WorkerState, string> = {
  [WorkerState.IDLE]:               '😴',
  [WorkerState.MOVING_TO_TARGET]:   '🏃',
  [WorkerState.MOVING_TO_RESOURCE]: '🏃',
  [WorkerState.GATHERING]:          '⛏',
  [WorkerState.MOVING_TO_TOWNHALL]: '🏃',
  [WorkerState.DEPOSITING]:         '📦',
  [WorkerState.MOVING_TO_ATTACK]:   '⚔️',
  [WorkerState.ATTACKING]:          '⚔️',
  [WorkerState.BUILDING]:           '🔨',
}

const UNIT_ICONS: Record<UnitType, string> = {
  [UnitType.WORKER]:  '⛏',
  [UnitType.FOOTMAN]: '🛡',
  [UnitType.ARCHER]:  '🏹',
}

const UNIT_LABELS: Record<UnitType, string> = {
  [UnitType.WORKER]:  'Worker',
  [UnitType.FOOTMAN]: 'Footman',
  [UnitType.ARCHER]:  'Archer',
}

export function UnitPanel() {
  const [workers, setWorkers]     = useState<SelectedWorkerInfo[]>([])
  const [attackMode, setAttackMode] = useState(false)
  const [buildMode, setBuildMode]  = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<HUDUpdate>).detail
      setWorkers(d.selectedWorkers)
    }
    window.addEventListener('hud-update', handler)
    return () => window.removeEventListener('hud-update', handler)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setAttackMode(e.type === 'keydown' && e.code === 'KeyA')
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup',  (e: KeyboardEvent) => { if (e.code === 'KeyA') setAttackMode(false) })
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    const onBuildMode = (e: Event) => {
      const { buildingType } = (e as CustomEvent<{ buildingType: string | null }>).detail
      setBuildMode(buildingType !== null)
    }
    window.addEventListener('build-mode-changed', onBuildMode)
    return () => window.removeEventListener('build-mode-changed', onBuildMode)
  }, [])

  // "Build" button for workers
  const hasWorkers = workers.some(w => w.unitType === UnitType.WORKER)
  const onBuildBarracks = () => window.dispatchEvent(new CustomEvent('enter-build-mode', { detail: { buildingType: 'barracks' } }))
  const onBuildFarm     = () => window.dispatchEvent(new CustomEvent('enter-build-mode', { detail: { buildingType: 'farm' } }))
  const onBuildTower    = () => window.dispatchEvent(new CustomEvent('enter-build-mode', { detail: { buildingType: 'tower' } }))

  if (workers.length === 0 && !attackMode && !buildMode) {
    return (
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 mb-2
                      bg-black/60 border border-white/10 rounded-lg px-6 py-3
                      text-white/30 text-xs font-mono select-none z-10">
        Click a unit to select • Right-click to command • Hold A + right-click for attack-move
      </div>
    )
  }

  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 mb-2
                    bg-black/75 border border-blue-500/40 rounded-lg px-4 py-3
                    flex flex-col gap-2 select-none z-10 max-w-4xl">

      {/* Attack-move or Build-mode status strip */}
      {attackMode && (
        <div className="text-center text-xs font-mono text-yellow-400 bg-yellow-400/10 rounded px-2 py-1">
          ⚔️ Attack-move — right-click ground to march &amp; engage
        </div>
      )}
      {buildMode && (
        <div className="text-center text-xs font-mono text-purple-300 bg-purple-400/10 rounded px-2 py-1 animate-pulse">
          🏗 Build mode — right-click a grass tile to place • Esc to cancel
        </div>
      )}

      {/* Unit cards */}
      {workers.length > 0 && (
        <div className="flex gap-3 flex-wrap justify-center">
          {workers.map(w => <UnitCard key={w.id} worker={w} />)}
        </div>
      )}

      {/* Build buttons (only shown when workers selected) */}
      {hasWorkers && !buildMode && (
        <div className="border-t border-white/10 pt-2 flex gap-2 justify-center flex-wrap">
          <span className="text-white/40 text-xs font-mono self-center">Build:</span>
          <BuildBtn label="Barracks" cost="150g+100w" icon="🏛" onClick={onBuildBarracks} />
          <BuildBtn label="Farm"     cost="80g+30w"   icon="🌾" onClick={onBuildFarm}     />
          <BuildBtn label="Tower"    cost="120g+80w"  icon="🗼" onClick={onBuildTower}    />
        </div>
      )}
    </div>
  )
}

function UnitCard({ worker: w }: { worker: SelectedWorkerInfo }) {
  const hpPct    = w.maxHp > 0 ? w.hp / w.maxHp : 0
  const carryPct = w.maxCarry > 0 ? w.carryAmount / w.maxCarry : 0
  const hpCol    = hpPct > 0.6 ? 'bg-green-500' : hpPct > 0.3 ? 'bg-yellow-400' : 'bg-red-500'
  const isRegen  = hpPct < 1 && w.state === WorkerState.IDLE

  return (
    <div className="bg-white/5 border border-white/10 rounded p-2 min-w-[120px]">
      {/* Unit type + ID */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm">{UNIT_ICONS[w.unitType]}</span>
        <span className="text-[10px] text-white/30 font-mono">{UNIT_LABELS[w.unitType]}</span>
        {isRegen && <span className="text-green-400 text-[10px]" title="Regenerating">💚</span>}
      </div>

      {/* HP bar */}
      <div className="mb-1">
        <div className="flex justify-between text-[9px] text-white/40 mb-0.5">
          <span>HP</span>
          <span>{Math.ceil(w.hp)}/{w.maxHp}</span>
        </div>
        <div className="w-full h-1.5 bg-white/10 rounded overflow-hidden">
          <div className={`h-full rounded transition-all ${hpCol}`} style={{ width: `${hpPct * 100}%` }} />
        </div>
      </div>

      {/* State */}
      <div className={`text-xs font-bold font-mono flex items-center gap-1 ${STATE_COLORS[w.state]}`}>
        <span>{STATE_ICONS[w.state]}</span>
        <span>{w.state.replace(/_/g, ' ')}</span>
      </div>

      {/* Carry bar (workers only) */}
      {w.carryType && (
        <div className="mt-1">
          <div className="text-xs text-white/40 font-mono">
            {w.carryType === ResourceType.GOLD ? '⛏' : '🪵'} {w.carryAmount}/{w.maxCarry}
          </div>
          <div className="w-full h-1 bg-white/10 rounded mt-0.5">
            <div
              className={`h-full rounded transition-all ${w.carryType === ResourceType.GOLD ? 'bg-yellow-400' : 'bg-green-500'}`}
              style={{ width: `${carryPct * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="text-[9px] text-white/25 font-mono mt-1">
        ({w.tileX},{w.tileZ}) path:{w.pathLength}
      </div>
    </div>
  )
}

function BuildBtn({ label, cost, icon, onClick }: {
  label: string; cost: string; icon: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1 rounded border border-white/20 hover:bg-white/10 transition-colors
                 text-white/70 hover:text-white text-xs font-mono flex items-center gap-1"
    >
      <span>{icon}</span>
      <span>{label}</span>
      <span className="text-yellow-400/60 text-[10px]">{cost}</span>
    </button>
  )
}
