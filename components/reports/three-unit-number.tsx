'use client'

// Renders the three parallel volume numbers that every Sales card uses.
// Litres · Kilograms · Numbers, in a compact horizontal row.
//
// Display rules:
// - Only buckets with value ≥ MIN_DISPLAYABLE (0.01) render. Sub-gram /
//   sub-decilitre quantities drop out — they'd otherwise round to "0 kg"
//   with 2-decimal formatting and read as a bug rather than data. If a
//   client somehow has real millilitre-scale sales they can pull the
//   long tail from CSV export.
// - If EVERY bucket falls under the threshold, one large muted dash
//   renders — the deliberate empty-state.
// - Numbers formatted with `toLocaleString` for thousand separators;
//   L / KG rounded to 2 decimals.

interface ThreeUnitNumberProps {
  litres: number
  kilograms: number
  numbers: number
  colour?: string   // brand colour for the primary tone; falls back to slate
}

const MIN_DISPLAYABLE = 0.01   // volumes below this drop from display

function fmt(v: number, decimals: number): string {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

export function ThreeUnitNumber({ litres, kilograms, numbers, colour }: ThreeUnitNumberProps) {
  const showLitres = litres >= MIN_DISPLAYABLE
  const showKg = kilograms >= MIN_DISPLAYABLE
  const showNumbers = numbers >= 1   // integers — no threshold nuance
  if (!showLitres && !showKg && !showNumbers) {
    return <p className="text-3xl font-bold text-slate-300">—</p>
  }

  const primary = colour || '#0F172A'
  return (
    <div className="flex items-baseline gap-4 flex-wrap">
      {showLitres && (
        <div>
          <span className="text-2xl font-bold tabular-nums" style={{ color: primary }}>
            {fmt(litres, 2)}
          </span>
          <span className="text-xs text-slate-500 ml-1">L</span>
        </div>
      )}
      {showKg && (
        <div>
          <span className="text-2xl font-bold tabular-nums" style={{ color: primary }}>
            {fmt(kilograms, 2)}
          </span>
          <span className="text-xs text-slate-500 ml-1">kg</span>
        </div>
      )}
      {showNumbers && (
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
