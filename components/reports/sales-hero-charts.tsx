'use client'

// Sales hero charts — three hand-rolled SVGs at the top of the Sales
// page, giving the "over time · where · which crops" story at a
// glance. Same SVG-no-dep approach as Phase 1 Overview hero charts.
//
// Each chart takes an already-fetched data array from the
// sales-by-dimension endpoint. TIME → SalesTrendChart, SPACE →
// TopBar, CROP → TopBar.

const SLATE = '#CBD5E1'
const SLATE_MID = '#94A3B8'

interface LeadPoint {
  key: string
  label?: string
  leads: number
  converted: number
  package_name?: string
}

function fmtBucket(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

function pct(a: number, b: number): number {
  if (b <= 0) return 0
  return Math.round((a / b) * 100)
}

// ── Sales trend over time — stacked bar per bucket ─────────────────
//
// Each bucket = one bar. Green portion = converted; grey portion =
// pending or lost. Full bar height = total leads. Conveys volume +
// conversion in one glance. Overlaid line marks the conversion %
// so trend is readable even when bar heights vary.

export function SalesTrendChart({
  data, accent, loading, title = 'Conversion trend',
}: {
  data: LeadPoint[] | null
  accent: string
  loading: boolean
  title?: string
}) {
  const width = 400
  const height = 160
  const padding = { l: 32, r: 32, t: 12, b: 24 }
  const empty = !data || data.length === 0
  const rows = data ?? []
  const maxLeads = !empty ? Math.max(1, ...rows.map(r => r.leads)) : 1
  const barSlot = !empty
    ? (width - padding.l - padding.r) / rows.length
    : 0
  const barWidth = Math.max(4, barSlot * 0.6)
  const barX = (i: number) => padding.l + i * barSlot + (barSlot - barWidth) / 2
  const chartH = height - padding.t - padding.b
  const scaleY = (v: number) => padding.t + chartH * (1 - v / maxLeads)
  const scalePct = (p: number) => padding.t + chartH * (1 - p / 100)

  const pctPoints = rows.map((r, i) =>
    `${barX(i) + barWidth / 2},${scalePct(pct(r.converted, r.leads))}`,
  ).join(' ')

  const totalLeads = rows.reduce((s, r) => s + r.leads, 0)
  const totalConverted = rows.reduce((s, r) => s + r.converted, 0)
  const overallPct = pct(totalConverted, totalLeads)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        {!loading && !empty && (
          <p className="text-xs text-slate-500 tabular-nums">
            {totalConverted.toLocaleString()} / {totalLeads.toLocaleString()} leads ·{' '}
            <span className="font-semibold" style={{ color: accent }}>{overallPct}%</span>
          </p>
        )}
      </div>
      {loading || empty ? (
        <p className="mt-6 text-slate-400 text-sm">
          {loading ? 'Loading…' : 'No leads in the current window.'}
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full h-40" role="img" aria-label={title}>
            {/* baseline */}
            <line x1={padding.l} y1={height - padding.b} x2={width - padding.r} y2={height - padding.b} stroke={SLATE} strokeWidth={1} />
            {/* Y label — max leads */}
            <text x={0} y={padding.t + 4} fontSize="10" fill="#64748B">{maxLeads}</text>
            <text x={0} y={height - padding.b + 4} fontSize="10" fill="#64748B">0</text>
            {/* right axis — 100% */}
            <text x={width - padding.r + 2} y={padding.t + 4} fontSize="10" fill="#64748B">100%</text>
            {/* bars: full grey height = leads, green top = converted */}
            {rows.map((r, i) => {
              const topY = scaleY(r.leads)
              const convY = scaleY(r.converted)
              const barBaseY = height - padding.b
              return (
                <g key={r.key}>
                  <rect
                    x={barX(i)} y={topY}
                    width={barWidth}
                    height={barBaseY - topY}
                    fill={SLATE}
                    rx="1"
                  />
                  {r.converted > 0 && (
                    <rect
                      x={barX(i)} y={convY}
                      width={barWidth}
                      height={barBaseY - convY}
                      fill={accent}
                      rx="1"
                    />
                  )}
                </g>
              )
            })}
            {/* conversion % overlay line */}
            {rows.length > 1 && (
              <polyline fill="none" stroke="#0F172A" strokeWidth={1.5} strokeDasharray="3 2" points={pctPoints} />
            )}
            {rows.map((r, i) => (
              <circle
                key={r.key + 'pct'}
                cx={barX(i) + barWidth / 2}
                cy={scalePct(pct(r.converted, r.leads))}
                r={2.5}
                fill="#0F172A"
              />
            ))}
          </svg>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-8">
            {rows.length > 0 && <span>{fmtBucket(rows[0].key)}</span>}
            {rows.length > 1 && <span>{fmtBucket(rows[rows.length - 1].key)}</span>}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: accent }} />
              Converted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm bg-slate-300" />
              Pending / lost
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[2px] bg-slate-900" />
              Conversion %
            </span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Ranked bar — leads with conversion % annotation per row ─────────

export function SalesTopBar({
  title, data, accent, loading, emptyText, limit = 8,
}: {
  title: string
  data: LeadPoint[] | null
  accent: string
  loading: boolean
  emptyText: string
  limit?: number
}) {
  const rows = (data ?? []).slice(0, limit)
  const maxLeads = rows.length > 0 ? Math.max(1, ...rows.map(r => r.leads)) : 1
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
            const label = r.label || r.package_name || r.key || '—'
            const p = pct(r.converted, r.leads)
            const barWidth = Math.round((r.leads / maxLeads) * 100)
            return (
              <li key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-32 truncate text-slate-700" title={label}>{label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full" style={{ width: `${barWidth}%`, backgroundColor: accent }} />
                </div>
                <span className="w-14 text-right tabular-nums text-xs text-slate-700">
                  {r.leads.toLocaleString()}
                </span>
                <span className="w-10 text-right tabular-nums text-xs" style={{ color: SLATE_MID }}>
                  {p}%
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
