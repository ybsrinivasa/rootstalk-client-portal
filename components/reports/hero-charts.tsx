'use client'

// Overview hero charts — hand-rolled SVG so we don't take a chart-
// library dependency for four small visualisations. Each chart
// takes an already-fetched data array; the Overview page fetches
// the four drill endpoints in parallel alongside overview_bundle.

const AMBER = '#F59E0B'
const SLATE = '#CBD5E1'

// ── Growth trend ──────────────────────────────────────────────────────────────
// Dual-line SVG: relationships (accent) and farmers (amber) over
// time. Data is subs_new_by_dimension?dimension=TIME rows —
// [{key: iso, relationships: n, farmers: m, label}].

interface GrowthPoint {
  key: string
  relationships: number
  farmers: number
  label: string
}

function formatBucket(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

export function GrowthTrendChart({
  data, accent, loading,
}: { data: GrowthPoint[] | null; accent: string; loading: boolean }) {
  const width = 400
  const height = 140
  const padding = { l: 32, r: 12, t: 12, b: 24 }

  const empty = !data || data.length === 0
  const maxY = !empty
    ? Math.max(1, ...data.map(d => Math.max(d.relationships, d.farmers)))
    : 1
  const stepX = !empty && data.length > 1
    ? (width - padding.l - padding.r) / (data.length - 1)
    : 0
  const scaleY = (v: number) =>
    padding.t + (height - padding.t - padding.b) * (1 - v / maxY)
  const pointsFor = (key: 'relationships' | 'farmers') =>
    (data ?? []).map((d, i) =>
      `${padding.l + i * stepX},${scaleY(d[key])}`,
    ).join(' ')

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-slate-500">Growth trend</p>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
            Subscriptions
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: AMBER }} />
            First-time farmers
          </span>
        </div>
      </div>
      {loading || empty ? (
        <p className="mt-6 text-slate-400 text-sm">
          {loading ? 'Loading…' : 'No new subscriptions in the current window.'}
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full h-40" role="img" aria-label="Growth trend chart">
            {/* baseline */}
            <line x1={padding.l} y1={height - padding.b} x2={width - padding.r} y2={height - padding.b} stroke={SLATE} strokeWidth={1} />
            {/* Y axis label — max */}
            <text x={0} y={padding.t + 4} fontSize="10" fill="#64748B">{maxY}</text>
            <text x={0} y={height - padding.b + 4} fontSize="10" fill="#64748B">0</text>
            {/* lines */}
            <polyline fill="none" stroke={accent} strokeWidth={2} points={pointsFor('relationships')} />
            <polyline fill="none" stroke={AMBER}  strokeWidth={2} points={pointsFor('farmers')} strokeDasharray="4 3" />
            {/* dots */}
            {data.map((d, i) => (
              <g key={d.key}>
                <circle cx={padding.l + i * stepX} cy={scaleY(d.relationships)} r={3} fill={accent} />
                <circle cx={padding.l + i * stepX} cy={scaleY(d.farmers)} r={3} fill={AMBER} />
              </g>
            ))}
          </svg>
          <div className="flex justify-between text-[10px] text-slate-500 px-8">
            {data.length > 0 && <span>{formatBucket(data[0].key)}</span>}
            {data.length > 1 && <span>{formatBucket(data[data.length - 1].key)}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ── Ranked horizontal-bar chart (Top states, Top crops) ──────────────────────

interface RankedRow {
  key: string
  label: string
  primary: number
}

export function RankedBarChart({
  title, data, accent, loading, limit = 10, empty,
}: {
  title: string
  data: RankedRow[] | null
  accent: string
  loading: boolean
  limit?: number
  empty: string
}) {
  const rows = (data ?? []).slice(0, limit)
  const max = rows.length > 0 ? Math.max(1, ...rows.map(r => r.primary)) : 1
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {loading ? (
        <p className="mt-4 text-slate-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-slate-400 text-sm">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => {
            const pct = Math.round((r.primary / max) * 100)
            return (
              <li key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-32 truncate text-slate-700">{r.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: accent }}
                  />
                </div>
                <span className="w-10 text-right tabular-nums text-slate-800 font-medium">
                  {r.primary.toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Stacked bar over time (Routing) ───────────────────────────────────────────

interface RoutingBucket {
  key: string
  label: string
  direct: number
  via_facilitator: number
}

export function StackedRoutingChart({
  data, accent, loading,
}: { data: RoutingBucket[] | null; accent: string; loading: boolean }) {
  const rows = data ?? []
  const max = rows.length > 0
    ? Math.max(1, ...rows.map(r => r.direct + r.via_facilitator))
    : 1
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-slate-500">Routing over time</p>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
            Direct
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: AMBER }} />
            Via Facilitator
          </span>
        </div>
      </div>
      {loading ? (
        <p className="mt-4 text-slate-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-slate-400 text-sm">No orders in the current window.</p>
      ) : (
        <div className="mt-4 flex items-end gap-2 h-32">
          {rows.map((r) => {
            const total = r.direct + r.via_facilitator
            const totalPct = (total / max) * 100
            const directPct = total > 0 ? (r.direct / total) * 100 : 0
            return (
              <div key={r.key} className="flex-1 flex flex-col items-center justify-end gap-1">
                <div className="flex flex-col-reverse w-full rounded overflow-hidden" style={{ height: `${totalPct}%` }}>
                  <div style={{ height: `${directPct}%`, backgroundColor: accent }} />
                  <div style={{ height: `${100 - directPct}%`, backgroundColor: AMBER }} />
                </div>
                <span className="text-[10px] text-slate-500 tabular-nums">{formatBucket(r.key)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
