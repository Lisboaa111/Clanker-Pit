import { useEffect, useState } from 'react'
import type { WorkerContextMenuEvent } from '../game/input'
import { WorkerState } from '../game/types'

const STATE_ICONS: Record<string, string> = {
  [WorkerState.IDLE]:               '😴 Idle',
  [WorkerState.MOVING_TO_TARGET]:   '🏃 Moving',
  [WorkerState.MOVING_TO_RESOURCE]: '🏃 Heading to resource',
  [WorkerState.GATHERING]:          '⛏ Gathering',
  [WorkerState.MOVING_TO_TOWNHALL]: '🏃 Returning to base',
  [WorkerState.DEPOSITING]:         '📦 Depositing',
}

export function ContextMenu() {
  const [menu, setMenu] = useState<WorkerContextMenuEvent | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<WorkerContextMenuEvent | null>).detail
      setMenu(d)
    }
    window.addEventListener('worker-context-menu', handler)
    return () => window.removeEventListener('worker-context-menu', handler)
  }, [])

  if (!menu) return null

  const isIdle = menu.workerState === WorkerState.IDLE
  const canStop = !isIdle
  const canResume = menu.hasJob

  function dispatch(type: string) {
    window.dispatchEvent(new CustomEvent('worker-action', {
      detail: { type, workerId: menu!.workerId },
    }))
    setMenu(null)
  }

  const style: React.CSSProperties = {
    left: Math.min(menu.screenX, window.innerWidth - 180),
    top:  Math.min(menu.screenY - 10, window.innerHeight - 160),
  }

  return (
    <div
      className="absolute z-50 bg-black/90 border border-blue-500/50 rounded-lg
                 shadow-xl shadow-black/60 min-w-[160px] overflow-hidden select-none"
      style={style}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-blue-900/40 border-b border-blue-500/30">
        <div className="text-xs text-blue-300 font-mono font-bold">{menu.workerId}</div>
        <div className="text-xs text-white/60 font-mono mt-0.5">
          {STATE_ICONS[menu.workerState] ?? menu.workerState}
        </div>
      </div>

      {/* Actions */}
      <div className="py-1">
        {canStop && (
          <MenuButton
            icon="⏹"
            label="Stop"
            onClick={() => dispatch('stop')}
            color="text-red-400"
          />
        )}
        {canResume && (
          <MenuButton
            icon="▶"
            label="Resume job"
            onClick={() => dispatch('resume')}
            color="text-green-400"
          />
        )}
        {!canStop && !canResume && (
          <div className="px-3 py-2 text-xs text-white/30 font-mono">No actions available</div>
        )}
        <div className="border-t border-white/10 mt-1 pt-1">
          <MenuButton
            icon="✕"
            label="Close"
            onClick={() => setMenu(null)}
            color="text-white/40"
          />
        </div>
      </div>
    </div>
  )
}

function MenuButton({
  icon, label, onClick, color,
}: {
  icon: string
  label: string
  onClick: () => void
  color: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                  hover:bg-white/10 transition-colors text-left ${color}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
