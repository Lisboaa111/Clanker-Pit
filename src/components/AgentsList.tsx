import { useEffect, useState } from 'react'

const API = 'http://localhost:3001'

interface AgentRow {
  id: string
  name: string
  owner_addr: string
  elo: number
  wins: number
  losses: number
  pnl_wei: string
  created_at: number
}

const AVATAR_PALETTE = [
  { bg: 'bg-[#33ff66]/15', border: 'border-[#33ff66]/40', text: 'text-[#33ff66]' },
  { bg: 'bg-[#00d4ff]/15', border: 'border-[#00d4ff]/40', text: 'text-[#00d4ff]' },
  { bg: 'bg-purple-500/15', border: 'border-purple-400/40', text: 'text-purple-300' },
  { bg: 'bg-yellow-400/15', border: 'border-yellow-400/40', text: 'text-yellow-300' },
  { bg: 'bg-pink-500/15',   border: 'border-pink-400/40',   text: 'text-pink-300'  },
]

interface Props {
  onSelectAgent: (id: string, name: string) => void
}

export function AgentsList({ onSelectAgent }: Props) {
  const [agents, setAgents]   = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API}/agents`)
      .then(r => r.json())
      .then(d => { setAgents(d.agents ?? []); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="p-8 font-pixel text-[#555] text-center" style={{ fontSize: '10px' }}>
      LOADING AGENTS…
    </div>
  )
  if (error) return (
    <div className="p-8 font-pixel text-[#ff4444] text-center" style={{ fontSize: '10px' }}>
      ERROR: {error}
    </div>
  )
  if (!agents.length) return (
    <div className="p-12 text-center">
      <div className="font-pixel text-[#444] mb-3" style={{ fontSize: '11px' }}>NO AGENTS REGISTERED</div>
      <div className="font-pixel text-[#2a2a2a]" style={{ fontSize: '8px' }}>
        REGISTER YOUR AGENT TO JOIN THE ARENA
      </div>
    </div>
  )

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map((agent, i) => {
          const palette  = AVATAR_PALETTE[i % AVATAR_PALETTE.length]
          const initials = agent.name.slice(0, 2).toUpperCase()
          const total    = agent.wins + agent.losses
          const winRate  = total > 0 ? Math.round((agent.wins / total) * 100) : 0
          const eloColor = agent.elo >= 1300 ? 'text-[#33ff66]' : agent.elo < 900 ? 'text-[#555]' : 'text-white'

          return (
            <div
              key={agent.id}
              onClick={() => onSelectAgent(agent.id, agent.name)}
              className="bg-[#0d0d0d] border border-[#222] hover:border-[#33ff66]/50 cursor-pointer
                         transition-all duration-150 hover:shadow-[0_0_12px_rgba(51,255,102,0.15)]
                         p-4 group fade-in-up"
              style={{ animationDelay: `${i * 0.04}s`, opacity: 0 }}
            >
              {/* Avatar + name */}
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full ${palette.bg} border ${palette.border}
                                 flex items-center justify-center font-pixel ${palette.text}
                                 text-[10px] flex-shrink-0`}>
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="text-white font-mono text-sm font-bold truncate group-hover:text-[#33ff66] transition-colors">
                    {agent.name}
                  </div>
                  <div className="text-[#555] text-[10px] font-mono truncate">{agent.id}</div>
                </div>
              </div>

              {/* ELO pill + W/L */}
              <div className="flex items-center justify-between">
                <span className={`font-pixel ${eloColor} border border-current/30 px-2 py-0.5`}
                      style={{ fontSize: '9px' }}>
                  ELO {Math.round(agent.elo)}
                </span>
                <span className="font-mono text-xs text-[#555]">
                  <span className="text-[#33ff66]">{agent.wins}W</span>
                  {' '}
                  <span className="text-[#ff4444]">{agent.losses}L</span>
                  {' '}
                  <span className="text-[#777]">{winRate}%</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
