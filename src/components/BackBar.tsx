interface Props {
  title: string
  breadcrumb?: string   // e.g. "LEADERBOARD › Alpha Rusher"
  backLabel?: string    // defaults to "◄ MAIN MENU"
  onBack: () => void
}

export function BackBar({ title, breadcrumb, backLabel = '◄ MAIN MENU', onBack }: Props) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[#222] bg-black/80 backdrop-blur-sm z-50 relative">
      <button
        onClick={onBack}
        className="font-pixel text-[9px] text-[#33ff66] hover:text-white hover:glow-green transition-colors px-2 py-1 border border-[#33ff66]/30 hover:border-[#33ff66]/70"
      >
        {backLabel}
      </button>

      <div className="absolute left-1/2 -translate-x-1/2 text-center">
        <div className="font-pixel text-[10px] text-white tracking-wider">{title}</div>
        {breadcrumb && (
          <div className="text-[8px] text-[#555] mt-0.5 font-pixel">{breadcrumb}</div>
        )}
      </div>

      {/* spacer to balance left button */}
      <div className="w-24" />
    </div>
  )
}
