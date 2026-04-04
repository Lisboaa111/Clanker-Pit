import { useEffect, useState } from 'react'
import { HUDUpdate } from '../game/types'
import { PLAYER_NAMES } from '../game/constants'

export function ResourceBar() {
  const [gold, setGold]           = useState(300)
  const [lumber, setLumber]       = useState(150)
  const [fps, setFps]             = useState(0)
  const [playerId, setPlayer]     = useState(0)
  const [supply, setSupply]       = useState(0)
  const [supplyMax, setSupplyMax] = useState(5)
  const [buildMode, setBuildMode] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<HUDUpdate>).detail
      setGold(d.gold)
      setLumber(d.lumber)
      setFps(d.fps)
      setPlayer(d.currentPlayerId)
      setSupply(d.playerSupply)
      setSupplyMax(d.playerSupplyMax)
    }
    window.addEventListener('hud-update', handler)
    return () => window.removeEventListener('hud-update', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const { buildingType } = (e as CustomEvent<{ buildingType: string | null }>).detail
      setBuildMode(buildingType)
    }
    window.addEventListener('build-mode-changed', handler)
    return () => window.removeEventListener('build-mode-changed', handler)
  }, [])

  const playerColor  = playerId === 0 ? '#4488ff' : '#ff3322'
  const playerBorder = playerId === 0 ? 'border-blue-500/60' : 'border-red-500/60'
  const supplyFull   = supply >= supplyMax
  const supplyColor  = supplyFull ? 'text-orange-400' : 'text-white/70'

  return (
    <div className={`absolute top-0 left-1/2 -translate-x-1/2 mt-2 flex items-center gap-4
                     bg-black/50 backdrop-blur-md border ${playerBorder} rounded-lg px-5 py-2 select-none z-10`}>

      {/* Player switcher (debug) */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('switch-player'))}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono font-bold
                   border border-white/20 hover:bg-white/10 transition-colors"
        style={{ color: playerColor }}
        title="Switch active player [DEBUG]"
      >
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: playerColor }} />
        {PLAYER_NAMES[playerId]}
      </button>

      <div className="w-px h-5 bg-white/15" />

      <Stat icon="⛏" label="Gold"   value={gold}   color="text-yellow-400" />
      <div className="w-px h-5 bg-white/15" />
      <Stat icon="🪵" label="Lumber" value={lumber} color="text-green-400" />
      <div className="w-px h-5 bg-white/15" />

      {/* Supply */}
      <div className="flex items-center gap-1.5">
        <span className="text-base">👥</span>
        <div>
          <div className="text-[10px] text-white/40 leading-none">Supply</div>
          <div className={`text-sm font-bold font-mono ${supplyColor}`}>
            {supply} / {supplyMax}
            {supplyFull && <span className="text-[9px] ml-1">FULL</span>}
          </div>
        </div>
      </div>

      <div className="w-px h-5 bg-white/15" />
      <div className="text-white/35 text-xs font-mono">{fps} FPS</div>

      {/* Build-mode indicator */}
      {buildMode && (
        <>
          <div className="w-px h-5 bg-white/15" />
          <div className="text-purple-300 text-xs font-mono animate-pulse">
            📍 Placing {buildMode} — right-click tile
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ icon, label, value, color }: {
  icon: string; label: string; value: number; color: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-base">{icon}</span>
      <div>
        <div className="text-[10px] text-white/40 leading-none">{label}</div>
        <div className={`text-sm font-bold font-mono ${color}`}>{value.toLocaleString()}</div>
      </div>
    </div>
  )
}
