import { useEffect, useState } from 'react'
import { GameView }        from './components/GameView'
import { ResourceBar }     from './components/ResourceBar'
import { UnitPanel }       from './components/UnitPanel'
import { DebugPanel }      from './components/DebugPanel'
import { Minimap }         from './components/Minimap'
import { ContextMenu }     from './components/ContextMenu'
import { BuildingModal }   from './components/BuildingModal'
import { DamageNumbers }   from './components/DamageNumbers'
import { SelectionBox }    from './components/SelectionBox'
import { AgentSetupModal } from './components/AgentSetupModal'
import { MainMenu }        from './components/MainMenu'
import { BackBar }         from './components/BackBar'
import { Leaderboard }     from './components/Leaderboard'
import { AgentsList }      from './components/AgentsList'
import { AgentProfile }    from './components/AgentProfile'
import { MatchHistory }    from './components/MatchHistory'
import { MatchReplay }     from './components/MatchReplay'
import { LiveMatch }       from './components/LiveMatch'
import { PLAYER_NAMES }    from './game/constants'
import { PlayerMode, HUMAN_PLAYER } from './agent/agentTypes'

type Screen = 'menu' | 'game' | 'live' | 'leaderboard' | 'agents' | 'profile' | 'history' | 'replay'

interface GameConfig {
  p0Mode: PlayerMode
  p1Mode: PlayerMode
  apiKey: string
}

const SCREEN_TITLES: Partial<Record<Screen, string>> = {
  leaderboard: 'LEADERBOARD',
  agents:      'AGENTS',
  profile:     'AGENT PROFILE',
  history:     'MATCH HISTORY',
  replay:      'MATCH REPLAY',
  live:        'LIVE MATCH',
}

export default function App() {
  const [screen, setScreen]               = useState<Screen>('menu')
  const [prevScreen, setPrevScreen]       = useState<Screen>('menu')
  const [gameOver, setGameOver]           = useState<{ winnerId: number } | null>(null)
  const [gameConfig, setGameConfig]       = useState<GameConfig | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [replayMatchId, setReplayMatchId] = useState<string | null>(null)
  const [agentName, setAgentName]         = useState<string | null>(null)

  useEffect(() => {
    const h = (e: Event) => setGameOver((e as CustomEvent<{ winnerId: number }>).detail)
    window.addEventListener('game-over', h)
    return () => window.removeEventListener('game-over', h)
  }, [])

  const navigate = (to: Screen, from: Screen = screen) => {
    setPrevScreen(from)
    setScreen(to)
  }

  const goBack = () => {
    const detail: Partial<Record<Screen, Screen>> = {
      profile: prevScreen === 'agents' ? 'agents' : 'leaderboard',
      replay:  prevScreen === 'profile' ? 'profile' : 'history',
    }
    setScreen(detail[screen] ?? 'menu')
  }

  const handleSelectAgent = (id: string, name?: string) => {
    setSelectedAgent(id)
    setAgentName(name ?? null)
    navigate('profile')
  }

  const handleReplay = (matchId: string) => {
    setReplayMatchId(matchId)
    navigate('replay')
  }

  const handleLiveWatch = (matchId: string) => {
    setReplayMatchId(matchId)
    navigate('live')
  }

  const handleStart = (p0Mode: PlayerMode, p1Mode: PlayerMode, apiKey: string) => {
    setGameConfig({ p0Mode, p1Mode, apiKey })
    setGameOver(null)
  }

  const handleRestart = () => {
    setGameConfig(null)
    setGameOver(null)
  }

  const isGameScreen = screen === 'game'

  // ── Breadcrumbs ─────────────────────────────────────────────────────────────
  const breadcrumb = (() => {
    if (screen === 'profile' && agentName)
      return `${prevScreen === 'agents' ? 'AGENTS' : 'LEADERBOARD'} › ${agentName.toUpperCase()}`
    if (screen === 'replay' && replayMatchId)
      return `${prevScreen === 'profile' ? 'PROFILE' : 'HISTORY'} › ${replayMatchId.slice(0, 8).toUpperCase()}…`
    return undefined
  })()

  const isDetail   = screen === 'profile' || screen === 'replay'
  const backLabel  = isDetail ? '◄ BACK' : '◄ MAIN MENU'

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-black">

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN MENU
      ══════════════════════════════════════════════════════════════════════ */}
      {screen === 'menu' && (
        <MainMenu onNavigate={s => navigate(s, 'menu')} />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          GAME (setup modal + running game)
      ══════════════════════════════════════════════════════════════════════ */}
      {isGameScreen && (
        <>
          {!gameConfig && (
            <div className="w-full h-full flex flex-col">
              {/* Small back link above setup modal */}
              <div className="absolute top-3 left-3 z-50">
                <button
                  onClick={() => setScreen('menu')}
                  className="font-pixel text-[9px] text-[#555] hover:text-[#33ff66] transition-colors border border-[#222] hover:border-[#33ff66]/50 px-2 py-1"
                >
                  ◄ MENU
                </button>
              </div>
              <AgentSetupModal onStart={handleStart} />
            </div>
          )}

          {gameConfig && (
            <GameView
              p0Mode={gameConfig.p0Mode}
              p1Mode={gameConfig.p1Mode}
              apiKey={gameConfig.apiKey}
            />
          )}

          {gameConfig && (
            <>
              <ResourceBar />
              <UnitPanel />
              <DebugPanel />
              <Minimap />
              <ContextMenu />
              <BuildingModal />
              <DamageNumbers />
              <SelectionBox />

              <div className="absolute bottom-2 left-2 z-10 text-white/20 text-xs font-mono select-none space-y-0.5">
                <div>WASD / ↑↓←→ — pan camera</div>
                <div>Scroll — zoom</div>
                <div>Left click — select</div>
                <div>Shift+click — multi-select</div>
                <div>Drag — box select</div>
                <div>Right click ground — move</div>
                <div>A + right click — attack-move</div>
                <div>Right click enemy — attack</div>
                <div>Right click mine/tree — gather</div>
                <div>Select worker → Build buttons</div>
                {gameConfig.p0Mode !== HUMAN_PLAYER && (
                  <div className="text-purple-400/50">🤖 P1 controlled by AI</div>
                )}
                {gameConfig.p1Mode !== HUMAN_PLAYER && (
                  <div className="text-purple-400/50">🤖 P2 controlled by AI</div>
                )}
              </div>
            </>
          )}

          {/* ── Game over overlay ─────────────────────────────────────────── */}
          {gameOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/85 z-50 scanlines">
              <div className="text-center space-y-8 fade-in-up">
                <div className="font-pixel glow-green text-[#33ff66]" style={{ fontSize: 'clamp(24px, 4vw, 48px)' }}>
                  GAME OVER
                </div>
                <div
                  className="font-pixel"
                  style={{
                    fontSize: 'clamp(14px, 2.5vw, 26px)',
                    color: gameOver.winnerId === 0 ? '#4488ff' : '#ff3322',
                    textShadow: gameOver.winnerId === 0
                      ? '0 0 12px #4488ff'
                      : '0 0 12px #ff3322',
                  }}
                >
                  {PLAYER_NAMES[gameOver.winnerId].toUpperCase()} WINS
                </div>
                <div className="font-pixel text-[#555]" style={{ fontSize: '9px' }}>
                  ENEMY TOWN HALL DESTROYED
                </div>
                <div className="flex gap-4 justify-center pt-2">
                  <button
                    onClick={handleRestart}
                    className="font-pixel text-[10px] text-[#33ff66] border border-[#33ff66]/50 px-6 py-3
                               hover:bg-[#33ff66]/10 hover:border-[#33ff66] transition-all glow-green"
                  >
                    ► PLAY AGAIN
                  </button>
                  <button
                    onClick={() => { handleRestart(); setScreen('menu') }}
                    className="font-pixel text-[10px] text-[#555] border border-[#333] px-6 py-3
                               hover:text-white hover:border-[#555] transition-all"
                  >
                    MAIN MENU
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DATA SCREENS  (leaderboard / agents / profile / history / replay)
      ══════════════════════════════════════════════════════════════════════ */}
      {!isGameScreen && screen !== 'menu' && (
        <div className="flex flex-col h-full">
          <BackBar
            title={SCREEN_TITLES[screen] ?? ''}
            breadcrumb={breadcrumb}
            backLabel={backLabel}
            onBack={isDetail ? goBack : () => setScreen('menu')}
          />

          <div className="flex-1 overflow-auto text-white">
            {screen === 'leaderboard' && (
              <Leaderboard onSelectAgent={(id, name) => handleSelectAgent(id, name)} />
            )}

            {screen === 'agents' && (
              <AgentsList onSelectAgent={handleSelectAgent} />
            )}

            {screen === 'profile' && (
              selectedAgent
                ? <AgentProfile agentId={selectedAgent} onReplay={handleReplay} />
                : (
                  <div className="p-12 text-center font-pixel text-[#444]" style={{ fontSize: '10px' }}>
                    NO AGENT SELECTED
                  </div>
                )
            )}

            {screen === 'history' && (
              <MatchHistory onReplay={handleReplay} onLiveWatch={handleLiveWatch} />
            )}

            {screen === 'replay' && replayMatchId && (
              <MatchReplay matchId={replayMatchId} />
            )}

            {screen === 'live' && replayMatchId && (
              <LiveMatch matchId={replayMatchId} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
