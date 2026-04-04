import { useEffect, useRef, useState } from 'react'

interface BoxState {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function SelectionBox() {
  const [box, setBox] = useState<BoxState | null>(null)

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ active: boolean; x1: number; y1: number; x2: number; y2: number }>).detail
      if (!d.active) { setBox(null); return }
      setBox({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 })
    }
    window.addEventListener('box-select', h)
    return () => window.removeEventListener('box-select', h)
  }, [])

  if (!box) return null

  return (
    <div
      style={{
        position: 'fixed',
        left:   box.x1,
        top:    box.y1,
        width:  box.x2 - box.x1,
        height: box.y2 - box.y1,
        border: '1.5px solid #00ff44',
        background: 'rgba(0, 255, 68, 0.06)',
        pointerEvents: 'none',
        zIndex: 40,
        boxSizing: 'border-box',
      }}
    />
  )
}
