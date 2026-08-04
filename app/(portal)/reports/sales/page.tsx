'use client'

// Client Reports — Sales (Phase 2).
//
// Headline metrics (four cards fetched in parallel):
//   1. Locked-Brand Sales                — captured direct business
//   2. Recommended-Brand Honored         — conversion win
//   3. Recommended-Brand Substituted     — leakage signal
//   4. Volume Through Our Shops          — network-scope
//
// Filters:
//   Crop · State · District · Package · Dealer · Period.
//   Dealer is Phase 2's new cross-cutting chip — populated from the
//   client's onboarded-dealer list. Period narrows by
//   PackingList.farmer_received_at (the sale marker).
//
// Filter state lives in local useState; URL is a side-effect via
// window.history.replaceState (Next 15 router pitfall — see
// feedback_next15_url_filter_state_pattern.md).
//
// Cards 2 + 3 additionally surface an "outside our network" caption
// when applicable — recommended items sold by dealers who aren't on
// our onboarded list.
//
// Volume-only (never price); three unit buckets (Litres / Kilograms /
// Numbers), ambiguous units silently excluded. Sale marker inherited
// from Phase 1 (PackingList.farmer_received_at IS NOT NULL).

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { ThreeUnitNumber } from '@/components/reports/three-unit-number'
import { DrillPanel, type MetricConfig } from '@/components/reports/drill-panel'
import { useCascadingFilterOptions, type ChipKey } from '@/components/reports/use-filter-options'

interface SalesVolumeResponse {
  litres: number
  kilograms: number
  numbers: number
  outside_network?: {
    litres: number
    kilograms: number
    numbers: number
  }
}

interface FilterOption {
  id: string
  name: string
}

interface FilterOptionsResponse {
  crops: FilterOption[]
  states: FilterOption[]
  districts: FilterOption[]
  packages: FilterOption[]
  dealers: FilterOption[]
}

interface SalesData {
  locked: SalesVolumeResponse | null
  recommendedHonored: SalesVolumeResponse | null
  recommendedSubstituted: SalesVolumeResponse | null
  open: SalesVolumeResponse | null
  networkTotal: SalesVolumeResponse | null
}

const EMPTY_DATA: SalesData = {
  locked: null,
  recommendedHonored: null,
  recommendedSubstituted: null,
  open: null,
  networkTotal: null,
}

// URL param key ↔ backend query param + user-facing label. Dealer is
// new for Phase 2.
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

// Sales drill metrics — three unit buckets per row rendered as the
// primaryDisplay string. All five metrics support every dimension.
const SALES_DRILL_METRICS: readonly MetricConfig[] = [
  {
    key: 'LOCKED',
    label: 'Locked',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: (r) => salesRow(r),
  },
  {
    key: 'RECOMMENDED_HONORED',
    label: 'Recommended Honored',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: (r) => salesRow(r),
  },
  {
    key: 'RECOMMENDED_SUBSTITUTED',
    label: 'Recommended Substituted',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: (r) => salesRow(r),
  },
  {
    key: 'OPEN',
    label: 'Open',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: (r) => salesRow(r),
  },
  {
    key: 'NETWORK_TOTAL',
    label: 'Through Our Shops',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'DEALER', 'TIME'],
    renderRow: (r) => salesRow(r),
  },
]

// Compose the three-unit display for a drill row. `primary` is the
// sum used for bar scaling only (apples-to-oranges but fine as a
// relative ranking hint); `primaryDisplay` carries the honest
// per-unit breakdown; `caption` is left empty — the display is
// self-sufficient.
function salesRow(r: Record<string, number>) {
  const litres = Number(r.litres) || 0
  const kilograms = Number(r.kilograms) || 0
  const numbers = Number(r.numbers) || 0
  const parts: string[] = []
  if (litres >= 0.01) parts.push(`${litres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L`)
  if (kilograms >= 0.01) parts.push(`${kilograms.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`)
  if (numbers >= 1) parts.push(`${numbers.toLocaleString()} Nos`)
  return {
    primary: litres + kilograms + numbers,
    primaryDisplay: parts.join(' · ') || '—',
    caption: '',
  }
}

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function periodDates(
  preset: PeriodPreset, customFrom: string, customTo: string,
): { from?: Date; to?: Date } {
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

function outsideTotal(v?: SalesVolumeResponse['outside_network']): number {
  if (!v) return 0
  return v.litres + v.kilograms + v.numbers
}

function formatOutside(v: SalesVolumeResponse['outside_network']): string {
  if (!v) return ''
  const parts: string[] = []
  if (v.litres > 0) parts.push(`${v.litres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L`)
  if (v.kilograms > 0) parts.push(`${v.kilograms.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`)
  if (v.numbers > 0) parts.push(`${v.numbers.toLocaleString()} Nos`)
  return parts.join(' · ')
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

  // Cascading filter options — refetched on every filter change so
  // each chip's list narrows to what's intersectable with the OTHER
  // chips. When a currently-selected value is no longer available
  // (e.g., added a State that has no rows for the currently-selected
  // Package), we clear it and toast the user.
  const options = useCascadingFilterOptions({
    clientId,
    filterValues,
    onEvicted: (evicted) => {
      setFilterValues(prev => {
        const next = { ...prev }
        for (const chip of evicted) next[chip] = ''
        return next
      })
      const chipLabels = evicted.map(c => CHIPS.find(x => x.urlKey === c)?.label ?? c).join(', ')
      setToast(`${chipLabels} filter${evicted.length > 1 ? 's' : ''} cleared — no data with the new filters`)
      setTimeout(() => setToast(null), 4000)
    },
  }) as FilterOptionsResponse | null

  // Fetch all four metrics whenever filters or period change.
  useEffect(() => {
    if (!clientId) return
    setLoading(true); setError('')
    const filterParams = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) filterParams.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) filterParams.set('period_from', from.toISOString())
    if (to)   filterParams.set('period_to',   to.toISOString())
    const url = (metric: 'LOCKED' | 'RECOMMENDED_HONORED' | 'RECOMMENDED_SUBSTITUTED' | 'OPEN' | 'NETWORK_TOTAL') => {
      const q = new URLSearchParams(filterParams)
      q.set('metric', metric)
      return `/client/${clientId}/reports/sales?${q.toString()}`
    }
    Promise.all([
      api.get<SalesVolumeResponse>(url('LOCKED')),
      api.get<SalesVolumeResponse>(url('RECOMMENDED_HONORED')),
      api.get<SalesVolumeResponse>(url('RECOMMENDED_SUBSTITUTED')),
      api.get<SalesVolumeResponse>(url('OPEN')),
      api.get<SalesVolumeResponse>(url('NETWORK_TOTAL')),
    ])
      .then(([lockedRes, honoredRes, substitutedRes, openRes, networkRes]) => {
        setData({
          locked: lockedRes.data,
          recommendedHonored: honoredRes.data,
          recommendedSubstituted: substitutedRes.data,
          open: openRes.data,
          networkTotal: networkRes.data,
        })
      })
      .catch(err => setError(extractErrorMessage(err, 'Could not load Sales data.')))
      .finally(() => setLoading(false))
  }, [clientId, filterValues, period, customFrom, customTo])

  // Sync URL bar to filter + period state.
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
          Volumes sold through your onboarded dealers, by SE authoring intent.
          Confirmed once the farmer receives the goods.
        </p>
      </div>

      {/* Filter chip row */}
      <div className="flex flex-wrap gap-2 items-center">
        {CHIPS.map(chip => {
          const opts = options?.[chip.optionsKey] ?? []
          const value = filterValues[chip.urlKey]
          const isSet = !!value
          const selectedLabel = isSet
            ? (options
                ? (opts.find(o => o.id === value)?.name ?? value)
                : '…')
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
              <span className="max-w-[10rem] truncate">
                {selectedLabel}
              </span>
              <select
                value={value}
                onChange={(e) => updateFilter(chip.urlKey, e.target.value)}
                aria-label={`Filter by ${chip.label}`}
                className={`absolute top-0 bottom-0 left-0 opacity-0 cursor-pointer ${
                  isSet ? 'right-8' : 'right-0'
                }`}
              >
                <option value="">{chip.allLabel}</option>
                {opts.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              {isSet && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    updateFilter(chip.urlKey, '')
                  }}
                  className="relative z-10 text-white/70 hover:text-white leading-none px-1"
                  aria-label={`Clear ${chip.label} filter`}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        {/* Period chip — always set (no ×). */}
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
            {PERIOD_PRESETS.map(p => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>
        {anyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2 ml-1"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Custom date range — visible only when Custom preset is picked. */}
      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center text-sm text-slate-600">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1"
            />
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

      {/* Row 1 — Brand scope: four cards. 4-col on lg, 2x2 on md, stacked on mobile. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SalesCard
          title="Locked-Brand Sales"
          caption="Items your SE locked to your brand — dealer had to sell exactly that. By design, always through your onboarded network."
          data={data.locked}
          loading={loading}
          brandColour={brandColour}
        />
        <SalesCard
          title="Recommended-Brand Honored"
          caption="SE recommended your brand, dealer sold that same brand. The conversion win."
          data={data.recommendedHonored}
          loading={loading}
          brandColour={brandColour}
          outsideCaption={data.recommendedHonored?.outside_network && outsideTotal(data.recommendedHonored.outside_network) > 0
            ? `+ ${formatOutside(data.recommendedHonored.outside_network)} sold outside your network`
            : null}
        />
        <SalesCard
          title="Recommended-Brand Substituted"
          caption="SE recommended your brand, dealer sold a different brand. Leakage — where your recommendation isn't landing."
          data={data.recommendedSubstituted}
          loading={loading}
          brandColour="#B45309"
        />
        <SalesCard
          title="Open-Category Sales"
          caption="Items your SE authored with no specific brand — dealer picked freely. This is your captured volume from dealer-choice items in your Packages."
          data={data.open}
          loading={loading}
          brandColour={brandColour}
        />
      </div>

      {/* Row 2 — Network scope: full-width card */}
      <div>
        <SalesCard
          title="Volume Through Our Shops"
          caption="Everything sold by your onboarded dealers — any brand, any authoring intent."
          data={data.networkTotal}
          loading={loading}
          brandColour={brandColour}
          fullWidth
        />
      </div>

      {/* Drill panel — metric picker + dimension tabs (Crop / State /
          Package / Dealer / Time). Reuses the shared component; a
          Sales-specific renderRow packs the three unit buckets into
          primaryDisplay. */}
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
    </div>
  )
}

// Build the base URLSearchParams for the DrillPanel — same filter
// chips + period translation as the headline fetches, minus the
// metric/dimension params (the panel appends those).
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
  data: SalesVolumeResponse | null
  loading: boolean
  brandColour: string
  outsideCaption?: string | null
  fullWidth?: boolean
}

function SalesCard({ title, caption, data, loading, brandColour, outsideCaption, fullWidth }: SalesCardProps) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm p-5 ${fullWidth ? 'w-full' : ''}`}>
      <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </p>
      <div className="mt-3">
        {loading || !data ? (
          <div className="h-8 w-32 bg-slate-100 rounded animate-pulse" />
        ) : (
          <ThreeUnitNumber
            litres={data.litres}
            kilograms={data.kilograms}
            numbers={data.numbers}
            colour={brandColour}
          />
        )}
      </div>
      {outsideCaption && (
        <p className="text-xs text-slate-500 mt-2 italic">
          {outsideCaption}
        </p>
      )}
      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
        {caption}
      </p>
    </div>
  )
}
