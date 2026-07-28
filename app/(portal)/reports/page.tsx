'use client'

// Client Reports — Overview landing page (Phase 1).
//
// Four headline cards over one round-trip (backend overview_bundle).
// Each card is clickable — takes the user to the drill page with
// the current filter chip state carried in the URL so the drill
// picks up where Overview left off.
//
// Deferred to Phase 1 polish:
//   - Prev-period deltas ("(+23%)") — needs a second backend call.
//   - Hero charts under each card — needs the *_by_dimension queries.

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'

interface CurrentBlock {
  subs_new:          { relationships: number; farmers: number }
  subs_active:       { subscriptions: number; farmers: number }
  orders_count:      { orders: number; farmers: number }
  orders_conversion: { ordered: number; approved: number; picked_up: number }
}

interface PrevBlock {
  subs_new:          { relationships: number; farmers: number }
  orders_count:      { orders: number; farmers: number }
  orders_conversion: { ordered: number; approved: number; picked_up: number }
}

interface OverviewResponse {
  current: CurrentBlock
  prev: PrevBlock | null
}

interface FilterOption { id: string; name: string }
interface FilterOptionsResponse {
  crops: FilterOption[]
  states: FilterOption[]
  districts: FilterOption[]
  packages: FilterOption[]
}

const CHIPS = [
  { urlKey: 'crop',     apiKey: 'crop_cosh_id',     optionsKey: 'crops' as const,     label: 'Crop',     allLabel: 'All crops' },
  { urlKey: 'state',    apiKey: 'state_cosh_id',    optionsKey: 'states' as const,    label: 'State',    allLabel: 'All states' },
  { urlKey: 'district', apiKey: 'district_cosh_id', optionsKey: 'districts' as const, label: 'District', allLabel: 'All districts' },
  { urlKey: 'package',  apiKey: 'package_id',       optionsKey: 'packages' as const,  label: 'Package',  allLabel: 'All packages' },
] as const

const PERIOD_PRESETS = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-90d',   label: 'Last 90 days' },
  { key: 'all',        label: 'All time' },
  { key: 'custom',     label: 'Custom range' },
] as const
type PeriodPreset = typeof PERIOD_PRESETS[number]['key']

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

// Prev-period window for the delta badges. Mirrors the current
// preset's window shifted one unit back:
//   this-month → last-month
//   last-month → month before that
//   last-90d   → 90d before (i.e. 180d-ago → 90d-ago)
//   custom     → same-length window immediately preceding
//   all        → no prev (delta undefined)
function prevPeriodDates(
  preset: PeriodPreset, customFrom: string, customTo: string,
): { from?: Date; to?: Date } {
  const now = new Date()
  if (preset === 'this-month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to:   new Date(now.getFullYear(), now.getMonth(), 1),
    }
  }
  if (preset === 'last-month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 2, 1),
      to:   new Date(now.getFullYear(), now.getMonth() - 1, 1),
    }
  }
  if (preset === 'last-90d') {
    const to = new Date(); to.setDate(to.getDate() - 90); to.setHours(0, 0, 0, 0)
    const from = new Date(to); from.setDate(from.getDate() - 90)
    return { from, to }
  }
  if (preset === 'custom') {
    if (!customFrom || !customTo) return {}
    const cur = periodDates('custom', customFrom, customTo)
    if (!cur.from || !cur.to) return {}
    const days = Math.round((cur.to.getTime() - cur.from.getTime()) / 86400000)
    const to = new Date(cur.from)
    const from = new Date(cur.from); from.setDate(from.getDate() - days)
    return { from, to }
  }
  return {}  // 'all' — no prev
}

type FilterValues = Record<typeof CHIPS[number]['urlKey'], string>
const EMPTY_FILTERS: FilterValues = { crop: '', state: '', district: '', package: '' }

// Serialize the current filter + period state into a URL query
// string so we can carry it to a drill page on card click. Matches
// the shape each drill page reads on mount.
function buildDrillQuery(
  filters: FilterValues, period: PeriodPreset,
  customFrom: string, customTo: string,
): string {
  const params = new URLSearchParams()
  for (const chip of CHIPS) {
    const v = filters[chip.urlKey]
    if (v) params.set(chip.urlKey, v)
  }
  if (period !== 'this-month') params.set('period', period)
  if (period === 'custom') {
    if (customFrom) params.set('from', customFrom)
    if (customTo)   params.set('to',   customTo)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

// Delta = (current - prev) / prev × 100. When prev is 0 (or the
// prev block is missing entirely — e.g. period='all'), the delta
// is undefined. Green up, amber down, slate zero.
interface DeltaInfo {
  pct: number     // signed percentage
  positive: boolean
  isZero: boolean
}

function computeDelta(current: number, prev: number | undefined): DeltaInfo | null {
  if (prev === undefined) return null
  if (prev === 0) {
    // No prev to compare against — surface as neutral (—).
    return null
  }
  const pct = ((current - prev) / prev) * 100
  return { pct, positive: pct > 0, isZero: Math.abs(pct) < 0.5 }
}

function DeltaBadge({ delta }: { delta: DeltaInfo | null }) {
  if (delta === null) return null
  const rounded = Math.round(delta.pct)
  const label = delta.isZero
    ? '0%'
    : `${delta.positive ? '+' : ''}${rounded}%`
  const tone = delta.isZero
    ? 'bg-slate-100 text-slate-600'
    : delta.positive
      ? 'bg-green-100 text-green-700'
      : 'bg-amber-100 text-amber-700'
  return (
    <span className={`ml-2 inline-block text-xs font-medium tabular-nums px-1.5 py-0.5 rounded ${tone}`}>
      {label}
    </span>
  )
}

function HeadlineCard({
  label, big, caption, href, hint, loading, accent, delta,
}: {
  label: string
  big: string | null
  caption: string | null
  href: string
  hint: string
  loading: boolean
  accent: string
  delta?: DeltaInfo | null
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white shadow-sm p-6 hover:border-slate-300 hover:shadow transition-all block"
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className="text-xs text-slate-400 group-hover:text-slate-600">
          Drill →
        </span>
      </div>
      {loading ? (
        <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
      ) : big !== null ? (
        <>
          <p className="mt-3 flex items-baseline">
            <span
              className="text-5xl font-bold tabular-nums"
              style={{ color: accent }}
            >
              {big}
            </span>
            {delta && <DeltaBadge delta={delta} />}
          </p>
          {caption && (
            <p className="mt-2 text-sm text-slate-600">{caption}</p>
          )}
        </>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">{hint}</p>
    </Link>
  )
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <OverviewInner />
    </Suspense>
  )
}

function OverviewInner() {
  const client = getClient()
  const clientId = client?.id
  const accent = client?.primary_colour || '#1A5C2A'

  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [filterValues, setFilterValues] = useState<FilterValues>(() => ({
    crop:     searchParams.get('crop')     || '',
    state:    searchParams.get('state')    || '',
    district: searchParams.get('district') || '',
    package:  searchParams.get('package')  || '',
  }))
  const [period, setPeriod] = useState<PeriodPreset>(() => {
    const p = searchParams.get('period') as PeriodPreset | null
    return p && PERIOD_PRESETS.some(x => x.key === p) ? p : 'this-month'
  })
  const [customFrom, setCustomFrom] = useState<string>(() => searchParams.get('from') || '')
  const [customTo,   setCustomTo]   = useState<string>(() => searchParams.get('to')   || '')

  const [data, setData] = useState<OverviewResponse | null>(null)
  const [options, setOptions] = useState<FilterOptionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    api
      .get<FilterOptionsResponse>(`/client/${clientId}/reports/filter-options`)
      .then(({ data }) => setOptions(data))
      .catch(() => { /* chips render empty; page still works */ })
  }, [clientId])

  useEffect(() => {
    if (!clientId) return
    setLoading(true); setError('')
    const q = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) q.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) q.set('period_from', from.toISOString())
    if (to)   q.set('period_to',   to.toISOString())
    // Prev window — only when the preset has a natural "before"
    // interpretation (i.e. not 'all'). If both from/to resolve, ask
    // the backend to also run the period-based metrics against the
    // prev window so the frontend can render delta badges.
    const prev = prevPeriodDates(period, customFrom, customTo)
    if (prev.from && prev.to) {
      q.set('prev_period_from', prev.from.toISOString())
      q.set('prev_period_to',   prev.to.toISOString())
    }
    api
      .get<OverviewResponse>(
        `/client/${clientId}/reports/overview?${q.toString()}`,
      )
      .then(({ data }) => setData(data))
      .catch((err) =>
        setError(extractErrorMessage(err, 'Could not load overview.')),
      )
      .finally(() => setLoading(false))
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
  const periodLabel = period === 'custom' && customFrom && customTo
    ? `${customFrom} → ${customTo}`
    : (PERIOD_PRESETS.find(p => p.key === period)?.label ?? 'This month')

  // Carry filter state to drill pages on card click.
  const drillQs = buildDrillQuery(filterValues, period, customFrom, customTo)

  const cur = data?.current
  const prev = data?.prev  // null when period is 'all'

  const conv = cur?.orders_conversion
  const salePct = conv && conv.ordered > 0
    ? `${Math.round((conv.picked_up / conv.ordered) * 100)}%`
    : (conv ? '—' : null)

  // Deltas — only when a prev block came back.
  const deltaFarmers = prev
    ? computeDelta(cur!.subs_new.farmers, prev.subs_new.farmers)
    : null
  const deltaOrders = prev
    ? computeDelta(cur!.orders_count.orders, prev.orders_count.orders)
    : null
  // Sale conversion delta is on the RATIO (percentage points),
  // not on the raw ordered/picked_up numbers. Special-case: return
  // a synthetic DeltaInfo whose "pct" is the pp difference.
  const deltaSale = (() => {
    if (!prev || !conv) return null
    const curPct = conv.ordered > 0 ? (conv.picked_up / conv.ordered) * 100 : 0
    const prevPct = prev.orders_conversion.ordered > 0
      ? (prev.orders_conversion.picked_up / prev.orders_conversion.ordered) * 100
      : 0
    if (prev.orders_conversion.ordered === 0 && conv.ordered === 0) return null
    const diff = curPct - prevPct
    return { pct: diff, positive: diff > 0, isZero: Math.abs(diff) < 0.5 }
  })()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Reports
        </p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">
          Overview
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          At-a-glance view across subscriptions and orders. Tap any
          card to drill into the full breakdown.
        </p>
      </header>

      <ReportSubjectTabs />

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

      {period === 'custom' && (
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-xs text-slate-500 flex items-center gap-2">
            From
            <input
              type="date" value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1 text-sm text-slate-700 bg-white"
            />
          </label>
          <label className="text-xs text-slate-500 flex items-center gap-2">
            To
            <input
              type="date" value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1 text-sm text-slate-700 bg-white"
            />
          </label>
          {(!customFrom || !customTo) && (
            <span className="text-xs text-amber-700">Pick both dates to filter.</span>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HeadlineCard
          label="New Farmers"
          big={cur ? cur.subs_new.farmers.toLocaleString() : null}
          caption={cur
            ? `${cur.subs_new.relationships.toLocaleString()} new subscription${cur.subs_new.relationships === 1 ? '' : 's'}`
            : null}
          href={`/reports/subscriptions${drillQs}`}
          hint={`First-time farmers in ${periodLabel.toLowerCase()}.`}
          loading={loading}
          accent={accent}
          delta={deltaFarmers}
        />
        <HeadlineCard
          label="Active Subscriptions"
          big={cur ? cur.subs_active.subscriptions.toLocaleString() : null}
          caption={cur
            ? `${cur.subs_active.farmers.toLocaleString()} farmer${cur.subs_active.farmers === 1 ? '' : 's'}`
            : null}
          href={`/reports/subscriptions${drillQs}`}
          hint="Currently ACTIVE. Period does not apply."
          loading={loading}
          accent={accent}
        />
        <HeadlineCard
          label="Orders"
          big={cur ? cur.orders_count.orders.toLocaleString() : null}
          caption={cur
            ? `${cur.orders_count.farmers.toLocaleString()} farmer${cur.orders_count.farmers === 1 ? '' : 's'}`
            : null}
          href={`/reports/orders${drillQs}`}
          hint={`Orders that reached the dealer in ${periodLabel.toLowerCase()}.`}
          loading={loading}
          accent={accent}
          delta={deltaOrders}
        />
        <HeadlineCard
          label="Sale Conversion"
          big={salePct}
          caption={conv
            ? `${conv.picked_up.toLocaleString()} of ${conv.ordered.toLocaleString()} orders reached the farmer`
            : null}
          href={`/reports/orders${drillQs}`}
          hint="Picked up / Ordered."
          loading={loading}
          accent={accent}
          delta={deltaSale}
        />
      </div>

      <p className="text-xs text-slate-400">
        Deltas compare vs the prior period (Last month for This month, etc.).
        Active has no delta — it's point-in-time. Hero trend charts arrive
        in the next polish pass.
      </p>
    </div>
  )
}
