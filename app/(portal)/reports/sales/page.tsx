'use client'

// Client Reports — Sales (Phase 2, leads/conversion reframing 2026-08-04).
//
// Headline metrics (leads/conversion, not volumes):
//   1. Locked-Brand Conversion       — leads → converted, by enforcement ~100%
//   2. Recommended-Brand Conversion  — honor rate + honored/substituted/pending split
//   3. Open-Category Conversion      — leads → converted, dealer picked freely
//   4. All Leads Through Our Network — everything across our onboarded dealers
//
// Below that:
//   - Dealer Scorecard — per-dealer leads/converted + pooled totals
//   - Three pivot matrices (Locked, Recommended, Open) — carry volumes
//     (three unit families) AND a leads/converted column per row.
//   - Drill panel — leads/conversion per dimension for each of the 5 metrics.
//
// Filters (all cascading): Crop · State · District · Package · Dealer · Period.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { LeadsDisplay, LeadsRecommendedDisplay } from '@/components/reports/leads-display'
import { DealerScorecard, type DealerScoreRow } from '@/components/reports/dealer-scorecard'
import { MatrixPanel, type MatrixRow } from '@/components/reports/matrix-panel'
import { DrillPanel, type MetricConfig } from '@/components/reports/drill-panel'
import { useCascadingFilterOptions, type ChipKey } from '@/components/reports/use-filter-options'

// Backend leads shapes.
interface LeadsSimple { leads: number; converted: number }
interface LeadsRecommended { leads: number; honored: number; substituted: number; pending: number }

interface FilterOption { id: string; name: string }
interface FilterOptionsResponse {
  crops: FilterOption[]
  states: FilterOption[]
  districts: FilterOption[]
  packages: FilterOption[]
  dealers?: FilterOption[]
}

interface SalesData {
  locked: LeadsSimple | null
  recommended: LeadsRecommended | null
  open: LeadsSimple | null
  networkTotal: LeadsSimple | null
}

const EMPTY_DATA: SalesData = {
  locked: null,
  recommended: null,
  open: null,
  networkTotal: null,
}

const CHIPS = [
  { urlKey: 'crop',     apiKey: 'crop_cosh_id',     optionsKey: 'crops' as const,     label: 'Crop',     allLabel: 'All crops' },
  { urlKey: 'state',    apiKey: 'state_cosh_id',    optionsKey: 'states' as const,    label: 'State',    allLabel: 'All states' },
  { urlKey: 'district', apiKey: 'district_cosh_id', optionsKey: 'districts' as const, label: 'District', allLabel: 'All districts' },
  { urlKey: 'package',  apiKey: 'package_id',       optionsKey: 'packages' as const,  label: 'Package',  allLabel: 'All packages' },
  { urlKey: 'dealer',   apiKey: 'dealer_user_id',   optionsKey: 'dealers' as const,   label: 'Dealer',   allLabel: 'All dealers' },
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

const EMPTY_FILTERS: FilterValues = { crop: '', state: '', district: '', package: '', dealer: '' }

// Backend row shape for the pivot matrices, extended with leads/converted.
interface RawMatrixGiven {
  sold_brand_cosh_id: string | null
  sold_brand_name: string | null
  match?: boolean
  litres: number
  kilograms: number
  numbers: number
}
interface RawMatrixRow {
  our_brand_cosh_id?: string
  our_brand_name?: string
  common_name_key?: string
  common_name_label?: string
  category?: string
  totals: { litres: number; kilograms: number; numbers: number }
  leads?: number
  converted?: number
  given: RawMatrixGiven[]
}

function shapeBrandRows(rows: RawMatrixRow[]): MatrixRow[] {
  return rows.map(r => ({
    label: r.our_brand_name ?? r.our_brand_cosh_id ?? '—',
    category: r.category,
    totals: r.totals,
    leads: r.leads,
    converted: r.converted,
    given: r.given.map(g => ({
      label: g.sold_brand_name,
      match: g.match,
      litres: g.litres,
      kilograms: g.kilograms,
      numbers: g.numbers,
    })),
  }))
}

function shapeOpenRows(rows: RawMatrixRow[]): MatrixRow[] {
  return rows.map(r => ({
    label: r.common_name_label ?? r.common_name_key ?? '—',
    category: r.category,
    totals: r.totals,
    leads: r.leads,
    converted: r.converted,
    given: r.given.map(g => ({
      label: g.sold_brand_name,
      litres: g.litres,
      kilograms: g.kilograms,
      numbers: g.numbers,
    })),
  }))
}

// Drill panel metric configs — leads/conversion shape.
function pct(a: number, b: number): number {
  if (b <= 0) return 0
  return Math.round((a / b) * 100)
}

function leadsRow(r: Record<string, number>) {
  const leads = Number(r.leads) || 0
  const converted = Number(r.converted) || 0
  const p = pct(converted, leads)
  return {
    primary: p,
    primaryDisplay: leads === 0 ? '—' : `${p}%`,
    caption: leads === 0 ? '' : `${converted.toLocaleString()} / ${leads.toLocaleString()} leads`,
  }
}

function recommendedDrillRow(r: Record<string, number>) {
  const leads = Number(r.leads) || 0
  const honored = Number(r.honored) || 0
  const substituted = Number(r.substituted) || 0
  const honorRate = pct(honored, leads)
  return {
    primary: honorRate,
    primaryDisplay: leads === 0 ? '—' : `${honorRate}%`,
    caption: leads === 0 ? '' : `${honored.toLocaleString()} honored · ${substituted.toLocaleString()} sub`,
  }
}

const SALES_DRILL_METRICS: readonly MetricConfig[] = [
  {
    key: 'LOCKED', label: 'Locked',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: leadsRow,
  },
  {
    key: 'RECOMMENDED', label: 'Recommended',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: recommendedDrillRow,
  },
  {
    key: 'OPEN', label: 'Open',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: leadsRow,
  },
  {
    key: 'NETWORK_TOTAL', label: 'Through Our Shops',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: leadsRow,
  },
]

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

export default function SalesReportPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <SalesReportInner />
    </Suspense>
  )
}

function SalesReportInner() {
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
    dealer:   searchParams.get('dealer')   || '',
  }))
  const [period, setPeriod] = useState<PeriodPreset>(() => {
    const p = searchParams.get('period') as PeriodPreset | null
    return p && PERIOD_PRESETS.some(x => x.key === p) ? p : 'this-month'
  })
  const [customFrom, setCustomFrom] = useState<string>(() => searchParams.get('from') || '')
  const [customTo,   setCustomTo]   = useState<string>(() => searchParams.get('to')   || '')

  const [data, setData] = useState<SalesData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const [scorecard, setScorecard] = useState<DealerScoreRow[]>([])
  const [scorecardPooled, setScorecardPooled] = useState<DealerScoreRow | null>(null)
  const [scorecardLoading, setScorecardLoading] = useState(true)

  const [lockedMatrix, setLockedMatrix] = useState<MatrixRow[]>([])
  const [recommendedMatrix, setRecommendedMatrix] = useState<MatrixRow[]>([])
  const [openMatrix, setOpenMatrix] = useState<MatrixRow[]>([])
  const [matrixLoading, setMatrixLoading] = useState(true)

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
    const url = (metric: 'LOCKED' | 'RECOMMENDED' | 'OPEN' | 'NETWORK_TOTAL') => {
      const q = new URLSearchParams(filterParams)
      q.set('metric', metric)
      return `/client/${clientId}/reports/sales?${q.toString()}`
    }
    Promise.all([
      api.get<LeadsSimple>(url('LOCKED')),
      api.get<LeadsRecommended>(url('RECOMMENDED')),
      api.get<LeadsSimple>(url('OPEN')),
      api.get<LeadsSimple>(url('NETWORK_TOTAL')),
    ])
      .then(([lockedRes, recRes, openRes, networkRes]) => {
        if (fetchGen.current !== myGen) return
        setData({
          locked: lockedRes.data,
          recommended: recRes.data,
          open: openRes.data,
          networkTotal: networkRes.data,
        })
        setError('')
      })
      .catch(err => {
        if (fetchGen.current !== myGen) return
        setError(extractErrorMessage(err, 'Could not load Sales data.'))
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
      .get<{ rows: DealerScoreRow[]; pooled: DealerScoreRow }>(
        `/client/${clientId}/reports/sales/dealer-scorecard?${filterParams.toString()}`,
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

  const matrixGen = useRef(0)
  useEffect(() => {
    if (!clientId) return
    const myGen = ++matrixGen.current
    setMatrixLoading(true)
    const filterParams = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) filterParams.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) filterParams.set('period_from', from.toISOString())
    if (to)   filterParams.set('period_to',   to.toISOString())
    const url = (endpoint: 'locked-matrix' | 'recommended-matrix' | 'open-matrix') =>
      `/client/${clientId}/reports/sales/${endpoint}?${filterParams.toString()}`
    Promise.all([
      api.get<{ rows: RawMatrixRow[] }>(url('locked-matrix')),
      api.get<{ rows: RawMatrixRow[] }>(url('recommended-matrix')),
      api.get<{ rows: RawMatrixRow[] }>(url('open-matrix')),
    ])
      .then(([lockedRes, recRes, openRes]) => {
        if (matrixGen.current !== myGen) return
        setLockedMatrix(shapeBrandRows(lockedRes.data.rows))
        setRecommendedMatrix(shapeBrandRows(recRes.data.rows))
        setOpenMatrix(shapeOpenRows(openRes.data.rows))
      })
      .catch(() => { /* silent */ })
      .finally(() => {
        if (matrixGen.current !== myGen) return
        setMatrixLoading(false)
      })
  }, [clientId, filterValues, period, customFrom, customTo])

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

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <ReportSubjectTabs />

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sales</h1>
        <p className="text-sm text-slate-500 mt-1">
          Leads received by your onboarded dealers vs sales converted, by SE authoring intent.
          Volumes live in the pivot matrices below.
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

      {/* Row 1 — Brand scope: three cards, leads/conversion. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SalesCard
          title="Locked-Brand Conversion"
          caption="Items your SE locked to your brand — dealer had to sell exactly that. By design, conversion should be near 100%."
        >
          <LeadsDisplay
            leads={data.locked?.leads ?? 0}
            converted={data.locked?.converted ?? 0}
            loading={loading}
          />
        </SalesCard>
        <SalesCard
          title="Recommended-Brand Conversion"
          caption="SE recommended your brand. Big number = honor rate (% of leads where dealer sold your brand). Substituted = dealer sold a competitor."
        >
          <LeadsRecommendedDisplay
            leads={data.recommended?.leads ?? 0}
            honored={data.recommended?.honored ?? 0}
            substituted={data.recommended?.substituted ?? 0}
            pending={data.recommended?.pending ?? 0}
            loading={loading}
          />
        </SalesCard>
        <SalesCard
          title="Open-Category Conversion"
          caption="Items your SE authored in your Packages without a specific brand. Dealer picked freely."
        >
          <LeadsDisplay
            leads={data.open?.leads ?? 0}
            converted={data.open?.converted ?? 0}
            loading={loading}
          />
        </SalesCard>
      </div>

      {/* Row 2 — Network total */}
      <SalesCard
        title="All Leads Through Our Network"
        caption="Every lead your onboarded dealers received — any brand, any authoring intent — and how many landed as sales."
        fullWidth
      >
        <LeadsDisplay
          leads={data.networkTotal?.leads ?? 0}
          converted={data.networkTotal?.converted ?? 0}
          loading={loading}
        />
      </SalesCard>

      {/* Dealer scorecard */}
      <DealerScorecard
        rows={scorecard}
        pooled={scorecardPooled}
        loading={scorecardLoading}
        brandColour={brandColour}
      />

      {/* Drill panel — leads/conversion per dimension */}
      {clientId && (
        <DrillPanel
          clientId={clientId}
          endpoint={`/client/${clientId}/reports/sales`}
          baseQuery={buildBaseQuery(filterValues, period, customFrom, customTo)}
          metrics={SALES_DRILL_METRICS}
          accent={brandColour}
          heading="Sales broken down by"
        />
      )}

      {/* Matrices — volumes stay here (three units) plus leads/converted per row. */}
      <MatrixPanel
        title="Locked-Brand Matrix"
        caption="For each brand your SE locked, volumes sold + leads converted. By enforcement, every row should be fully honored (✓)."
        rows={lockedMatrix}
        loading={matrixLoading}
        brandColour={brandColour}
        collapseWhenAllHonored
      />
      <MatrixPanel
        title="Recommended vs Given"
        caption="For each brand your SE recommended, what dealers actually sold. Row header carries leads/converted; sub-rows show volume share of conversions."
        rows={recommendedMatrix}
        loading={matrixLoading}
        brandColour={brandColour}
      />
      <MatrixPanel
        title="Common Name → Brand Sold"
        caption="For each common name your SE authored in Open items, which brands dealers organically picked. Row header carries leads/converted."
        rows={openMatrix}
        loading={matrixLoading}
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

interface SalesCardProps {
  title: string
  caption: string
  fullWidth?: boolean
  children: React.ReactNode
}

function SalesCard({ title, caption, fullWidth, children }: SalesCardProps) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm p-5 ${fullWidth ? 'w-full' : ''}`}>
      <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </p>
      <div className="mt-3">{children}</div>
      <p className="text-xs text-slate-500 mt-3 leading-relaxed">{caption}</p>
    </div>
  )
}
