import { useEffect, useRef, useState } from 'react'
import { BuildingInfo, BuildingType, HUDUpdate, TrainingQueueItem, UnitType } from '../game/types'
import {
  TRAIN_WORKER_GOLD, TRAIN_WORKER_LUMBER, TRAIN_WORKER_TIME,
  TRAIN_FOOTMAN_GOLD, TRAIN_FOOTMAN_LUMBER, TRAIN_FOOTMAN_TIME,
  TRAIN_ARCHER_GOLD, TRAIN_ARCHER_LUMBER, TRAIN_ARCHER_TIME,
  TOWER_ATTACK_RANGE, TOWER_ATTACK_DAMAGE,
} from '../game/constants'

interface BuildingSelectedEvent {
  buildingId: string
  screenX: number
  screenY: number
}

const BUILDING_ICONS: Record<BuildingType, string> = {
  [BuildingType.TOWN_HALL]: '🏰',
  [BuildingType.BARRACKS]:  '🏛',
  [BuildingType.FARM]:      '🌾',
  [BuildingType.TOWER]:     '🗼',
}

const BUILDING_NAMES: Record<BuildingType, string> = {
  [BuildingType.TOWN_HALL]: 'Town Hall',
  [BuildingType.BARRACKS]:  'Barracks',
  [BuildingType.FARM]:      'Farm',
  [BuildingType.TOWER]:     'Guard Tower',
}

export function BuildingModal() {
  const [open, setOpen]               = useState(false)
  const [pos, setPos]                 = useState({ x: 0, y: 0 })
  const [buildingId, setBuildingId]   = useState<string | null>(null)
  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo | null>(null)
  const [gold, setGold]               = useState(0)
  const [lumber, setLumber]           = useState(0)
  const [supply, setSupply]           = useState(0)
  const [supplyMax, setSupplyMax]     = useState(5)
  const buildingIdRef                 = useRef<string | null>(null)

  // Listen for building selection / deselection
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<BuildingSelectedEvent | null>).detail
      if (!d) {
        setOpen(false)
        setBuildingId(null)
        buildingIdRef.current = null
        return
      }
      setOpen(true)
      setBuildingId(d.buildingId)
      buildingIdRef.current = d.buildingId
      setPos({ x: d.screenX, y: d.screenY })
    }
    window.addEventListener('building-selected', h)
    return () => window.removeEventListener('building-selected', h)
  }, [])

  // Get live building state from HUD updates
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<HUDUpdate>).detail
      setGold(d.gold)
      setLumber(d.lumber)
      setSupply(d.playerSupply)
      setSupplyMax(d.playerSupplyMax)
      const id = buildingIdRef.current
      if (id) {
        const info = d.buildings.find(b => b.id === id)
        if (info) {
          setBuildingInfo(info)
        } else {
          setOpen(false)
          setBuildingId(null)
          buildingIdRef.current = null
        }
      }
    }
    window.addEventListener('hud-update', h)
    return () => window.removeEventListener('hud-update', h)
  }, [])

  const trainUnit = (unitType: UnitType) => {
    if (!buildingId) return
    window.dispatchEvent(new CustomEvent('train-unit', { detail: { buildingId, unitType } }))
  }

  if (!open || !buildingInfo) return null

  const hpPct    = buildingInfo.hp / buildingInfo.maxHp
  const hpColor  = hpPct > 0.6 ? '#00cc44' : hpPct > 0.3 ? '#ddaa00' : '#dd2200'
  const supplyFull = supply >= supplyMax
  const btype = buildingInfo.type as BuildingType

  const canAffordWorker  = gold >= TRAIN_WORKER_GOLD  && lumber >= TRAIN_WORKER_LUMBER  && !supplyFull
  const canAffordFootman = gold >= TRAIN_FOOTMAN_GOLD && lumber >= TRAIN_FOOTMAN_LUMBER && !supplyFull
  const canAffordArcher  = gold >= TRAIN_ARCHER_GOLD  && lumber >= TRAIN_ARCHER_LUMBER  && !supplyFull

  // Clamp position to viewport
  const modalW = 230
  const modalH = 300
  const left = Math.min(Math.max(8, pos.x - modalW / 2), window.innerWidth - modalW - 8)
  const top  = Math.min(Math.max(8, pos.y - modalH - 20), window.innerHeight - modalH - 8)

  return (
    <div
      style={{ position: 'absolute', left, top, width: modalW }}
      className="bg-black/92 border border-white/25 rounded-lg p-3 select-none z-20 font-mono text-xs shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/80 font-bold">
          {BUILDING_ICONS[btype]} {BUILDING_NAMES[btype]}
        </span>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('building-selected', { detail: null }))}
          className="text-white/30 hover:text-white/70 text-xs leading-none"
        >✕</button>
      </div>

      {/* Under construction notice */}
      {buildingInfo.underConstruction && (
        <div className="mb-2">
          <div className="text-yellow-400/80 text-[10px] mb-1">🔨 Under construction…</div>
          <div className="w-full h-2 bg-white/10 rounded overflow-hidden">
            <div
              className="h-full bg-yellow-400 rounded transition-all"
              style={{ width: `${buildingInfo.buildProgress * 100}%` }}
            />
          </div>
          <div className="text-white/30 text-[9px] mt-0.5 text-right">
            {Math.round(buildingInfo.buildProgress * 100)}%
          </div>
        </div>
      )}

      {/* HP bar */}
      <div className="mb-2">
        <div className="flex justify-between text-[10px] text-white/40 mb-0.5">
          <span>HP</span>
          <span>{buildingInfo.hp} / {buildingInfo.maxHp}</span>
        </div>
        <div className="w-full h-2 bg-white/10 rounded overflow-hidden">
          <div className="h-full rounded transition-all" style={{ width: `${hpPct * 100}%`, background: hpColor }} />
        </div>
      </div>

      {/* Content by building type */}
      {!buildingInfo.underConstruction && (
        <>
          {/* Training queue (Town Hall + Barracks) */}
          {buildingInfo.trainingQueue.length > 0 && (
            <div className="mb-2">
              <div className="text-white/40 text-[10px] mb-1">Training queue</div>
              {buildingInfo.trainingQueue.map((item, i) => (
                <QueueItem key={i} item={item} />
              ))}
            </div>
          )}

          <div className="border-t border-white/10 pt-2 space-y-1.5">
            {/* TOWN HALL: train worker */}
            {btype === BuildingType.TOWN_HALL && (
              <>
                {supplyFull && <SupplyFullWarning supply={supply} supplyMax={supplyMax} />}
                <TrainButton
                  label="Train Worker"
                  cost={`${TRAIN_WORKER_GOLD}g`}
                  time={TRAIN_WORKER_TIME}
                  enabled={canAffordWorker}
                  icon="⛏"
                  onClick={() => trainUnit(UnitType.WORKER)}
                />
              </>
            )}

            {/* BARRACKS: train footman + archer */}
            {btype === BuildingType.BARRACKS && (
              <>
                {supplyFull && <SupplyFullWarning supply={supply} supplyMax={supplyMax} />}
                <TrainButton
                  label="Train Footman"
                  cost={`${TRAIN_FOOTMAN_GOLD}g`}
                  time={TRAIN_FOOTMAN_TIME}
                  enabled={canAffordFootman}
                  icon="🛡"
                  onClick={() => trainUnit(UnitType.FOOTMAN)}
                />
                <TrainButton
                  label="Train Archer"
                  cost={`${TRAIN_ARCHER_GOLD}g + ${TRAIN_ARCHER_LUMBER}w`}
                  time={TRAIN_ARCHER_TIME}
                  enabled={canAffordArcher}
                  icon="🏹"
                  onClick={() => trainUnit(UnitType.ARCHER)}
                />
              </>
            )}

            {/* FARM: supply info */}
            {btype === BuildingType.FARM && (
              <div className="space-y-1">
                <div className="text-white/60 text-[11px]">🌾 Provides food supply</div>
                <div className="text-green-400 text-[11px]">+10 supply cap</div>
                <div className="text-white/40 text-[10px]">
                  Population: {supply} / {supplyMax}
                </div>
              </div>
            )}

            {/* TOWER: attack info */}
            {btype === BuildingType.TOWER && (
              <div className="space-y-1">
                <div className="text-white/60 text-[11px]">🗼 Auto-attacks nearby enemies</div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/40">Range</span>
                  <span className="text-white/70">{TOWER_ATTACK_RANGE} units</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/40">Damage</span>
                  <span className="text-red-400">{TOWER_ATTACK_DAMAGE} per shot</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SupplyFullWarning({ supply, supplyMax }: { supply: number; supplyMax: number }) {
  return (
    <div className="text-orange-400 text-[10px] bg-orange-400/10 rounded px-2 py-1 mb-1">
      👥 Supply full ({supply}/{supplyMax}) — build a Farm
    </div>
  )
}

function QueueItem({ item }: { item: TrainingQueueItem }) {
  const pct = 1 - item.timer / item.duration
  const labels: Record<UnitType, string> = {
    [UnitType.WORKER]:  '⛏ Worker',
    [UnitType.FOOTMAN]: '🛡 Footman',
    [UnitType.ARCHER]:  '🏹 Archer',
  }
  return (
    <div className="mb-1">
      <div className="flex justify-between text-[10px] text-white/50 mb-0.5">
        <span>{labels[item.unitType]}</span>
        <span>{Math.ceil(item.timer)}s</span>
      </div>
      <div className="w-full h-1.5 bg-white/10 rounded overflow-hidden">
        <div className="h-full bg-blue-400 rounded transition-all" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  )
}

function TrainButton({
  label, cost, time, enabled, icon, onClick
}: {
  label: string; cost: string; time: number; enabled: boolean; icon: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      className={[
        'w-full text-left px-2 py-1.5 rounded border transition-colors',
        enabled
          ? 'border-white/20 hover:bg-white/10 text-white/80 cursor-pointer'
          : 'border-white/8 text-white/25 cursor-not-allowed',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <span>{icon} {label}</span>
        <span className="text-[10px] text-white/40">{time}s</span>
      </div>
      <div className="text-[10px] text-yellow-400/70 mt-0.5">{cost}</div>
    </button>
  )
}
