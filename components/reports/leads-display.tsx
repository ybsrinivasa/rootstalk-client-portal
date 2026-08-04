'use client'

// Leads / Conversion display used by the four Sales headline cards.
// Big % is the primary read; secondary line carries N leads · M converted.
// Recommended has three sub-numbers (honored / substituted / pending)
// where honor rate is the headline %.

interface LeadsSimpleProps {
  leads: number
  converted: number
  colour?: string
  loading?: boolean
}

interface LeadsRecommendedProps {
  leads: number
  honored: number
  substituted: number
  pending: number
  colour?: string
  loading?: boolean
}

function pct(a: number, b: number): number {
  if (b <= 0) return 0
  return Math.round((a / b) * 100)
}

function pctColour(p: number): string {
  if (p >= 85) return '#15803d'    // green
  if (p >= 60) return '#B45309'    // amber
  return '#B91C1C'                  // red
}

export function LeadsDisplay({ leads, converted, colour, loading }: LeadsSimpleProps) {
  if (loading) {
    return <div className="h-10 w-24 bg-slate-100 rounded animate-pulse" />
  }
  if (leads === 0) {
    return (
      <div>
        <p className="text-3xl font-bold text-slate-300">—</p>
        <p className="text-xs text-slate-400 mt-1">No leads yet</p>
      </div>
    )
  }
  const p = pct(converted, leads)
  return (
    <div>
      <p className="text-4xl font-bold tabular-nums" style={{ color: colour || pctColour(p) }}>
        {p}%
      </p>
      <p className="text-xs text-slate-500 mt-1 tabular-nums">
        {converted.toLocaleString()} of {leads.toLocaleString()} leads converted
      </p>
    </div>
  )
}

export function LeadsRecommendedDisplay({
  leads, honored, substituted, pending, colour, loading,
}: LeadsRecommendedProps) {
  if (loading) {
    return <div className="h-10 w-24 bg-slate-100 rounded animate-pulse" />
  }
  if (leads === 0) {
    return (
      <div>
        <p className="text-3xl font-bold text-slate-300">—</p>
        <p className="text-xs text-slate-400 mt-1">No leads yet</p>
      </div>
    )
  }
  const honorRate = pct(honored, leads)
  return (
    <div>
      <p className="text-4xl font-bold tabular-nums" style={{ color: colour || pctColour(honorRate) }}>
        {honorRate}%
      </p>
      <p className="text-xs text-slate-500 mt-1 tabular-nums">
        honor rate on {leads.toLocaleString()} leads
      </p>
      <div className="mt-2 flex items-center gap-3 text-xs text-slate-600 tabular-nums">
        <span>{honored.toLocaleString()} honored</span>
        <span className="text-slate-300">·</span>
        <span className="text-amber-700">{substituted.toLocaleString()} substituted</span>
        <span className="text-slate-300">·</span>
        <span className="text-slate-400">{pending.toLocaleString()} pending</span>
      </div>
    </div>
  )
}
