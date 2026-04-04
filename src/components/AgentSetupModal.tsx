import { useState } from 'react'
import { REGISTERED_AGENTS } from '../agent/agentRegistry'
import { AgentConfig, PlayerMode, HUMAN_PLAYER } from '../agent/agentTypes'

interface Props {
  onStart: (
    p0Mode: PlayerMode,
    p1Mode: PlayerMode,
    apiKey: string,
  ) => void
}

export function AgentSetupModal({ onStart }: Props) {
  const [p0Mode, setP0Mode] = useState<PlayerMode>(HUMAN_PLAYER)
  const [p1Mode, setP1Mode] = useState<PlayerMode>(REGISTERED_AGENTS[0])
  const [apiKey, setApiKey]  = useState<string>(() => localStorage.getItem('openrouter_key') ?? '')
  const [keyVisible, setKeyVisible] = useState(false)

  const needsKey = p0Mode !== HUMAN_PLAYER || p1Mode !== HUMAN_PLAYER

  const handleStart = () => {
    if (needsKey && !apiKey.trim()) return
    if (apiKey.trim()) localStorage.setItem('openrouter_key', apiKey.trim())
    onStart(p0Mode, p1Mode, apiKey.trim())
  }

  const PlayerSelector = ({
    label,
    color,
    value,
    onChange,
  }: {
    label: string
    color: string
    value: PlayerMode
    onChange: (m: PlayerMode) => void
  }) => (
    <div className="space-y-2">
      <div className={`text-sm font-bold font-mono ${color}`}>{label}</div>
      <div className="space-y-1.5">
        {/* Human option */}
        <button
          onClick={() => onChange(HUMAN_PLAYER)}
          className={[
            'w-full text-left px-3 py-2 rounded border transition-colors font-mono text-xs',
            value === HUMAN_PLAYER
              ? 'border-white/40 bg-white/10 text-white'
              : 'border-white/10 bg-white/3 text-white/50 hover:bg-white/8 hover:text-white/80',
          ].join(' ')}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">🎮</span>
            <div>
              <div className="font-bold">Human</div>
              <div className="text-white/40 text-[10px]">Manual keyboard + mouse control</div>
            </div>
          </div>
        </button>
        {/* Agent options */}
        {REGISTERED_AGENTS.map(agent => (
          <button
            key={agent.id}
            onClick={() => onChange(agent)}
            className={[
              'w-full text-left px-3 py-2 rounded border transition-colors font-mono text-xs',
              value !== HUMAN_PLAYER && (value as AgentConfig).id === agent.id
                ? 'border-blue-400/50 bg-blue-500/10 text-white'
                : 'border-white/10 bg-white/3 text-white/50 hover:bg-white/8 hover:text-white/80',
            ].join(' ')}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">🤖</span>
              <div>
                <div className="font-bold">{agent.name}</div>
                <div className="text-white/40 text-[10px]">{agent.description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-xl p-6 w-[680px] max-h-[90vh] overflow-y-auto shadow-2xl font-mono">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-white tracking-wide mb-1">⚔️ Clanker Pit</div>
          <div className="text-white/40 text-sm">Configure players before the battle begins</div>
        </div>

        {/* Player selectors */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <PlayerSelector
            label="🔵 Player 1"
            color="text-blue-400"
            value={p0Mode}
            onChange={setP0Mode}
          />
          <PlayerSelector
            label="🔴 Player 2"
            color="text-red-400"
            value={p1Mode}
            onChange={setP1Mode}
          />
        </div>

        {/* API key section */}
        {needsKey && (
          <div className="border border-white/10 rounded-lg p-4 mb-6 bg-white/3">
            <div className="text-white/60 text-xs mb-2 flex items-center gap-2">
              <span>🔑</span>
              <span>OpenRouter API Key</span>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400/70 hover:text-blue-400 underline ml-auto"
              >
                Get key →
              </a>
            </div>
            <div className="flex gap-2">
              <input
                type={keyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-or-..."
                className="flex-1 bg-black/50 border border-white/20 rounded px-3 py-1.5 text-white text-xs font-mono outline-none focus:border-blue-400/50"
              />
              <button
                onClick={() => setKeyVisible(v => !v)}
                className="px-2 text-white/40 hover:text-white/70 transition-colors text-xs border border-white/10 rounded"
              >
                {keyVisible ? '🙈' : '👁'}
              </button>
            </div>
            <div className="text-white/25 text-[10px] mt-1.5">
              Uses google/gemini-flash-1.5-8b · extremely cheap · key saved locally
            </div>
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={needsKey && !apiKey.trim()}
          className={[
            'w-full py-3 rounded-lg font-bold text-base transition-colors',
            needsKey && !apiKey.trim()
              ? 'bg-white/5 text-white/25 cursor-not-allowed border border-white/10'
              : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg cursor-pointer border-0',
          ].join(' ')}
        >
          ⚔️ Start Battle
        </button>

        <div className="text-center text-white/20 text-[10px] mt-3">
          Human vs Human · Human vs AI · AI vs AI — all supported
        </div>
      </div>
    </div>
  )
}
