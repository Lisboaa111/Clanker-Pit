import { useEffect, useState } from 'react'
import { MatchHistory } from './MatchHistory'

const API = 'http://localhost:3001'

const AVATAR_PALETTE = [
  { bg: 'bg-[#33ff66]/15', border: 'border-[#33ff66]/40', text: 'text-[#33ff66]' },
  { bg: 'bg-[#00d4ff]/15', border: 'border-[#00d4ff]/40', text: 'text-[#00d4ff]' },
  { bg: 'bg-purple-500/15', border: 'border-purple-400/40', text: 'text-purple-300' },
  { bg: 'bg-yellow-400/15', border: 'border-yellow-400/40', text: 'text-yellow-300' },
  { bg: 'bg-pink-500/15',   border: 'border-pink-400/40',   text: 'text-pink-300'  },
]

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

interface Props {
  agentId: string
  onReplay: (matchId: string) => void
}

export function AgentProfile({ agentId, onReplay }: Props) {
  const [agent, setAgent] = useState<AgentRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/agents/${agentId}`)
      .then(r => r.json())
      .then(d => { setAgent(d.agent ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [agentId])

  if (loading) return (
    <div className="p-8 font-pixel text-[#555] text-center" style={{ fontSize: '10px' }}>
      LOADING…
    </div>
  )
  if (!agent) return (
    <div className="p-8 font-pixel text-[#ff4444] text-center" style={{ fontSize: '10px' }}>
      AGENT NOT FOUND
    </div>
  )

  const total   = agent.wins + agent.losses
  const winRate = total > 0 ? Math.round((agent.wins / total) * 100) : 0
  const pnlWei  = BigInt(agent.pnl_wei)
  const pnlAbs  = (Number(pnlWei < 0n ? -pnlWei : pnlWei) / 1e18).toFixed(4)
  const pnlSign = pnlWei < 0n ? '-' : '+'
  const palette = AVATAR_PALETTE[agent.id.charCodeAt(0) % AVATAR_PALETTE.length]
  const initials = agent.name.slice(0, 2).toUpperCase()
  const eloColor = agent.elo >= 1300 ? 'text-[#33ff66]' : agent.elo < 900 ? 'text-[#555]' : 'text-white'

  const stats = [
    { label: 'ELO',    value: Math.round(agent.elo).toString(), color: eloColor },
    { label: 'WINS',   value: agent.wins.toString(),             color: 'text-[#33ff66]' },
    { label: 'LOSSES', value: agent.losses.toString(),           color: 'text-[#ff4444]' },
    { label: 'WIN %',  value: `${winRate}%`,                     color: 'text-white' },
  ]

  return (
    <div className="p-6 space-y-6 fade-in-up">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-5">
        <div className={`w-16 h-16 rounded-full ${palette.bg} border-2 ${palette.border}
                         flex items-center justify-center font-pixel ${palette.text} text-sm flex-shrink-0`}>
          {initials}
        </div>
        <div>
          <div className="text-white font-mono text-xl font-bold">{agent.name}</div>
          <div className="text-[#555] text-xs font-mono mt-1 break-all">{agent.owner_addr}</div>
          <div className="text-[#333] text-xs font-mono mt-0.5">
            Joined {new Date(agent.created_at * 1000).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* ── Stats grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map(s => (
          <div
            key={s.label}
            className="bg-[#0d0d0d] border border-[#1e1e1e] hover:border-[#33ff66]/20 transition-colors
                       rounded p-3 text-center"
          >
            <div className={`text-xl font-mono font-bold ${s.color}`}>{s.value}</div>
            <div className="font-pixel text-[#444] mt-1" style={{ fontSize: '7px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── PnL ──────────────────────────────────────────────────────────── */}
      <div className="bg-[#0d0d0d] border border-[#1e1e1e] rounded p-4 flex items-center justify-between">
        <div>
          <div className="font-pixel text-[#444] mb-1" style={{ fontSize: '7px' }}>TOTAL PnL</div>
          <div className={`text-2xl font-mono font-bold ${pnlWei < 0n ? 'text-[#ff4444]' : 'text-[#33ff66]'}`}>
            {pnlSign}{pnlAbs} ETH
          </div>
        </div>
        <div className="font-pixel text-[#2a2a2a] text-right" style={{ fontSize: '8px' }}>
          <div>{agent.wins} WIN{agent.wins !== 1 ? 'S' : ''}</div>
          <div className="mt-1">{agent.losses} LOSS{agent.losses !== 1 ? 'ES' : ''}</div>
        </div>
      </div>

      {/* ── Match history ─────────────────────────────────────────────────── */}
      <div className="border border-[#1e1e1e] rounded overflow-hidden">
        <div className="px-4 py-2 bg-[#0d0d0d] border-b border-[#1e1e1e]">
          <span className="font-pixel text-[#444]" style={{ fontSize: '8px' }}>MATCH HISTORY</span>
        </div>
        <MatchHistory onReplay={onReplay} filterAgentId={agentId} />
      </div>
    </div>
  )
}
