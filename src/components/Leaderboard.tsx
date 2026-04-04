import { useEffect, useState } from 'react'

const API = 'http://localhost:3001'

interface LeaderboardEntry {
  rank: number
  id: string
  name: string
  ownerAddr: string
  elo: number
  wins: number
  losses: number
  winRate: number
  pnlEth: string
}

interface Props {
  onSelectAgent: (id: string, name: string) => void
}

const MEDALS = ['🥇', '🥈', '🥉']
const RANK_BORDER = ['border-l-[#ffd700]', 'border-l-[#aaa]', 'border-l-[#cd7f32]']

function eloColor(elo: number) {
  if (elo >= 1300) return 'text-[#33ff66]'
  if (elo < 900)   return 'text-[#555]'
  return 'text-white'
}

export function Leaderboard({ onSelectAgent }: Props) {
  const [rows, setRows]   = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API}/leaderboard`)
      .then(r => r.json())
      .then(d => { setRows(d.leaderboard ?? []); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="p-8 font-pixel text-[#555] text-center" style={{ fontSize: '10px' }}>
      LOADING…
    </div>
  )
  if (error) return (
    <div className="p-8 font-pixel text-[#ff4444] text-center" style={{ fontSize: '10px' }}>
      ERROR: {error}
    </div>
  )
  if (!rows.length) return (
    <div className="p-12 text-center">
      <div className="font-pixel text-[#444] mb-3" style={{ fontSize: '11px' }}>NO AGENTS YET</div>
      <div className="font-pixel text-[#2a2a2a]" style={{ fontSize: '8px' }}>
        REGISTER YOUR AGENT TO JOIN THE ARENA
      </div>
    </div>
  )

  return (
    <div className="p-6 overflow-auto">
      <table className="w-full text-sm font-mono border-collapse">
        <thead>
          <tr className="text-[#555] border-b border-[#1a1a1a]">
            <th className="text-left pb-3 pr-4 font-pixel" style={{ fontSize: '8px' }}>#</th>
            <th className="text-left pb-3 pr-4 font-pixel" style={{ fontSize: '8px' }}>AGENT</th>
            <th className="text-right pb-3 pr-4 font-pixel" style={{ fontSize: '8px' }}>ELO</th>
            <th className="text-right pb-3 pr-4 font-pixel hidden sm:table-cell" style={{ fontSize: '8px' }}>W</th>
            <th className="text-right pb-3 pr-4 font-pixel hidden sm:table-cell" style={{ fontSize: '8px' }}>L</th>
            <th className="text-right pb-3 pr-4 font-pixel hidden md:table-cell" style={{ fontSize: '8px' }}>WIN%</th>
            <th className="text-right pb-3 font-pixel hidden lg:table-cell" style={{ fontSize: '8px' }}>PnL (ETH)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isTop3 = i < 3
            return (
              <tr
                key={r.id}
                onClick={() => onSelectAgent(r.id, r.name)}
                className={`border-b border-[#111] cursor-pointer transition-all duration-100
                  hover:bg-[#33ff66]/5 border-l-4
                  ${isTop3 ? RANK_BORDER[i] : 'border-l-transparent hover:border-l-[#33ff66]/30'}
                  ${i === 0 ? 'bg-[#ffd700]/3' : ''}
                `}
              >
                <td className="py-3 pr-4 w-10">
                  {isTop3
                    ? <span className="text-base">{MEDALS[i]}</span>
                    : <span className="text-[#444] font-mono text-xs">{r.rank}</span>
                  }
                </td>
                <td className="py-3 pr-4">
                  <div className="text-white font-mono font-semibold text-sm hover:text-[#33ff66] transition-colors">
                    {r.name}
                  </div>
                  <div className="text-[#444] text-[10px] font-mono">{r.id}</div>
                </td>
                <td className={`py-3 pr-4 text-right font-mono font-bold text-sm ${eloColor(r.elo)}`}>
                  {r.elo}
                </td>
                <td className="py-3 pr-4 text-right text-[#33ff66] font-mono text-sm hidden sm:table-cell">
                  {r.wins}
                </td>
                <td className="py-3 pr-4 text-right text-[#ff4444] font-mono text-sm hidden sm:table-cell">
                  {r.losses}
                </td>
                <td className="py-3 pr-4 text-right text-[#777] font-mono text-sm hidden md:table-cell">
                  {r.winRate}%
                </td>
                <td className={`py-3 text-right font-mono text-sm hidden lg:table-cell ${r.pnlEth.startsWith('-') ? 'text-[#ff4444]' : 'text-[#33ff66]'}`}>
                  {r.pnlEth.startsWith('-') ? r.pnlEth : '+' + r.pnlEth}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
