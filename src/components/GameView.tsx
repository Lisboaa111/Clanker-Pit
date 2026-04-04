import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createScene } from '../three/scene'
import { createCamera } from '../three/camera'
import { createRenderer } from '../three/renderer'
import { initGameState } from '../game/gameState'
import { createGameLoop } from '../game/gameLoop'
import { createInputSystem } from '../game/input'

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!

    const scene    = createScene()
    const renderer = createRenderer(canvas)
    const camCtrl  = createCamera(window.innerWidth / window.innerHeight)
    const state    = initGameState(scene)

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

    // Pass scene so setWorkerSelected can add/remove path lines correctly
    const input = createInputSystem(canvas, camCtrl.camera, scene, () => state, getPickTargets)

    canvas.addEventListener('wheel', (e) => { e.preventDefault(); camCtrl.onWheel(e) }, { passive: false })

    const loop = createGameLoop(scene, renderer, camCtrl, state, input)
    loop.start()

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight)
      camCtrl.camera.aspect = window.innerWidth / window.innerHeight
      camCtrl.camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      loop.stop()
      input.destroy()
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      ;(window as any).__gameState = null
      ;(window as any).__camera = null
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
}
