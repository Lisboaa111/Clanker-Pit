import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createScene } from '../three/scene'
import { createCamera } from '../three/camera'
import { createRenderer } from '../three/renderer'
import { initGameState } from '../game/gameState'
import { createGameLoop } from '../game/gameLoop'
import { createInputSystem } from '../game/input'
import { AgentRunner } from '../agent/runner'
import { AgentConfig, HUMAN_PLAYER, PlayerMode } from '../agent/agentTypes'
import { loadCharacterAssets } from '../three/characterLoader'
import { loadSurvivalKitAssets } from '../three/survivalKitLoader'
import { setCharacterAssets, setSurvivalKitAssets } from '../three/meshes'
import { scatterMapDecoration } from '../three/mapDecoration'
import { serializeState } from '../agent/serializer'

const BACKEND = 'http://localhost:3001'

interface Props {
  p0Mode: PlayerMode
  p1Mode: PlayerMode
  apiKey: string
  matchId?: string
}

export function GameView({ p0Mode, p1Mode, apiKey, matchId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [agentStatus, setAgentStatus] = useState<Record<number, string>>({})
  const [assetsLoading, setAssetsLoading] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current!
    let stopped = false
    let cleanupFns: Array<() => void> = []

    ;(async () => {
      // Load both asset packs in parallel before spawning anything
      const [charAssets, skAssets] = await Promise.all([
        loadCharacterAssets(),
        loadSurvivalKitAssets(),
      ])
      if (stopped) return
      setCharacterAssets(charAssets)
      setSurvivalKitAssets(skAssets)
      setAssetsLoading(false)

      const scene    = createScene()
      const renderer = createRenderer(canvas)
      const camCtrl  = createCamera(window.innerWidth / window.innerHeight)
      const state    = initGameState(scene)

      // Scatter environment decoration (rocks, grass, campfires)
      scatterMapDecoration(scene, state.map, skAssets)

      // Expose for minimap, damage numbers & debugging
      ;(window as any).__gameState = state
      ;(window as any).__camera = camCtrl.camera

      const getPickTargets = (): THREE.Object3D[] => {
        const targets: THREE.Object3D[] = []
        state.map.forEach(row => row.forEach(tile => targets.push(tile.mesh)))
        state.workers.forEach(w => { if (!w.dead) targets.push(w.mesh) })
        state.buildings.forEach(b => { if (!b.destroyed) targets.push(b.mesh as unknown as THREE.Object3D) })
        return targets
      }

      // For agent players, disable mouse input control for their player
      const agentPlayerIds = new Set<number>()
      if (p0Mode !== HUMAN_PLAYER) agentPlayerIds.add(0)
      if (p1Mode !== HUMAN_PLAYER) agentPlayerIds.add(1)

      const input = createInputSystem(canvas, camCtrl.camera, scene, () => state, getPickTargets)

      const onWheel = (e: WheelEvent) => { e.preventDefault(); camCtrl.onWheel(e) }
      canvas.addEventListener('wheel', onWheel, { passive: false })

      const loop = createGameLoop(scene, renderer, camCtrl, state, input)
      loop.start()

      // Start agent runners (keyed by playerId for easy reasoning access)
      const runnerMap = new Map<number, AgentRunner>()
      const modes: [number, PlayerMode][] = [[0, p0Mode], [1, p1Mode]]
      for (const [pid, mode] of modes) {
        if (mode === HUMAN_PLAYER) continue
        const cfg = mode as AgentConfig
        const runner = new AgentRunner(cfg, pid, apiKey)
        runner.start(state)
        runnerMap.set(pid, runner)
      }

      // Listen for agent thinking events to update UI
      const onAgentThinking = (e: Event) => {
        const { playerId, reasoning, agentName } = (e as CustomEvent<{
          playerId: number; reasoning: string; agentName: string
        }>).detail
        setAgentStatus(prev => ({ ...prev, [playerId]: `${agentName}: ${reasoning}` }))
      }
      window.addEventListener('agent-thinking', onAgentThinking)

      // If both players are agents, keep currentPlayerId = 0 (doesn't matter, both controlled by runners)
      if (p0Mode === HUMAN_PLAYER && p1Mode !== HUMAN_PLAYER) {
        state.currentPlayerId = 0  // human is p0
      } else if (p0Mode !== HUMAN_PLAYER && p1Mode === HUMAN_PLAYER) {
        state.currentPlayerId = 1  // human is p1
      } else if (p0Mode !== HUMAN_PLAYER && p1Mode !== HUMAN_PLAYER) {
        state.currentPlayerId = 0  // both agents, doesn't matter
      }

      const onResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight)
        camCtrl.camera.aspect = window.innerWidth / window.innerHeight
        camCtrl.camera.updateProjectionMatrix()
      }
      window.addEventListener('resize', onResize)

      // Push game state to backend every 500ms for external agents + replay recording
      let pushIntervalId: ReturnType<typeof setInterval> | null = null
      if (matchId) {
        pushIntervalId = setInterval(() => {
          if (stopped) return
          try {
            const snap0 = serializeState(state, 0)
            const snap1 = serializeState(state, 1)
            const reasoning0 = runnerMap.get(0)?.lastReasoning ?? undefined
            const reasoning1 = runnerMap.get(1)?.lastReasoning ?? undefined
            fetch(`${BACKEND}/game/state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ matchId, tick: state.tick, playerId: 0, stateJson: JSON.stringify(snap0), reasoning: reasoning0 }),
            }).catch(() => {})
            fetch(`${BACKEND}/game/state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ matchId, tick: state.tick, playerId: 1, stateJson: JSON.stringify(snap1), reasoning: reasoning1 }),
            }).catch(() => {})
          } catch {}
        }, 500)
      }

      // On game-over, settle the match in the backend
      const onGameOver = (e: Event) => {
        if (!matchId) return
        const { winnerId } = (e as CustomEvent<{ winnerId: number }>).detail
        // Derive winner agent ID from player index (convention: stored in state or passed via props)
        // For now we use the player index as agentId so the backend can look it up
        fetch(`${BACKEND}/match/${matchId}/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ winnerId: String(winnerId), durationTicks: state.tick }),
        }).catch(() => {})
      }
      window.addEventListener('game-over', onGameOver)

      cleanupFns = [
        () => runnerMap.forEach(r => r.stop()),
        () => loop.stop(),
        () => input.destroy(),
        () => canvas.removeEventListener('wheel', onWheel),
        () => window.removeEventListener('resize', onResize),
        () => window.removeEventListener('agent-thinking', onAgentThinking),
        () => window.removeEventListener('game-over', onGameOver),
        () => { if (pushIntervalId) clearInterval(pushIntervalId) },
        () => renderer.dispose(),
        () => { (window as any).__gameState = null; (window as any).__camera = null },
      ]
    })()

    return () => {
      stopped = true
      cleanupFns.forEach(fn => fn())
    }
  }, []) // intentionally no deps — game init is one-shot

  return (
    <>
      {assetsLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black text-white text-lg font-mono tracking-widest">
          Loading characters…
        </div>
      )}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Agent status overlay */}
      {Object.entries(agentStatus).map(([pid, text]) => (
        <div
          key={pid}
          className={[
            'absolute z-10 max-w-xs text-[10px] font-mono px-2 py-1 rounded',
            'bg-black/50 backdrop-blur-sm border border-white/10 text-white/60',
            Number(pid) === 0 ? 'top-12 left-2' : 'top-12 right-2 text-right',
          ].join(' ')}
        >
          <span className="text-purple-400">🤖 </span>{text}
        </div>
      ))}
    </>
  )
}
