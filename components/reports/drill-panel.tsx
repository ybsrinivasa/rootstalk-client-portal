'use client'

// Shared "Break down by dimension" panel for the Reports drill pages.
// Both /reports/subscriptions and /reports/orders mount this
// component with their own metric list; the panel renders a metric
// picker + dimension tabs + a horizontal-bar table.
//
// Row shape from backend varies per metric; the caller supplies a
// MetricConfig whose renderRow() extracts a (primary, caption) pair
// from each row. Bar width = primary / max(primary).

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DimensionRow = Record<string, any>

export interface MetricConfig {
  key: string
  label: string
  /** Which dimensions this metric supports. Subs_active hides TIME. */
  dimensions: readonly Dimension[]
  /** Extract the primary number + caption to render per row.
   *  Optionally return a `primaryDisplay` string to render in place
   *  of the raw number — used by Sales rows whose value spans three
   *  unit families ("342 L · 12 kg"). */
  renderRow: (row: DimensionRow) => {
    primary: number
    caption: string
    primaryDisplay?: string
  }
}

export type Dimension = 'CROP' | 'SPACE' | 'PACKAGE' | 'TIME' | 'DEALER'

const ALL_DIMENSIONS: readonly { key: Dimension; label: string }[] = [
  { key: 'CROP',    label: 'Crop' },
  { key: 'SPACE',   label: 'State' },
  { key: 'PACKAGE', label: 'Package' },
  { key: 'DEALER',  label: 'Dealer' },
  { key: 'TIME',    label: 'Time' },
] as const

function formatTimeLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

interface DrillPanelProps {
  clientId: string
  /** e.g. `/client/{cid}/reports/orders` (no leading query). */
  endpoint: string
  /** Filter + period query params (no metric/dimension); the panel
   *  appends its own. */
  baseQuery: URLSearchParams
  /** Ordered list of metrics available for this subject. */
  metrics: readonly MetricConfig[]
  /** Brand accent for the bar fill. */
  accent: string
  /** Optional heading, e.g. "Subscriptions broken down by". */
  heading?: string
}

export function DrillPanel({
  clientId, endpoint, baseQuery, metrics, accent, heading = 'Broken down by',
}: DrillPanelProps) {
  const [metricKey, setMetricKey] = useState<string>(metrics[0]?.key ?? '')
  const activeMetric = metrics.find(m => m.key === metricKey) ?? metrics[0]

  const [dimension, setDimension] = useState<Dimension>(
    (activeMetric?.dimensions[0] as Dimension) ?? 'CROP',
  )

  // If the current metric doesn't support the current dimension
  // (e.g. flipping from Total → Active with TIME selected), snap
  // back to the metric's first dimension.
  useEffect(() => {
    if (!activeMetric) return
    if (!activeMetric.dimensions.includes(dimension)) {
      setDimension(activeMetric.dimensions[0])
    }
  }, [activeMetric, dimension])

  const [rows, setRows] = useState<DimensionRow[] | null>(null)
  // Track which (metric, dimension) pair produced the current rows.
  // Prevents a stale-data crash: when the user switches metrics,
  // React re-renders synchronously with the NEW activeMetric config
  // but the OLD rows in state — calling the new renderRow on an old-
  // shape row yields {primary: undefined}, and `undefined.toLocaleString()`
  // downstream crashes the render tree. Guarding rendered computation
  // on rowsFor === current key skips that broken frame entirely.
  const [rowsFor, setRowsFor] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId || !activeMetric) return
    setLoading(true); setError('')
    const q = new URLSearchParams(baseQuery)
    q.set('metric', activeMetric.key)
    q.set('dimension', dimension)
    const fetchKey = `${activeMetric.key}:${dimension}`
    api
      .get<DimensionRow[]>(`${endpoint}?${q.toString()}`)
      .then(({ data }) => { setRows(data); setRowsFor(fetchKey) })
      .catch((err) =>
        setError(extractErrorMessage(err, 'Could not load drill.')),
      )
      .finally(() => setLoading(false))
  }, [clientId, endpoint, baseQuery, activeMetric, dimension])

  if (!activeMetric) return null

  const currentKey = `${activeMetric.key}:${dimension}`
  const rowsFresh = rows !== null && rowsFor === currentKey

  const rendered = rowsFresh
    ? rows!.map(r => ({
        row: r,
        ...activeMetric.renderRow(r),
        label: dimension === 'TIME'
          ? formatTimeLabel(r.key)
          : (r.label || r.key || '—'),
      }))
    : []
  const maxVal = rendered.length > 0
    ? Math.max(...rendered.map(x => x.primary), 1)
    : 1

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm font-medium text-slate-500">{heading}</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Metric picker (only render when >1 metric). */}
          {metrics.length > 1 && (
            <div className="flex items-center gap-1">
              {metrics.map(m => {
                const active = m.key === metricKey
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMetricKey(m.key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      active
                        ? 'border-slate-800 bg-slate-800 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          )}
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-1">
            {ALL_DIMENSIONS.map(d => {
              const enabled = activeMetric.dimensions.includes(d.key)
              if (!enabled) return null
              const active = d.key === dimension
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDimension(d.key)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    active
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {loading || !rowsFresh ? (
        <p className="mt-4 text-slate-400 text-sm">Loading…</p>
      ) : rendered.length === 0 ? (
        <p className="mt-4 text-slate-400 text-sm">
          No data for this dimension with the current filters.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rendered.map((x, i) => {
            const widthPct = Math.round((x.primary / maxVal) * 100)
            return (
              <li
                key={x.row.key ?? i}
                className="flex items-center gap-3 text-sm"
              >
                <span className="w-40 truncate text-slate-700">{x.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${widthPct}%`, backgroundColor: accent }}
                  />
                </div>
                <span className="w-28 text-right tabular-nums text-slate-800 font-medium text-xs sm:text-sm">
                  {x.primaryDisplay ?? (x.primary ?? 0).toLocaleString()}
                </span>
                <span className="w-56 text-right text-xs text-slate-500 tabular-nums">
                  {x.caption}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
