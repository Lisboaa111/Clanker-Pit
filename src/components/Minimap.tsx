import { useEffect, useRef } from 'react'
import { HUDUpdate } from '../game/types'
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../game/constants'
import { TileType } from '../game/types'

const SIZE = 160

const TILE_COLORS: Record<number, string> = {
  [TileType.GRASS]:     '#3d6835',
  [TileType.WATER]:     '#2a5fa5',
  [TileType.TREE]:      '#1d3d1a',
  [TileType.GOLD_MINE]: '#c9941a',
}

// We cache the tile grid snapshot once
let tileCache: ImageData | null = null

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Draw tile background once when map is ready
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, SIZE, SIZE)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent<HUDUpdate>).detail
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!

      // Clear
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, SIZE, SIZE)

      // Draw map tiles from game state (accessed via window for simplicity)
      const gs = (window as any).__gameState
      if (gs) {
        const pw = SIZE / MAP_WIDTH
        const ph = SIZE / MAP_HEIGHT
        for (let z = 0; z < MAP_HEIGHT; z++) {
          for (let x = 0; x < MAP_WIDTH; x++) {
            const tile = gs.map[z]?.[x]
            if (!tile) continue
            ctx.fillStyle = TILE_COLORS[tile.type] ?? '#3d6835'
            ctx.fillRect(x * pw, z * ph, pw + 0.5, ph + 0.5)
          }
        }

        // Town hall
        if (gs.buildings[0]) {
          const b = gs.buildings[0]
          ctx.fillStyle = '#c8a870'
          ctx.fillRect(b.tileX * pw - 1, b.tileZ * ph - 1, pw * 2 + 2, ph * 2 + 2)
        }

        // Workers
        ctx.fillStyle = '#4488ff'
        gs.workers.forEach((w: any) => {
          const tx = Math.floor(w.x / TILE_SIZE)
          const tz = Math.floor(w.z / TILE_SIZE)
          ctx.beginPath()
          ctx.arc(tx * pw + pw / 2, tz * ph + ph / 2, 2, 0, Math.PI * 2)
          ctx.fill()
        })

        // Camera viewport indicator
        const camX = data.cameraX
        const camZ = data.cameraZ
        const viewW = 20  // approximate tiles visible
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.lineWidth = 1
        ctx.strokeRect(
          (camX / TILE_SIZE - viewW / 2) * pw,
          (camZ / TILE_SIZE - viewW / 2) * ph,
          viewW * pw,
          viewW * ph,
        )
      }
    }

    window.addEventListener('hud-update', handler)
    return () => window.removeEventListener('hud-update', handler)
  }, [])

  return (
    <div className="absolute bottom-2 right-2 z-10 select-none">
      <div className="text-xs text-white/40 font-mono mb-0.5 text-right">MINIMAP</div>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="border border-white/20 rounded"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}
