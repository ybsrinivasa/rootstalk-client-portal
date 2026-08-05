'use client'

// Client Reports — Queries (Phase 4, 2026-08-05).
//
// Two parts on one page:
//
//   Queries area (top)
//     Six headline cards:
//       1. Total Queries
//       2. Responded (with %)
//       3. Avg Response Time
//       4. % Responded ≤ 24h
//       5. Expired
//       6. Severity split (Severe / Moderate / Low as one segmented card)
//     Hero trend + top-space + top-crop for the currently-toggled metric.
//     Drill panel for the four countable metrics × 3 dims.
//
//   Pundit Scorecard (below)
//     Per-pundit row: receptions (direct + forwarded_in), responded,
//     forwarded_out, returned, expired, avg response time.
//     Pooled totals footer. NO trend for pundits (per user).
//
// Filters (cascading): Crop · State · District · Severity · Pundit · Period.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { PunditScorecard, type PunditScoreRow } from '@/components/reports/pundit-scorecard'
import { DrillPanel, type MetricConfig } from '@/components/reports/drill-panel'
import { useCascadingFilterOptions } from '@/components/reports/use-filter-options'
import { PromoterTrendChart, PromoterTopBar } from '@/components/reports/promoter-hero-charts'

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

const CHIPS = [
  { urlKey: 'crop',     apiKey: 'crop_cosh_id',     optionsKey: 'crops' as const,     label: 'Crop',     allLabel: 'All crops' },
  { urlKey: 'state',    apiKey: 'state_cosh_id',    optionsKey: 'states' as const,    label: 'State',    allLabel: 'All states' },
  { urlKey: 'district', apiKey: 'district_cosh_id', optionsKey: 'districts' as const, label: 'District', allLabel: 'All districts' },
  { urlKey: 'severity', apiKey: 'severity',         optionsKey: 'severities' as const, label: 'Severity', allLabel: 'All severities' },
  { urlKey: 'pundit',   apiKey: 'pundit_id',        optionsKey: 'pundits' as const,   label: 'Pundit',   allLabel: 'All pundits' },
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
  crop: '', state: '', district: '', severity: '', pundit: '',
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
    severity: searchParams.get('severity') || '',
    pundit:   searchParams.get('pundit')   || '',
  }))
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

  const fetchGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++fetchGen.current
    setLoading(true); setError('')
    const filterParams = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) filterParams.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) filterParams.set('period_from', from.toISOString())
    if (to)   filterParams.set('period_to',   to.toISOString())
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
  }, [clientId, filterValues, period, customFrom, customTo])

  const scorecardGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++scorecardGen.current
    setScorecardLoading(true)
    const filterParams = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) filterParams.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) filterParams.set('period_from', from.toISOString())
    if (to)   filterParams.set('period_to',   to.toISOString())
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
  }, [clientId, filterValues, period, customFrom, customTo])

  const heroGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++heroGen.current
    setHeroLoading(true)
    const base = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) base.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) base.set('period_from', from.toISOString())
    if (to)   base.set('period_to',   to.toISOString())
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
  }, [clientId, filterValues, period, customFrom, customTo, heroMetric])

  useEffect(() => {
    const params = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) params.set(chip.urlKey, v)
    }
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
  }, [pathname, filterValues, period, customFrom, customTo])

  const updateFilter = useCallback((urlKey: keyof FilterValues, value: string) => {
    setFilterValues(prev => ({ ...prev, [urlKey]: value }))
  }, [])

  const clearAll = useCallback(() => {
    setFilterValues(EMPTY_FILTERS)
    setPeriod('this-month')
    setCustomFrom('')
    setCustomTo('')
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

  const anyFilter = CHIPS.some(c => filterValues[c.urlKey]) || period !== 'this-month'

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
        <QueryCard title="Expired" caption="Queries that hit their expiry without a response.">
          <div>
            <p className="text-4xl font-bold tabular-nums" style={{ color: expiredQ > 0 ? '#B91C1C' : brandColour }}>
              {loading ? '…' : expiredQ.toLocaleString()}
            </p>
            {!loading && totalQ > 0 && (
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {pct(expiredQ, totalQ)}% of total
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
