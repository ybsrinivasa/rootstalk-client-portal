'use client'

// Promoter hero charts — three lightweight SVGs sized like Sales but
// single-metric (no converted/pending split). Bar chart over time +
// two ranked-bar lists (top states, top crops).

const SLATE = '#CBD5E1'

export type BucketSize = 'day' | 'week' | 'month'

interface Point {
  key: string
  label?: string
  value: number
}

function fmtBucketLabel(iso: string, bucket: BucketSize): string {
  const d = new Date(iso)
  const monthShort = d.toLocaleDateString(undefined, { month: 'short' })
  const day = d.getDate().toString().padStart(2, '0')
  if (bucket === 'day') return `${day} ${monthShort}`
  if (bucket === 'week') {
    const end = new Date(d)
    end.setDate(end.getDate() + 6)
    const endDay = end.getDate().toString().padStart(2, '0')
    const endMonthShort = end.toLocaleDateString(undefined, { month: 'short' })
    if (monthShort === endMonthShort) return `${day}–${endDay} ${monthShort}`
    return `${day} ${monthShort}–${endDay} ${endMonthShort}`
  }
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// Format the y-axis and per-row values based on what the metric is:
//   integer count  → "1,234"
//   acres          → "1,234" (rounded) or "12.3" (< 100)
//   seconds        → "45m" / "6.4h" / "3d"
function fmtValue(v: number, isAcres: boolean, isDuration: boolean = false): string {
  if (isDuration) {
    if (!v || v <= 0) return '—'
    const mins = v / 60
    if (mins < 60) return `${Math.round(mins)}m`
    const hours = mins / 60
    if (hours < 48) return `${hours.toFixed(1)}h`
    return `${Math.round(hours / 24)}d`
  }
  if (!isAcres) return Math.round(v).toLocaleString()
  const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  return rounded.toLocaleString()
}

// ── Trend over time — solid bars per bucket ──────────────────────────

export function PromoterTrendChart({
  data, accent, loading, bucket, title, isAcres = false, isDuration = false, unitLabel = '',
}: {
  data: Point[] | null
  accent: string
  loading: boolean
  bucket: BucketSize
  title: string
  isAcres?: boolean
  isDuration?: boolean
  unitLabel?: string
}) {
  const width = 400
  const height = 160
  const padding = { l: 40, r: 12, t: 12, b: 26 }
  const rows = data ?? []
  const empty = rows.length === 0
  const maxV = !empty ? Math.max(1, ...rows.map(r => r.value)) : 1
  const barSlot = !empty ? (width - padding.l - padding.r) / rows.length : 0
  const barWidth = Math.max(4, barSlot * 0.6)
  const barX = (i: number) => padding.l + i * barSlot + (barSlot - barWidth) / 2
  const chartH = height - padding.t - padding.b
  const scaleY = (v: number) => padding.t + chartH * (1 - v / maxV)

  // Summing durations across buckets is meaningless (would double-count
  // farmers who submitted queries in multiple buckets and be an
  // unweighted total of averages). For duration metrics we show Peak
  // (max bucket value) so the header still carries a useful headline
  // number. For count/acres metrics, keep the running total.
  const total = rows.reduce((s, r) => s + r.value, 0)
  const headlineLabel = isDuration ? 'Peak' : 'Total'
  const headlineValue = isDuration ? maxV : total

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        {!loading && !empty && (
          <p className="text-xs text-slate-500 tabular-nums">
            {headlineLabel}: <span className="font-semibold" style={{ color: accent }}>{fmtValue(headlineValue, isAcres, isDuration)}</span>
            {unitLabel && <span className="text-slate-400 ml-1">{unitLabel}</span>}
          </p>
        )}
      </div>
      {loading || empty ? (
        <p className="mt-6 text-slate-400 text-sm">
          {loading ? 'Loading…' : 'No data in the current window.'}
        </p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full h-40" role="img" aria-label={title}>
          <line x1={padding.l} y1={height - padding.b} x2={width - padding.r} y2={height - padding.b} stroke={SLATE} strokeWidth={1} />
          <text x={0} y={padding.t + 4} fontSize="10" fill="#64748B">{fmtValue(maxV, isAcres, isDuration)}</text>
          <text x={0} y={height - padding.b + 4} fontSize="10" fill="#64748B">0</text>
          {rows.map((r, i) => {
            const topY = scaleY(r.value)
            const barBaseY = height - padding.b
            return (
              <rect
                key={r.key}
                x={barX(i)} y={topY}
                width={barWidth}
                height={barBaseY - topY}
                fill={accent}
                rx="1"
              />
            )
          })}
          {rows.map((r, i) => {
            const step = rows.length <= 6 ? 1 : rows.length <= 12 ? 2 : Math.ceil(rows.length / 6)
            if (i % step !== 0 && i !== rows.length - 1) return null
            return (
              <text
                key={r.key + 'lbl'}
                x={barX(i) + barWidth / 2}
                y={height - padding.b + 14}
                fontSize="9"
                fill="#64748B"
                textAnchor="middle"
              >
                {fmtBucketLabel(r.key, bucket)}
              </text>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ── Ranked horizontal-bar list (Top states, Top crops) ──────────────

export function PromoterTopBar({
  title, data, accent, loading, emptyText, limit = 8, isAcres = false, isDuration = false,
}: {
  title: string
  data: Point[] | null
  accent: string
  loading: boolean
  emptyText: string
  limit?: number
  isAcres?: boolean
  isDuration?: boolean
}) {
  const rows = (data ?? []).slice(0, limit)
  const maxV = rows.length > 0 ? Math.max(1, ...rows.map(r => r.value)) : 1
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {loading ? (
        <p className="mt-6 text-slate-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-slate-400 text-sm">{emptyText}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map(r => {
            const label = r.label || r.key || '—'
            const barWidth = Math.round((r.value / maxV) * 100)
            return (
              <li key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-32 truncate text-slate-700" title={label}>{label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full" style={{ width: `${barWidth}%`, backgroundColor: accent }} />
                </div>
                <span className="w-16 text-right tabular-nums text-xs text-slate-700">
                  {fmtValue(r.value, isAcres, isDuration)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
