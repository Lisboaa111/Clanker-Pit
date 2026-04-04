export type Tab = 'arena' | 'leaderboard' | 'matches' | 'profile'

interface Props {
  active: Tab
  onChange: (tab: Tab) => void
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'arena',       label: 'Arena' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'matches',     label: 'Matches' },
  { id: 'profile',     label: 'Profile' },
]

export function TabNav({ active, onChange }: Props) {
  return (
    <nav className="absolute top-0 left-0 right-0 z-40 flex bg-black/80 border-b border-white/10 backdrop-blur-sm">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            'px-5 py-2.5 text-sm font-mono tracking-wide transition-colors',
            active === t.id
              ? 'text-white border-b-2 border-blue-400'
              : 'text-white/40 hover:text-white/70',
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
