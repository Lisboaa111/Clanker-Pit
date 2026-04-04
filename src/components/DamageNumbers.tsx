import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

interface DmgNumber {
  id: number
  screenX: number
  screenY: number
  amount: number
  born: number
  crit: boolean
}

let nextId = 0

// Expose camera globally from GameView so we can project 3D → 2D
declare global {
  interface Window {
    __camera?: THREE.PerspectiveCamera
  }
}

const LIFETIME_MS = 900

export function DamageNumbers() {
  const [nums, setNums] = useState<DmgNumber[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const onDmg = (e: Event) => {
      const { x, y, z, amount, crit = false } = (e as CustomEvent<{ x: number; y: number; z: number; amount: number; crit?: boolean }>).detail
      const cam = window.__camera
      if (!cam) return

      const vec = new THREE.Vector3(x, y, z)
      vec.project(cam)

      const screenX = ((vec.x + 1) / 2) * window.innerWidth
      const screenY = ((-vec.y + 1) / 2) * window.innerHeight

      const entry: DmgNumber = { id: nextId++, screenX, screenY, amount, born: performance.now(), crit }
      setNums(prev => [...prev, entry])
    }

    window.addEventListener('dmg-number', onDmg)
    return () => window.removeEventListener('dmg-number', onDmg)
  }, [])

  // Prune old entries via rAF
  useEffect(() => {
    const loop = () => {
      const now = performance.now()
      setNums(prev => {
        const filtered = prev.filter(n => now - n.born < LIFETIME_MS)
        return filtered.length === prev.length ? prev : filtered
      })
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
      {nums.map(n => {
        const age = performance.now() - n.born
        const progress = age / LIFETIME_MS            // 0 → 1
        const opacity = Math.max(0, 1 - progress)
        const floatY = progress * 40                  // float up 40px
        return (
          <div
            key={n.id}
            style={{
              position: 'absolute',
              left: n.screenX,
              top: n.screenY - floatY,
              transform: 'translate(-50%, -50%)',
              opacity,
              color: n.crit ? '#ff8800' : '#ff4444',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              fontSize: n.crit ? '16px' : '13px',
              textShadow: '0 0 4px #000, 0 1px 2px #000',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            -{n.amount}
          </div>
        )
      })}
    </div>
  )
}
