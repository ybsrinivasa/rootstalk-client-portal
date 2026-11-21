'use client'

// Client Reports — Queries (Phase 4, 2026-08-05; list panel 2026-11-21).
//
// Three parts on one page:
//
//   Queries area (top)
//     Six headline cards (Total, Responded, Avg Response Time,
//     Within 24h, Expired, By Severity). Expired leads with the % now
//     so bottom-of-pile efficiency is obvious at a glance.
//     Hero trend + top-space + top-crop for the currently-toggled metric.
//     Drill panel for the four countable metrics × 3 dims.
//
//   Query list (2026-11-21)
//     Three tabs: Open · Expired · Responded. Each paginated (25/page)
//     respecting the page-level filters. Response-time bucket chip
//     visible only on Responded. CSV export button CA-only (gated on
//     `hasPortalRole`); server writes an audit row on download.
//
//   Pundit Scorecard (below)
//     Per-pundit row: receptions, responded, forwarded_out, returned,
//     expired, avg response time. Pooled footer. No trend.
//
// Filters: Crop · State · District · Pundit (multi-select) · Period.
// Severity is intentionally NOT a filter — farmer-reported, unverified.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient, getUser, hasPortalRole } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { PunditScorecard, type PunditScoreRow } from '@/components/reports/pundit-scorecard'
import { DrillPanel, type MetricConfig } from '@/components/reports/drill-panel'
import { useCascadingFilterOptions } from '@/components/reports/use-filter-options'
import { PromoterTrendChart, PromoterTopBar } from '@/components/reports/promoter-hero-charts'
import { ExportCsvButton } from '@/components/reports/export-button'

interface FilterOption { id: string; name: string }
interface FilterOptionsResponse {
  crops: FilterOption[]
  states: FilterOption[]
  districts: FilterOption[]
  severities?: FilterOption[]
  pundits?: FilterOption[]
}

interface CountShape { count: number }
interface AvgResponseShape { avg_seconds: number; responded: number }
interface SlaShape { within: number; total: number; sla_hours: number }
interface SeverityShape {
  critical: number
  high: number
  moderate: number
  low: number
  other: number
  total: number
}

interface QueriesData {
  count: CountShape | null
  responded: CountShape | null
  avg: AvgResponseShape | null
  sla: SlaShape | null
  expired: CountShape | null
  severity: SeverityShape | null
}

const EMPTY_DATA: QueriesData = {
  count: null, responded: null, avg: null, sla: null, expired: null, severity: null,
}

// 2026-11-21 — Severity dropped per user call: farmer-reported, unverified.
// Pundit moves to a dedicated multi-select chip rendered separately; the
// chips-array only holds the single-value ones so the uniform render loop
// stays simple.
const CHIPS = [
  { urlKey: 'crop',     apiKey: 'crop_cosh_id',     optionsKey: 'crops' as const,     label: 'Crop',     allLabel: 'All crops' },
  { urlKey: 'state',    apiKey: 'state_cosh_id',    optionsKey: 'states' as const,    label: 'State',    allLabel: 'All states' },
  { urlKey: 'district', apiKey: 'district_cosh_id', optionsKey: 'districts' as const, label: 'District', allLabel: 'All districts' },
] as const

const PERIOD_PRESETS = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-90d',   label: 'Last 90 days' },
  { key: 'all',        label: 'All time' },
  { key: 'custom',     label: 'Custom range' },
] as const

type PeriodPreset = typeof PERIOD_PRESETS[number]['key']
type FilterValues = Record<typeof CHIPS[number]['urlKey'], string>

const EMPTY_FILTERS: FilterValues = {
  crop: '', state: '', district: '',
}

// 2026-11-21 — Status buckets for the drill-in list.
type StatusBucket = 'OPEN' | 'EXPIRED' | 'RESPONDED'
type ResponseTimeBucket = '' | 'UNDER_1D' | 'UNDER_2D' | 'OVER_2D'
const RESPONSE_TIME_LABELS: Record<Exclude<ResponseTimeBucket, ''>, string> = {
  UNDER_1D: 'Under 1 day',
  UNDER_2D: '1–2 days',
  OVER_2D: 'Over 2 days',
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function periodDates(preset: PeriodPreset, customFrom: string, customTo: string): { from?: Date; to?: Date } {
  const now = new Date()
  if (preset === 'this-month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to:   new Date(now.getFullYear(), now.getMonth() + 1, 1),
    }
  }
  if (preset === 'last-month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to:   new Date(now.getFullYear(), now.getMonth(), 1),
    }
  }
  if (preset === 'last-90d') {
    const from = new Date(); from.setDate(from.getDate() - 90); from.setHours(0, 0, 0, 0)
    const to = new Date()
    return { from, to }
  }
  if (preset === 'custom') {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : undefined
    let to: Date | undefined
    if (customTo) {
      to = new Date(`${customTo}T00:00:00`)
      to.setDate(to.getDate() + 1)
    }
    return { from, to }
  }
  return {}
}

function pickBucket(preset: PeriodPreset, customFrom: string, customTo: string): 'day' | 'week' | 'month' {
  const { from, to } = periodDates(preset, customFrom, customTo)
  if (!from || !to) return 'month'
  const days = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000))
  if (days <= 14) return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

function pct(a: number, b: number): number {
  if (b <= 0) return 0
  return Math.round((a / b) * 100)
}

function pctColour(p: number, good: number, ok: number): string {
  if (p >= good) return '#15803d'
  if (p >= ok) return '#B45309'
  return '#B91C1C'
}

function fmtAvg(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const mins = seconds / 60
  if (mins < 60) return `${Math.round(mins)}m`
  const hours = mins / 60
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${Math.round(hours / 24)}d`
}

function countRow(r: Record<string, number>) {
  const v = Number(r.value) || 0
  return { primary: v, primaryDisplay: v.toLocaleString(), caption: '' }
}

function avgTimeRow(r: Record<string, number>) {
  const v = Number(r.value) || 0
  return { primary: v, primaryDisplay: fmtAvg(v), caption: '' }
}

const QUERIES_DRILL_METRICS: readonly MetricConfig[] = [
  { key: 'COUNT',        label: 'Total',        dimensions: ['CROP', 'SPACE', 'TIME'], renderRow: countRow },
  { key: 'RESPONDED',    label: 'Responded',    dimensions: ['CROP', 'SPACE', 'TIME'], renderRow: countRow },
  { key: 'EXPIRED',      label: 'Expired',      dimensions: ['CROP', 'SPACE', 'TIME'], renderRow: countRow },
  { key: 'AVG_RESPONSE', label: 'Avg time',     dimensions: ['CROP', 'SPACE', 'TIME'], renderRow: avgTimeRow },
]

export default function QueriesReportPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <QueriesReportInner />
    </Suspense>
  )
}

function QueriesReportInner() {
  const client = getClient()
  const clientId = client?.id
  const brandColour = client?.primary_colour || '#0F172A'

  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filterValues, setFilterValues] = useState<FilterValues>(() => ({
    crop:     searchParams.get('crop')     || '',
    state:    searchParams.get('state')    || '',
    district: searchParams.get('district') || '',
  }))

  // Pundit multi-select. URL shape: `?pundit=A,B,C`. Empty array = all
  // pundits = no filter applied (defaults). Rendered as its own chip
  // with a popover (native <select multiple> is too clunky for 20+
  // pundits + screen-reader-hostile).
  const [punditIds, setPunditIds] = useState<string[]>(() => {
    const raw = searchParams.get('pundit') || ''
    return raw ? raw.split(',').filter(Boolean) : []
  })
  const [punditPopoverOpen, setPunditPopoverOpen] = useState(false)
  const [period, setPeriod] = useState<PeriodPreset>(() => {
    const p = searchParams.get('period') as PeriodPreset | null
    return p && PERIOD_PRESETS.some(x => x.key === p) ? p : 'this-month'
  })
  const [customFrom, setCustomFrom] = useState<string>(() => searchParams.get('from') || '')
  const [customTo,   setCustomTo]   = useState<string>(() => searchParams.get('to')   || '')

  const [data, setData] = useState<QueriesData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const [scorecard, setScorecard] = useState<PunditScoreRow[]>([])
  const [scorecardPooled, setScorecardPooled] = useState<PunditScoreRow | null>(null)
  const [scorecardLoading, setScorecardLoading] = useState(true)

  const [heroMetric, setHeroMetric] = useState<'COUNT' | 'RESPONDED' | 'EXPIRED' | 'AVG_RESPONSE'>('COUNT')
  const [heroTime, setHeroTime] = useState<{ key: string; value: number }[]>([])
  const [heroSpace, setHeroSpace] = useState<{ key: string; label?: string; value: number }[]>([])
  const [heroCrop, setHeroCrop] = useState<{ key: string; label?: string; value: number }[]>([])
  const [heroLoading, setHeroLoading] = useState(true)

  const options = useCascadingFilterOptions({
    clientId,
    filterValues,
    endpointPath: 'queries/filter-options',
    onEvicted: (evicted) => {
      setFilterValues(prev => {
        const next = { ...prev }
        for (const chip of evicted) next[chip as keyof FilterValues] = ''
        return next
      })
      const chipLabels = evicted.map(c => CHIPS.find(x => x.urlKey === c)?.label ?? c).join(', ')
      setToast(`${chipLabels} filter${evicted.length > 1 ? 's' : ''} cleared — no data with the new filters`)
      setTimeout(() => setToast(null), 4000)
    },
  }) as FilterOptionsResponse | null

  // Helper — append every filter chip + period + multi-select pundit
  // into the URLSearchParams in the shape the backend expects. Used
  // for the hero cards, the drill panel, the scorecard, and the new
  // list panel so the server sees a single consistent filter set.
  const buildFilterParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) params.set(chip.apiKey, v)
    }
    for (const pid of punditIds) params.append('pundit_id', pid)
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) params.set('period_from', from.toISOString())
    if (to)   params.set('period_to',   to.toISOString())
    return params
  }, [filterValues, punditIds, period, customFrom, customTo])

  const fetchGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++fetchGen.current
    setLoading(true); setError('')
    const filterParams = buildFilterParams()
    const url = (metric: string) => {
      const q = new URLSearchParams(filterParams)
      q.set('metric', metric)
      return `/client/${clientId}/reports/queries?${q.toString()}`
    }
    Promise.all([
      api.get<CountShape>(url('COUNT')),
      api.get<CountShape>(url('RESPONDED')),
      api.get<AvgResponseShape>(url('AVG_RESPONSE')),
      api.get<SlaShape>(url('SLA_24H')),
      api.get<CountShape>(url('EXPIRED')),
      api.get<SeverityShape>(url('SEVERITY')),
    ])
      .then(([countRes, respRes, avgRes, slaRes, expRes, sevRes]) => {
        if (fetchGen.current !== myGen) return
        setData({
          count: countRes.data,
          responded: respRes.data,
          avg: avgRes.data,
          sla: slaRes.data,
          expired: expRes.data,
          severity: sevRes.data,
        })
        setError('')
      })
      .catch(err => {
        if (fetchGen.current !== myGen) return
        setError(extractErrorMessage(err, 'Could not load Queries data.'))
      })
      .finally(() => {
        if (fetchGen.current !== myGen) return
        setLoading(false)
      })
  }, [clientId, filterValues, punditIds, period, customFrom, customTo, buildFilterParams])

  const scorecardGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++scorecardGen.current
    setScorecardLoading(true)
    const filterParams = buildFilterParams()
    api
      .get<{ rows: PunditScoreRow[]; pooled: PunditScoreRow | null }>(
        `/client/${clientId}/reports/queries/pundit-scorecard?${filterParams.toString()}`,
      )
      .then(({ data }) => {
        if (scorecardGen.current !== myGen) return
        setScorecard(data.rows)
        setScorecardPooled(data.pooled)
      })
      .catch(() => { /* silent */ })
      .finally(() => {
        if (scorecardGen.current !== myGen) return
        setScorecardLoading(false)
      })
  }, [clientId, filterValues, punditIds, period, customFrom, customTo, buildFilterParams])

  const heroGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++heroGen.current
    setHeroLoading(true)
    const base = buildFilterParams()
    const url = (dim: 'TIME' | 'SPACE' | 'CROP') => {
      const q = new URLSearchParams(base)
      q.set('metric', heroMetric)
      q.set('dimension', dim)
      return `/client/${clientId}/reports/queries?${q.toString()}`
    }
    Promise.all([
      api.get<{ key: string; value: number }[]>(url('TIME')),
      api.get<{ key: string; label?: string; value: number }[]>(url('SPACE')),
      api.get<{ key: string; label?: string; value: number }[]>(url('CROP')),
    ])
      .then(([timeRes, spaceRes, cropRes]) => {
        if (heroGen.current !== myGen) return
        setHeroTime(timeRes.data)
        setHeroSpace(spaceRes.data)
        setHeroCrop(cropRes.data)
      })
      .catch(() => { /* silent */ })
      .finally(() => {
        if (heroGen.current !== myGen) return
        setHeroLoading(false)
      })
  }, [clientId, filterValues, punditIds, period, customFrom, customTo, heroMetric, buildFilterParams])

  useEffect(() => {
    const params = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) params.set(chip.urlKey, v)
    }
    if (punditIds.length) params.set('pundit', punditIds.join(','))
    if (period !== 'this-month') params.set('period', period)
    if (period === 'custom') {
      if (customFrom) params.set('from', customFrom)
      if (customTo)   params.set('to',   customTo)
    }
    const qs = params.toString()
    const target = qs ? `${pathname}?${qs}` : pathname
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(null, '', target)
    }
  }, [pathname, filterValues, punditIds, period, customFrom, customTo])

  const updateFilter = useCallback((urlKey: keyof FilterValues, value: string) => {
    setFilterValues(prev => ({ ...prev, [urlKey]: value }))
  }, [])

  const clearAll = useCallback(() => {
    setFilterValues(EMPTY_FILTERS)
    setPunditIds([])
    setPeriod('this-month')
    setCustomFrom('')
    setCustomTo('')
  }, [])

  const togglePundit = useCallback((pid: string) => {
    setPunditIds(prev =>
      prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid],
    )
  }, [])

  const changePeriod = useCallback((next: PeriodPreset) => {
    if (next === 'custom' && !customFrom && !customTo) {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      setCustomFrom(toYmd(start))
      setCustomTo(toYmd(now))
    }
    setPeriod(next)
  }, [customFrom, customTo])

  const anyFilter = (
    CHIPS.some(c => filterValues[c.urlKey])
    || punditIds.length > 0
    || period !== 'this-month'
  )

  // Derived numbers
  const totalQ = data.count?.count ?? 0
  const respondedQ = data.responded?.count ?? 0
  const respondedPct = pct(respondedQ, totalQ)
  const slaPct = pct(data.sla?.within ?? 0, data.sla?.total ?? 0)
  const expiredQ = data.expired?.count ?? 0
  const sev = data.severity

  const heroMetricLabel = (
    heroMetric === 'COUNT' ? 'Total Queries' :
    heroMetric === 'RESPONDED' ? 'Responded' :
    heroMetric === 'EXPIRED' ? 'Expired' :
    'Avg Response Time'
  )
  const heroIsTime = heroMetric === 'AVG_RESPONSE'
  const heroTitle = `${heroMetricLabel} over time`

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <ReportSubjectTabs />

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Queries</h1>
        <p className="text-sm text-slate-500 mt-1">
          Farmer queries received, responded, and expired — plus a per-pundit scorecard for the experts handling them.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {CHIPS.map(chip => {
          const opts = options?.[chip.optionsKey] ?? []
          const value = filterValues[chip.urlKey]
          const isSet = !!value
          const selectedLabel = isSet
            ? (options ? (opts.find(o => o.id === value)?.name ?? value) : '…')
            : chip.allLabel
          return (
            <div
              key={chip.urlKey}
              className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                isSet
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              <span className={`text-xs uppercase tracking-wider ${isSet ? 'text-white/70' : 'text-slate-400'}`}>
                {chip.label}
              </span>
              <span className="max-w-[10rem] truncate">{selectedLabel}</span>
              <select
                value={value}
                onChange={(e) => updateFilter(chip.urlKey, e.target.value)}
                aria-label={`Filter by ${chip.label}`}
                className={`absolute top-0 bottom-0 left-0 opacity-0 cursor-pointer ${isSet ? 'right-8' : 'right-0'}`}
              >
                <option value="">{chip.allLabel}</option>
                {opts.map(o => (<option key={o.id} value={o.id}>{o.name}</option>))}
              </select>
              {isSet && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); updateFilter(chip.urlKey, '') }}
                  className="relative z-10 text-white/70 hover:text-white leading-none px-1"
                  aria-label={`Clear ${chip.label} filter`}
                >×</button>
              )}
            </div>
          )
        })}
        <PunditChip
          options={options?.pundits ?? []}
          selected={punditIds}
          onToggle={togglePundit}
          onClear={() => setPunditIds([])}
          open={punditPopoverOpen}
          setOpen={setPunditPopoverOpen}
        />
        <div className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors border-slate-800 bg-slate-800 text-white">
          <span className="text-xs uppercase tracking-wider text-white/70">Period</span>
          <span className="max-w-[10rem] truncate">
            {PERIOD_PRESETS.find(p => p.key === period)?.label ?? 'This month'}
          </span>
          <select
            value={period}
            onChange={(e) => changePeriod(e.target.value as PeriodPreset)}
            aria-label="Filter by Period"
            className="absolute inset-0 opacity-0 cursor-pointer"
          >
            {PERIOD_PRESETS.map(p => (<option key={p.key} value={p.key}>{p.label}</option>))}
          </select>
        </div>
        {anyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2 ml-1"
          >Clear all</button>
        )}
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center text-sm text-slate-600">
          <label className="flex items-center gap-1.5">
            From
            <input type="date" value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1" />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input type="date" value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1" />
          </label>
        </div>
      )}

      {toast && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          {toast}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Headline row — Queries area cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <QueryCard title="Total Queries" caption="Queries received in this window matching your filters.">
          <p className="text-4xl font-bold tabular-nums" style={{ color: brandColour }}>
            {loading ? '…' : totalQ.toLocaleString()}
          </p>
        </QueryCard>
        <QueryCard title="Responded" caption="Queries with at least one expert response. Percentage of total.">
          <div>
            <p className="text-4xl font-bold tabular-nums" style={{ color: pctColour(respondedPct, 85, 60) }}>
              {loading ? '…' : `${respondedPct}%`}
            </p>
            {!loading && (
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {respondedQ.toLocaleString()} of {totalQ.toLocaleString()}
              </p>
            )}
          </div>
        </QueryCard>
        <QueryCard title="Avg Response Time" caption="Mean time from farmer submission to first expert response.">
          <p className="text-4xl font-bold tabular-nums" style={{ color: brandColour }}>
            {loading ? '…' : fmtAvg(data.avg?.avg_seconds ?? 0)}
          </p>
          {!loading && (
            <p className="text-xs text-slate-500 tabular-nums mt-1">
              across {data.avg?.responded?.toLocaleString() ?? 0} responded
            </p>
          )}
        </QueryCard>
        <QueryCard title="Within 24h" caption="Share of queries that got a first response within a day of submission.">
          <div>
            <p className="text-4xl font-bold tabular-nums" style={{ color: pctColour(slaPct, 70, 40) }}>
              {loading ? '…' : `${slaPct}%`}
            </p>
            {!loading && (
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {(data.sla?.within ?? 0).toLocaleString()} of {(data.sla?.total ?? 0).toLocaleString()} in 24h
              </p>
            )}
          </div>
        </QueryCard>
        <QueryCard title="Expired %" caption="Queries that hit their expiry without any expert response. Reflects the efficiency of the expert team.">
          <div>
            <p
              className="text-4xl font-bold tabular-nums"
              style={{ color: expiredQ > 0 ? '#B91C1C' : brandColour }}
            >
              {loading ? '…' : totalQ > 0 ? `${pct(expiredQ, totalQ)}%` : '0%'}
            </p>
            {!loading && (
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {expiredQ.toLocaleString()} of {totalQ.toLocaleString()} expired
              </p>
            )}
          </div>
        </QueryCard>
        <QueryCard title="By Severity" caption="Split by the severity farmers marked at submission.">
          <div className="space-y-1.5">
            {([
              { k: 'critical', label: 'Critical', colour: '#B91C1C' },
              { k: 'high',     label: 'High',     colour: '#C2410C' },
              { k: 'moderate', label: 'Moderate', colour: '#B45309' },
              { k: 'low',      label: 'Low',      colour: '#15803d' },
            ] as const).map(({ k, label, colour }) => {
              const count = sev?.[k] ?? 0
              const total = sev?.total ?? 0
              const barWidth = total > 0 ? Math.round((count / total) * 100) : 0
              return (
                <div key={k} className="flex items-center gap-2 text-sm">
                  <span className="w-16 text-xs" style={{ color: colour }}>{label}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full" style={{ width: `${barWidth}%`, backgroundColor: colour }} />
                  </div>
                  <span className="w-14 text-right tabular-nums text-xs text-slate-700">
                    {count.toLocaleString()}
                  </span>
                </div>
              )
            })}
            {(sev?.other ?? 0) > 0 && (
              <p className="text-[10px] text-slate-400 mt-1">
                + {sev?.other} with a legacy severity value
              </p>
            )}
          </div>
        </QueryCard>
      </div>

      {/* Trends toggle + charts */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-slate-500 font-medium">Trends for:</span>
        {(['COUNT', 'RESPONDED', 'EXPIRED', 'AVG_RESPONSE'] as const).map(m => {
          const active = heroMetric === m
          const label = (
            m === 'COUNT' ? 'Total' :
            m === 'RESPONDED' ? 'Responded' :
            m === 'EXPIRED' ? 'Expired' :
            'Avg Time'
          )
          return (
            <button
              key={m}
              type="button"
              onClick={() => setHeroMetric(m)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                active
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <PromoterTrendChart
        data={heroTime}
        accent={brandColour}
        loading={heroLoading}
        bucket={pickBucket(period, customFrom, customTo)}
        title={heroTitle}
        isDuration={heroIsTime}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PromoterTopBar
          title={`Top states — ${heroMetricLabel}`}
          data={heroSpace}
          accent={brandColour}
          loading={heroLoading}
          emptyText="No location data in the current window."
          isDuration={heroIsTime}
        />
        <PromoterTopBar
          title={`Top crops — ${heroMetricLabel}`}
          data={heroCrop}
          accent={brandColour}
          loading={heroLoading}
          emptyText="No crop data in the current window."
          isDuration={heroIsTime}
        />
      </div>

      {/* Drill panel */}
      {clientId && (
        <DrillPanel
          clientId={clientId}
          endpoint={`/client/${clientId}/reports/queries`}
          baseQuery={buildBaseQuery(filterValues, period, customFrom, customTo)}
          metrics={QUERIES_DRILL_METRICS}
          accent={brandColour}
          heading="Queries broken down by"
        />
      )}

      {/* Drill-in list (2026-11-21) */}
      {clientId && (
        <QueriesListPanel
          clientId={clientId}
          buildFilterParams={buildFilterParams}
          brandColour={brandColour}
        />
      )}

      {/* Pundit Scorecard */}
      <PunditScorecard
        rows={scorecard}
        pooled={scorecardPooled}
        loading={scorecardLoading}
        brandColour={brandColour}
      />
    </div>
  )
}

// ── Pundit multi-select chip ────────────────────────────────────────────────
//
// Separate from the single-select CHIPS loop because its render logic
// (popover + checkbox list + "Clear all" footer) is too different to
// shoehorn into the shared chip template. All-deselected = "All
// pundits" = no filter applied.

interface PunditChipProps {
  options: FilterOption[]
  selected: string[]
  onToggle: (pid: string) => void
  onClear: () => void
  open: boolean
  setOpen: (o: boolean) => void
}

function PunditChip({ options, selected, onToggle, onClear, open, setOpen }: PunditChipProps) {
  const isSet = selected.length > 0
  const label = !isSet
    ? 'All pundits'
    : selected.length === 1
      ? (options.find(o => o.id === selected[0])?.name ?? selected[0])
      : `${selected.length} pundits`
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
          isSet
            ? 'border-slate-800 bg-slate-800 text-white'
            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
        }`}
      >
        <span className={`text-xs uppercase tracking-wider ${isSet ? 'text-white/70' : 'text-slate-400'}`}>
          Pundit
        </span>
        <span className="max-w-[10rem] truncate">{label}</span>
        <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-2 w-64 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
            {options.length === 0 ? (
              <p className="text-xs text-slate-500 px-3 py-2">No pundits in the current window.</p>
            ) : (
              <>
                {options.map(opt => {
                  const checked = selected.includes(opt.id)
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(opt.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="flex-1 truncate">{opt.name}</span>
                    </label>
                  )
                })}
                {isSet && (
                  <div className="border-t border-slate-100 mt-1 pt-1 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => { onClear(); setOpen(false) }}
                      className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
                    >
                      Clear selection (all pundits)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Drill-in list panel (2026-11-21) ────────────────────────────────────────
//
// Three tabs (Open / Expired / Responded) each paginated 25/page.
// Inherits every page-level filter via `buildFilterParams`; adds a
// Response-time bucket chip visible only on the Responded tab.
// CSV export is CA-only (ExportCsvButton no-ops for other roles);
// server writes an audit row on download.

interface QueryListRow {
  id: string
  created_at: string
  expires_at: string
  responded_at: string | null
  status: string
  severity: string
  title: string
  description: string
  crop_name: string
  district_name: string
  state_name: string
  farmer_name: string
  farmer_phone_masked: string
  current_holder_name: string
  response_seconds: number | null
  response_bucket: string | null
  media_count: number
}

interface QueryListPayload {
  rows: QueryListRow[]
  total: number
  page: number
  page_size: number
  status: StatusBucket
}

interface QueriesListPanelProps {
  clientId: string
  buildFilterParams: () => URLSearchParams
  brandColour: string
}

const STATUS_TABS: { key: StatusBucket; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'RESPONDED', label: 'Responded' },
]

const PAGE_SIZE = 25

function QueriesListPanel({ clientId, buildFilterParams, brandColour }: QueriesListPanelProps) {
  const client = getClient()
  const canExport = hasPortalRole(getUser(), 'CA')

  const [tab, setTab] = useState<StatusBucket>('OPEN')
  const [page, setPage] = useState(1)
  const [responseBucket, setResponseBucket] = useState<ResponseTimeBucket>('')
  const [data, setData] = useState<QueryListPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Reset page to 1 on tab change / filter change.
  const filterSignature = buildFilterParams().toString()
  useEffect(() => { setPage(1) }, [tab, filterSignature, responseBucket])

  const fetchGen = useRef(0)
  useEffect(() => {
    const myGen = ++fetchGen.current
    setLoading(true); setError('')
    const params = buildFilterParams()
    params.set('status', tab)
    params.set('page', String(page))
    params.set('page_size', String(PAGE_SIZE))
    if (tab === 'RESPONDED' && responseBucket) {
      params.set('response_time_bucket', responseBucket)
    }
    api
      .get<QueryListPayload>(`/client/${clientId}/reports/queries/list?${params.toString()}`)
      .then(res => {
        if (fetchGen.current !== myGen) return
        setData(res.data)
        setExpanded(new Set())
      })
      .catch(err => {
        if (fetchGen.current !== myGen) return
        setError(extractErrorMessage(err, 'Could not load the list.'))
      })
      .finally(() => {
        if (fetchGen.current !== myGen) return
        setLoading(false)
      })
  }, [clientId, tab, page, responseBucket, filterSignature, buildFilterParams])

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exportHref = useMemo(() => {
    const params = buildFilterParams()
    params.set('status', tab)
    if (tab === 'RESPONDED' && responseBucket) {
      params.set('response_time_bucket', responseBucket)
    }
    return `/client/${clientId}/reports/queries/export.csv?${params.toString()}`
  }, [clientId, tab, responseBucket, buildFilterParams])

  const shortName = client?.short_name || 'client'
  const stamp = toYmd(new Date()).replace(/-/g, '')
  const exportFallbackName = `${shortName}-queries-${tab.toLowerCase()}-${stamp}.csv`

  const total = data?.total ?? 0
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1
  const rows = data?.rows ?? []

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Queries list</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every query matching your filters, grouped by state. Open ignores the period filter — queries expire after 14 days anyway.
          </p>
        </div>
        {canExport && (
          <ExportCsvButton href={exportHref} fallbackFilename={exportFallbackName} />
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <div className="inline-flex gap-1 bg-slate-100 p-1 rounded-xl">
          {STATUS_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? 'bg-white shadow-sm text-slate-800'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'RESPONDED' && (
          <div className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm border-slate-300 bg-white text-slate-700">
            <span className="text-xs uppercase tracking-wider text-slate-400">Response time</span>
            <span className="max-w-[10rem] truncate">
              {responseBucket ? RESPONSE_TIME_LABELS[responseBucket] : 'Any'}
            </span>
            <select
              value={responseBucket}
              onChange={e => setResponseBucket(e.target.value as ResponseTimeBucket)}
              aria-label="Filter by response time"
              className="absolute inset-0 opacity-0 cursor-pointer"
            >
              <option value="">Any</option>
              <option value="UNDER_1D">Under 1 day</option>
              <option value="UNDER_2D">1–2 days</option>
              <option value="OVER_2D">Over 2 days</option>
            </select>
          </div>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          {loading ? 'Loading…' : `${total.toLocaleString()} ${tab.toLowerCase()} quer${total === 1 ? 'y' : 'ies'}`}
        </span>
      </div>

      {error && (
        <div className="mx-5 my-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="divide-y divide-slate-100 mt-3">
        {rows.length === 0 && !loading && (
          <p className="px-5 py-12 text-center text-sm text-slate-400">
            {tab === 'OPEN'
              ? 'No open queries matching the current filters.'
              : tab === 'EXPIRED'
                ? 'No expired queries in the current window.'
                : 'No responded queries in the current window.'}
          </p>
        )}
        {rows.map(r => {
          const isOpen = expanded.has(r.id)
          const preview = (r.description || '').slice(0, 100)
          return (
            <div key={r.id} className="px-5 py-3 text-sm">
              <button
                type="button"
                onClick={() => toggleExpand(r.id)}
                className="w-full text-left"
              >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-xs text-slate-400 tabular-nums w-28 shrink-0">
                    {fmtDate(r.created_at)}
                  </span>
                  <span className="font-medium text-slate-800 min-w-[9rem]">
                    {r.farmer_name || '—'}
                  </span>
                  <span className="text-xs text-slate-500">{r.farmer_phone_masked}</span>
                  <span className="text-xs text-slate-500">· {r.crop_name}</span>
                  <span className="text-xs text-slate-500">· {r.district_name}</span>
                  <span className="ml-auto text-xs text-slate-600 inline-flex items-center gap-2">
                    {r.media_count > 0 && (
                      <span className="text-slate-500">📷 {r.media_count}</span>
                    )}
                    {tab === 'OPEN' && (
                      <span>Age {fmtAge(r.created_at)}</span>
                    )}
                    {tab === 'EXPIRED' && (
                      <span className="text-rose-700">Expired</span>
                    )}
                    {tab === 'RESPONDED' && r.response_seconds !== null && (
                      <span>in {fmtAvg(r.response_seconds)}</span>
                    )}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-600 flex flex-wrap items-baseline gap-x-3">
                  <span className="text-slate-800 font-medium">{r.title}</span>
                  {preview && (
                    <span className="truncate max-w-[36rem]">{preview}{(r.description || '').length > 100 ? '…' : ''}</span>
                  )}
                  {r.current_holder_name && (
                    <span className="text-slate-500">With {r.current_holder_name}</span>
                  )}
                </div>
              </button>
              {isOpen && (
                <div className="mt-3 ml-28 pl-4 border-l-2 border-slate-100 text-xs text-slate-700 space-y-2">
                  {r.description && (
                    <div>
                      <p className="uppercase tracking-wider text-[10px] text-slate-400 font-semibold">Full query</p>
                      <p className="whitespace-pre-wrap">{r.description}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                    <span>Submitted: {fmtDate(r.created_at)}</span>
                    <span>Expires: {fmtDate(r.expires_at)}</span>
                    {r.responded_at && <span>Responded: {fmtDate(r.responded_at)}</span>}
                    <span>Status: {r.status}</span>
                    {r.severity && <span>Severity (farmer-reported): {r.severity}</span>}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Full remarks chain and media URLs are included in the CSV export.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-xs text-slate-500 tabular-nums">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:border-slate-400 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </section>
  )
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtAge(iso: string): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const seconds = Math.max(0, (now - then) / 1000)
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)}h`
  return `${Math.round(seconds / 86400)}d`
}

function buildBaseQuery(
  filterValues: FilterValues,
  period: PeriodPreset,
  customFrom: string,
  customTo: string,
): URLSearchParams {
  const q = new URLSearchParams()
  for (const chip of CHIPS) {
    const v = filterValues[chip.urlKey]
    if (v) q.set(chip.apiKey, v)
  }
  const { from, to } = periodDates(period, customFrom, customTo)
  if (from) q.set('period_from', from.toISOString())
  if (to)   q.set('period_to',   to.toISOString())
  return q
}

function QueryCard({ title, caption, children }: {
  title: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{title}</p>
      <div className="mt-3">{children}</div>
      <p className="text-xs text-slate-500 mt-3 leading-relaxed">{caption}</p>
    </div>
  )
}
