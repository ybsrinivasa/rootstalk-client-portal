'use client'

// Renders the three parallel volume numbers that every Sales card uses.
// Litres · Kilograms · Numbers, in a compact horizontal row. Buckets with
// value 0 collapse to a muted "—" so a card showing a purely-liquid
// product doesn't clutter with "0 KG · 0 Nos". If ALL three are zero the
// whole triplet renders as one big dash (empty-state).
//
// Numbers are formatted with `toLocaleString` for thousand separators;
// non-integer buckets (litres / kilograms after ML/GM conversion) are
// rounded to 2 decimals for readability.

interface ThreeUnitNumberProps {
  litres: number
  kilograms: number
  numbers: number
  colour?: string   // brand colour for the primary tone; falls back to slate
}

function fmt(v: number, decimals: number): string {
  if (v === 0) return '—'
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

export function ThreeUnitNumber({ litres, kilograms, numbers, colour }: ThreeUnitNumberProps) {
  const allZero = litres === 0 && kilograms === 0 && numbers === 0
  if (allZero) {
    return <p className="text-3xl font-bold text-slate-300">—</p>
  }

  const primary = colour || '#0F172A'
  return (
    <div className="flex items-baseline gap-4 flex-wrap">
      {litres > 0 && (
        <div>
          <span className="text-2xl font-bold tabular-nums" style={{ color: primary }}>
            {fmt(litres, 2)}
          </span>
          <span className="text-xs text-slate-500 ml-1">L</span>
        </div>
      )}
      {kilograms > 0 && (
        <div>
          <span className="text-2xl font-bold tabular-nums" style={{ color: primary }}>
            {fmt(kilograms, 2)}
          </span>
          <span className="text-xs text-slate-500 ml-1">kg</span>
        </div>
      )}
      {numbers > 0 && (
        <div>
          <span className="text-2xl font-bold tabular-nums" style={{ color: primary }}>
            {fmt(numbers, 0)}
          </span>
          <span className="text-xs text-slate-500 ml-1">Nos</span>
        </div>
      )}
    </div>
  )
}
