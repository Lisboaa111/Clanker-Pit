import { useEffect, useState } from 'react'

const API = 'http://localhost:3001'

type Screen = 'menu' | 'game' | 'leaderboard' | 'agents' | 'profile' | 'history' | 'replay'

const MENU_ITEMS = [
  { label: 'PLAY',        screen: 'game'        as Screen },
  { label: 'LEADERBOARD', screen: 'leaderboard' as Screen },
  { label: 'AGENTS',      screen: 'agents'      as Screen },
  { label: 'HISTORY',     screen: 'history'     as Screen },
]

interface Props {
  onNavigate: (screen: Screen) => void
}

export function MainMenu({ onNavigate }: Props) {
  const [cursor, setCursor]           = useState(0)
  const [agentCount, setAgentCount]   = useState<number | null>(null)
  const [matchCount, setMatchCount]   = useState<number | null>(null)
  const [statsError, setStatsError]   = useState(false)

  // Fetch live stats
  useEffect(() => {
    Promise.all([
      fetch(`${API}/leaderboard`).then(r => r.json()).catch(() => null),
      fetch(`${API}/match/`).then(r => r.json()).catch(() => null),
    ]).then(([lb, matches]) => {
      if (lb?.leaderboard)   setAgentCount(lb.leaderboard.length)
      else                   setStatsError(true)
      if (matches?.matches)  setMatchCount(matches.matches.length)
    })
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => (c - 1 + MENU_ITEMS.length) % MENU_ITEMS.length) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % MENU_ITEMS.length) }
      if (e.key === 'Enter')     { onNavigate(MENU_ITEMS[cursor].screen) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cursor, onNavigate])

  return (
    <div className="scanlines w-screen h-screen bg-black flex flex-col items-center justify-center select-none">

      {/* ── Title block ──────────────────────────────────────────────────── */}
      <div className="text-center mb-12 fade-in-up">
        <div
          className="font-pixel glow-green text-[#33ff66] leading-tight mb-4"
          style={{ fontSize: 'clamp(22px, 4vw, 48px)' }}
        >
          CLANKER PIT
        </div>
        <div
          className="font-pixel text-[#00d4ff]/70 glow-cyan tracking-widest"
          style={{ fontSize: 'clamp(6px, 1.2vw, 11px)' }}
        >
          REAL-TIME STRATEGY ARENA
        </div>
        <div className="mt-4 text-[#555] font-pixel" style={{ fontSize: '8px' }}>
          ─────────────────────────────
        </div>
      </div>

      {/* ── Menu panel ───────────────────────────────────────────────────── */}
      <div
        className="border border-[#33ff66]/25 glow-border-green px-12 py-8 fade-in-up"
        style={{ animationDelay: '0.1s', opacity: 0 }}
      >
        <div className="space-y-5">
          {MENU_ITEMS.map((item, i) => {
            const isActive = cursor === i
            return (
              <div
                key={item.label}
                className="flex items-center gap-4 cursor-pointer group"
                onMouseEnter={() => setCursor(i)}
                onClick={() => onNavigate(item.screen)}
              >
                {/* Cursor indicator */}
                <span
                  className={`font-pixel text-[#33ff66] w-4 text-center transition-opacity ${isActive ? 'blink' : 'opacity-0'}`}
                  style={{ fontSize: '12px' }}
                >
                  ▶
                </span>

                {/* Label */}
                <span
                  className={`font-pixel transition-all duration-100 ${
                    isActive
                      ? 'text-[#33ff66] glow-green scale-105'
                      : 'text-[#555] group-hover:text-[#33ff66]/70'
                  }`}
                  style={{ fontSize: 'clamp(10px, 1.6vw, 14px)' }}
                >
                  {item.label}
                </span>

                {/* PLAY gets a special badge */}
                {item.label === 'PLAY' && isActive && (
                  <span className="font-pixel text-[8px] text-[#00d4ff]/70 border border-[#00d4ff]/30 px-1.5 py-0.5">
                    PRESS ENTER
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Footer stats ─────────────────────────────────────────────────── */}
      <div className="mt-10 text-center font-pixel fade-in-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
        {!statsError ? (
          <div className="text-[#444]" style={{ fontSize: '8px' }}>
            {agentCount !== null ? agentCount : '…'} AGENTS
            {' '}·{' '}
            {matchCount !== null ? matchCount : '…'} MATCHES PLAYED
          </div>
        ) : (
          <div className="text-[#333]" style={{ fontSize: '8px' }}>BACKEND OFFLINE</div>
        )}

        <div className="mt-3 text-[#2a2a2a]" style={{ fontSize: '7px' }}>
          v1.0 · SEPOLIA TESTNET · K=32 ELO
        </div>
      </div>

      {/* ── Keyboard hint ────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-4 right-4 font-pixel text-[#2a2a2a]"
        style={{ fontSize: '7px' }}
      >
        ↑↓ NAVIGATE · ENTER SELECT
      </div>
    </div>
  )
}
