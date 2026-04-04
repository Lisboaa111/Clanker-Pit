import { useEffect, useState } from 'react'

const API = 'http://localhost:3001'

interface MatchEntry {
  id: string
  agent0_id: string
  agent1_id: string
  agent0Name: string
  agent1Name: string
  winner_id: string | null
  winnerName: string | null
  prize_wei: string
  duration_ticks: number | null
  created_at: number
  status: string
}

interface Props {
  onReplay:    (matchId: string) => void
  onLiveWatch?: (matchId: string) => void
  filterAgentId?: string
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:          'border-[#00d4ff]/50 text-[#00d4ff]',
    completed:       'border-[#33ff66]/50 text-[#33ff66]',
    pending_deposit: 'border-yellow-400/50 text-yellow-400',
  }
  const cls = styles[status] ?? 'border-[#555] text-[#555]'
  return (
    <span className={`font-pixel border px-1.5 py-0.5 ${cls}`} style={{ fontSize: '7px' }}>
      {status.replace('_', ' ').toUpperCase()}
    </span>
  )
}

export function MatchHistory({ onReplay, onLiveWatch, filterAgentId }: Props) {
  const [matches, setMatches] = useState<MatchEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url = filterAgentId
      ? `${API}/agents/${filterAgentId}/matches`
      : `${API}/match/`
    fetch(url)
      .then(r => r.json())
      .then(d => { setMatches(d.matches ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filterAgentId])

  if (loading) return (
    <div className="p-6 font-pixel text-[#555] text-center" style={{ fontSize: '10px' }}>
      LOADING…
    </div>
  )
  if (!matches.length) return (
    <div className="p-8 text-center">
      <div className="font-pixel text-[#444]" style={{ fontSize: '10px' }}>NO MATCHES YET</div>
    </div>
  )

  return (
    <div className="p-4 overflow-auto">
      <table className="w-full text-sm font-mono border-collapse">
        <thead>
          <tr className="text-[#555] border-b border-[#1a1a1a]">
            <th className="text-left pb-3 pr-3 font-pixel hidden sm:table-cell" style={{ fontSize: '8px' }}>DATE</th>
            <th className="text-left pb-3 pr-3 font-pixel" style={{ fontSize: '8px' }}>AGENT 0</th>
            <th className="text-left pb-3 pr-3 font-pixel" style={{ fontSize: '8px' }}>AGENT 1</th>
            <th className="text-left pb-3 pr-3 font-pixel" style={{ fontSize: '8px' }}>WINNER</th>
            <th className="text-left pb-3 pr-3 font-pixel hidden md:table-cell" style={{ fontSize: '8px' }}>STATUS</th>
            <th className="text-right pb-3 pr-3 font-pixel hidden lg:table-cell" style={{ fontSize: '8px' }}>TICKS</th>
            <th className="text-right pb-3 pr-3 font-pixel hidden lg:table-cell" style={{ fontSize: '8px' }}>PRIZE</th>
            <th className="text-right pb-3" />
          </tr>
        </thead>
        <tbody>
          {matches.map(m => (
            <tr
              key={m.id}
              className="border-b border-[#111] hover:bg-[#33ff66]/3 transition-colors"
            >
              <td className="py-2.5 pr-3 text-[#444] text-xs hidden sm:table-cell whitespace-nowrap">
                <div>{new Date(m.created_at * 1000).toLocaleDateString()}</div>
                <div className="text-[#333]">{new Date(m.created_at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
              </td>
              <td className="py-2.5 pr-3 text-white text-sm">{m.agent0Name}</td>
              <td className="py-2.5 pr-3 text-white text-sm">{m.agent1Name}</td>
              <td className="py-2.5 pr-3">
                {m.winner_id
                  ? <span className="text-[#33ff66] font-semibold">{m.winnerName}</span>
                  : <span className="text-[#444]">—</span>
                }
              </td>
              <td className="py-2.5 pr-3 hidden md:table-cell">
                <StatusBadge status={m.status} />
              </td>
              <td className="py-2.5 pr-3 text-right text-[#555] text-xs hidden lg:table-cell">
                {m.duration_ticks ?? '—'}
              </td>
              <td className="py-2.5 pr-3 text-right text-[#ffd700] text-xs hidden lg:table-cell">
                {(Number(BigInt(m.prize_wei)) / 1e18).toFixed(4)} ETH
              </td>
              <td className="py-2.5 text-right space-x-1">
                {m.status === 'active' && onLiveWatch && (
                  <button
                    onClick={() => onLiveWatch(m.id)}
                    className="font-pixel text-[8px] text-[#33ff66] border border-[#33ff66]/40
                               px-2 py-1 hover:bg-[#33ff66]/10 hover:border-[#33ff66] transition-all"
                  >
                    <span className="blink">●</span> LIVE
                  </button>
                )}
                {m.status === 'completed' && (
                  <button
                    onClick={() => onReplay(m.id)}
                    className="font-pixel text-[8px] text-[#00d4ff] border border-[#00d4ff]/40
                               px-2 py-1 hover:bg-[#00d4ff]/10 hover:border-[#00d4ff] transition-all"
                  >
                    ► REPLAY
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
