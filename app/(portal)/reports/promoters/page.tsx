'use client'

// Client Reports — Promoters (Phase 3, 2026-08-05).
//
// Facilitators and dealers can be onboarded by a client as Promoters —
// their job is to push the client's advisories (Packages of Practices).
// This report answers "how are my promoters doing" in four headlines,
// three hero charts, and a per-promoter scorecard.
//
// Headline metrics:
//   1. Active Promoters       — distinct promoters with ≥1 sub in period
//   2. Subscriptions Promoted — total subs attributed to a promoter
//   3. Acres Promoted         — sum of farm_area_acres for those subs
//   4. Leads to Dealers       — order leads from those subs (same lead
//                               definition as Sales)
//
// Filters (cascading): Crop · State · District · Package · Promoter · Period.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { PromoterScorecard, type PromoterScoreRow } from '@/components/reports/promoter-scorecard'
import { DrillPanel, type MetricConfig } from '@/components/reports/drill-panel'
import { useCascadingFilterOptions } from '@/components/reports/use-filter-options'
import { PromoterTrendChart, PromoterTopBar } from '@/components/reports/promoter-hero-charts'

interface FilterOption { id: string; name: string }
interface FilterOptionsResponse {
  crops: FilterOption[]
  states: FilterOption[]
  districts: FilterOption[]
  packages: FilterOption[]
  promoters?: FilterOption[]
}

interface PromotersData {
  active: { count: number } | null
  subscriptions: { count: number } | null
  acres: { acres: number } | null
  leads: { leads: number } | null
}

const EMPTY_DATA: PromotersData = {
  active: null,
  subscriptions: null,
  acres: null,
  leads: null,
}

const CHIPS = [
  { urlKey: 'crop',     apiKey: 'crop_cosh_id',     optionsKey: 'crops' as const,     label: 'Crop',     allLabel: 'All crops' },
  { urlKey: 'state',    apiKey: 'state_cosh_id',    optionsKey: 'states' as const,    label: 'State',    allLabel: 'All states' },
  { urlKey: 'district', apiKey: 'district_cosh_id', optionsKey: 'districts' as const, label: 'District', allLabel: 'All districts' },
  { urlKey: 'package',  apiKey: 'package_id',       optionsKey: 'packages' as const,  label: 'Package',  allLabel: 'All packages' },
  { urlKey: 'promoter', apiKey: 'promoter_user_id', optionsKey: 'promoters' as const, label: 'Promoter', allLabel: 'All promoters' },
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
  crop: '', state: '', district: '', package: '', promoter: '',
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

// Mirror of backend _pick_time_bucket — keep in sync.
function pickBucket(preset: PeriodPreset, customFrom: string, customTo: string): 'day' | 'week' | 'month' {
  const { from, to } = periodDates(preset, customFrom, customTo)
  if (!from || !to) return 'month'
  const days = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000))
  if (days <= 14) return 'day'
  if (days <= 120) return 'week'
  return 'month'
}

// Drill row renderers — three shapes: count, acres (decimal), leads (int).
function countRow(r: Record<string, number>) {
  const v = Number(r.value) || 0
  return {
    primary: v,
    primaryDisplay: v.toLocaleString(),
    caption: '',
  }
}

function acresRow(r: Record<string, number>) {
  const v = Number(r.value) || 0
  const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  return {
    primary: v,
    primaryDisplay: `${rounded.toLocaleString()} acres`,
    caption: '',
  }
}

const PROMOTERS_DRILL_METRICS: readonly MetricConfig[] = [
  {
    key: 'ACTIVE', label: 'Active Promoters',
    dimensions: ['CROP', 'SPACE', 'TIME'],
    renderRow: countRow,
  },
  {
    key: 'SUBSCRIPTIONS', label: 'Subscriptions',
    dimensions: ['CROP', 'SPACE', 'TIME'],
    renderRow: countRow,
  },
  {
    key: 'ACRES', label: 'Acres',
    dimensions: ['CROP', 'SPACE', 'TIME'],
    renderRow: acresRow,
  },
  {
    key: 'LEADS', label: 'Leads to Dealers',
    dimensions: ['CROP', 'SPACE', 'TIME'],
    renderRow: countRow,
  },
]

// Colour helper — brand for accents.
export default function PromotersReportPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <PromotersReportInner />
    </Suspense>
  )
}

function PromotersReportInner() {
  const client = getClient()
  const clientId = client?.id
  const brandColour = client?.primary_colour || '#0F172A'

  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filterValues, setFilterValues] = useState<FilterValues>(() => ({
    crop:     searchParams.get('crop')     || '',
    state:    searchParams.get('state')    || '',
    district: searchParams.get('district') || '',
    package:  searchParams.get('package')  || '',
    promoter: searchParams.get('promoter') || '',
  }))
  const [period, setPeriod] = useState<PeriodPreset>(() => {
    const p = searchParams.get('period') as PeriodPreset | null
    return p && PERIOD_PRESETS.some(x => x.key === p) ? p : 'this-month'
  })
  const [customFrom, setCustomFrom] = useState<string>(() => searchParams.get('from') || '')
  const [customTo,   setCustomTo]   = useState<string>(() => searchParams.get('to')   || '')

  const [data, setData] = useState<PromotersData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const [scorecard, setScorecard] = useState<PromoterScoreRow[]>([])
  const [scorecardPooled, setScorecardPooled] = useState<PromoterScoreRow | null>(null)
  const [scorecardLoading, setScorecardLoading] = useState(true)

  // Hero charts — one-metric toggle across all four metrics.
  const [heroMetric, setHeroMetric] = useState<'ACTIVE' | 'SUBSCRIPTIONS' | 'ACRES' | 'LEADS'>('SUBSCRIPTIONS')
  const [heroTime, setHeroTime] = useState<{ key: string; value: number }[]>([])
  const [heroSpace, setHeroSpace] = useState<{ key: string; label?: string; value: number }[]>([])
  const [heroCrop, setHeroCrop] = useState<{ key: string; label?: string; value: number }[]>([])
  const [heroLoading, setHeroLoading] = useState(true)

  const options = useCascadingFilterOptions({
    clientId,
    filterValues,
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
    const url = (metric: 'ACTIVE' | 'SUBSCRIPTIONS' | 'ACRES' | 'LEADS') => {
      const q = new URLSearchParams(filterParams)
      q.set('metric', metric)
      return `/client/${clientId}/reports/promoters?${q.toString()}`
    }
    Promise.all([
      api.get<{ count: number }>(url('ACTIVE')),
      api.get<{ count: number }>(url('SUBSCRIPTIONS')),
      api.get<{ acres: number }>(url('ACRES')),
      api.get<{ leads: number }>(url('LEADS')),
    ])
      .then(([activeRes, subsRes, acresRes, leadsRes]) => {
        if (fetchGen.current !== myGen) return
        setData({
          active: activeRes.data,
          subscriptions: subsRes.data,
          acres: acresRes.data,
          leads: leadsRes.data,
        })
        setError('')
      })
      .catch(err => {
        if (fetchGen.current !== myGen) return
        setError(extractErrorMessage(err, 'Could not load Promoters data.'))
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
      .get<{ rows: PromoterScoreRow[]; pooled: PromoterScoreRow | null }>(
        `/client/${clientId}/reports/promoters/scorecard?${filterParams.toString()}`,
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

  // Hero charts fetch — three by-dimension endpoints in parallel per
  // selected hero metric. Reuses the same SalesTrendChart/SalesTopBar
  // components; we adapt the {value} shape to {leads, converted} by
  // treating value as leads and 0 as converted for the trend chart
  // (so it renders a solid bar without the conversion overlay).
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
      return `/client/${clientId}/reports/promoters?${q.toString()}`
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

  const heroMetricLabel = (
    heroMetric === 'ACTIVE' ? 'Active Promoters' :
    heroMetric === 'SUBSCRIPTIONS' ? 'Subscriptions' :
    heroMetric === 'ACRES' ? 'Acres' :
    'Leads'
  )
  const heroIsAcres = heroMetric === 'ACRES'
  const heroUnit = heroIsAcres ? 'acres' : ''

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <ReportSubjectTabs />

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Promoters</h1>
        <p className="text-sm text-slate-500 mt-1">
          Advisories promoted by facilitators and dealers you've onboarded as Promoters — subscriptions, acres, and leads generated to your dealers.
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

      {/* Row 1 — Four headline cards, pooled totals. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeadlineCard
          title="Active Promoters"
          value={data.active?.count ?? 0}
          format="int"
          caption="Distinct promoters who onboarded at least one farmer subscription in the current window."
          loading={loading}
          accent={brandColour}
        />
        <HeadlineCard
          title="Subscriptions Promoted"
          value={data.subscriptions?.count ?? 0}
          format="int"
          caption="Total farmer subscriptions your promoters drove."
          loading={loading}
          accent={brandColour}
        />
        <HeadlineCard
          title="Acres Promoted"
          value={data.acres?.acres ?? 0}
          format="acres"
          caption="Sum of farm area (in acres) across the promoted subscriptions."
          loading={loading}
          accent={brandColour}
        />
        <HeadlineCard
          title="Leads to Dealers"
          value={data.leads?.leads ?? 0}
          format="int"
          caption="Order-item leads generated to your dealers on those promoter-driven subscriptions."
          loading={loading}
          accent={brandColour}
        />
      </div>

      {/* Metric toggle for hero charts */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-slate-500 font-medium">Trends for:</span>
        {(['ACTIVE', 'SUBSCRIPTIONS', 'ACRES', 'LEADS'] as const).map(m => {
          const active = heroMetric === m
          const label = (
            m === 'ACTIVE' ? 'Active' :
            m === 'SUBSCRIPTIONS' ? 'Subscriptions' :
            m === 'ACRES' ? 'Acres' :
            'Leads'
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
        title={`${heroMetricLabel} over time`}
        isAcres={heroIsAcres}
        unitLabel={heroUnit}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PromoterTopBar
          title={`Top states — ${heroMetricLabel}`}
          data={heroSpace}
          accent={brandColour}
          loading={heroLoading}
          emptyText="No location data in the current window."
          isAcres={heroIsAcres}
        />
        <PromoterTopBar
          title={`Top crops — ${heroMetricLabel}`}
          data={heroCrop}
          accent={brandColour}
          loading={heroLoading}
          emptyText="No crop data in the current window."
          isAcres={heroIsAcres}
        />
      </div>

      {/* Promoter Scorecard */}
      <PromoterScorecard
        rows={scorecard}
        pooled={scorecardPooled}
        loading={scorecardLoading}
        brandColour={brandColour}
      />

      {/* Drill panel — per-dimension breakdown for any of the 4 metrics. */}
      {clientId && (
        <DrillPanel
          clientId={clientId}
          endpoint={`/client/${clientId}/reports/promoters`}
          baseQuery={buildBaseQuery(filterValues, period, customFrom, customTo)}
          metrics={PROMOTERS_DRILL_METRICS}
          accent={brandColour}
          heading="Promoter activity broken down by"
        />
      )}
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

interface HeadlineCardProps {
  title: string
  value: number
  format: 'int' | 'acres'
  caption: string
  loading: boolean
  accent: string
}

function HeadlineCard({ title, value, format, caption, loading, accent }: HeadlineCardProps) {
  const display = loading
    ? '…'
    : format === 'acres'
      ? (() => {
          const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
          return `${rounded.toLocaleString()} ac`
        })()
      : Math.round(value).toLocaleString()
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </p>
      <p
        className="mt-3 text-4xl font-bold tabular-nums"
        style={{ color: accent }}
      >
        {display}
      </p>
      <p className="text-xs text-slate-500 mt-3 leading-relaxed">{caption}</p>
    </div>
  )
}
