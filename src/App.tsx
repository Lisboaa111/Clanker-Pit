import { useEffect, useState } from 'react'
import { GameView } from './components/GameView'
import { ResourceBar } from './components/ResourceBar'
import { UnitPanel } from './components/UnitPanel'
import { DebugPanel } from './components/DebugPanel'
import { Minimap } from './components/Minimap'
import { ContextMenu } from './components/ContextMenu'
import { BuildingModal } from './components/BuildingModal'
import { DamageNumbers } from './components/DamageNumbers'
import { SelectionBox } from './components/SelectionBox'
import { PLAYER_NAMES } from './game/constants'

export default function App() {
  const [gameOver, setGameOver] = useState<{ winnerId: number } | null>(null)

  useEffect(() => {
    const h = (e: Event) => setGameOver((e as CustomEvent<{ winnerId: number }>).detail)
    window.addEventListener('game-over', h)
    return () => window.removeEventListener('game-over', h)
  }, [])

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black">
      {/* Three.js canvas — fullscreen */}
      <GameView />

      {/* HUD overlays */}
      <ResourceBar />
      <UnitPanel />
      <DebugPanel />
      <Minimap />
      <ContextMenu />
      <BuildingModal />
      <DamageNumbers />
      <SelectionBox />

      {/* Controls hint */}
      <div className="absolute bottom-2 left-2 z-10 text-white/25 text-xs font-mono select-none space-y-0.5">
        <div>WASD / ↑↓←→ — pan camera</div>
        <div>Scroll — zoom</div>
        <div>Left click — select unit</div>
        <div>Shift+click — multi-select</div>
        <div>Left click building — open menu</div>
        <div>Right click ground — move</div>
        <div>A + right click — attack-move</div>
        <div>Right click enemy — attack</div>
        <div>Right click mine/tree — gather</div>
        <div>Select worker → Build buttons</div>
      </div>

      {/* Game Over overlay */}
      {gameOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/75 z-50">
          <div className="text-center space-y-6">
            <div
              className="text-6xl font-bold tracking-wide drop-shadow-lg"
              style={{ color: gameOver.winnerId === 0 ? '#4488ff' : '#ff3322' }}
            >
              {PLAYER_NAMES[gameOver.winnerId]} Wins!
            </div>
            <div className="text-white/50 text-lg">Enemy Town Hall destroyed</div>
            <button
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/30
                         text-white rounded-lg font-mono transition-colors text-base"
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
