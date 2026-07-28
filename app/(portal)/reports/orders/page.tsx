'use client'

// Client Reports — Orders drill (Phase 1).
//
// Filters:
//   Crop · State · District · Package · Period.
// Period matters for every Orders metric (they're all time-bounded
// event counts), so unlike the Subscriptions page — where Period
// only bounded the New card — here Period always narrows the result.
//
// Metric wired today: COUNT. ITEMS / BRAND_MIX / ROUTING /
// CONVERSION fill in as the queries.py stubs land.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'

interface OrdersCountResponse {
  orders: number
  farmers: number
}

interface OrdersRoutingResponse {
  direct: number
  via_facilitator: number
}

interface OrdersItemsResponse {
  items_total: number
  items_approved: number
  items_rejected: number
}

interface OrdersBrandMixResponse {
  locked: number
  recommended: number
  open: number
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

// Categorical color for Via Facilitator. Amber-500 pairs clearly
// with any brand-green primary (this client) and reads distinct
// against any brand colour that isn't itself amber/orange. If a
// future client's brand IS amber, revisit and pick from
// client.secondary_colour or a per-client override.
const VIA_FACILITATOR_COLOUR = '#F59E0B'

function RoutingCard({
  data, loading, accent, periodLabel,
}: {
  data: OrdersRoutingResponse | null
  loading: boolean
  accent: string
  periodLabel: string
}) {
  const total = data ? data.direct + data.via_facilitator : 0
  const directPct = total > 0 ? Math.round((data!.direct / total) * 100) : 0
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">Order Routing</p>
      {loading ? (
        <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
      ) : data ? (
        <>
          <div className="mt-3 flex items-baseline gap-6">
            <div>
              <p className="text-3xl font-bold tabular-nums" style={{ color: accent }}>
                {data.direct.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: accent }}
                />
                Direct
              </p>
            </div>
            <div>
              <p
                className="text-3xl font-bold tabular-nums"
                style={{ color: VIA_FACILITATOR_COLOUR }}
              >
                {data.via_facilitator.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: VIA_FACILITATOR_COLOUR }}
                />
                Via Facilitator
              </p>
            </div>
          </div>
          {total > 0 && (
            <div
              className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
              aria-label={`Direct ${directPct}%, Via Facilitator ${100 - directPct}%`}
            >
              <div
                className="h-full"
                style={{ width: `${directPct}%`, backgroundColor: accent }}
              />
              <div
                className="h-full"
                style={{
                  width: `${100 - directPct}%`,
                  backgroundColor: VIA_FACILITATOR_COLOUR,
                }}
              />
            </div>
          )}
        </>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">
        {periodLabel}. Direct = farmer ordered from a dealer straight;
        Via Facilitator = a facilitator forwarded the order.
      </p>
    </div>
  )
}

// Semantic colours for the item split. Green + amber (same amber
// as the Routing card so the palette stays coherent) rather than
// pure red — the report is informational, not alarming. Slate for
// pending stays neutral.
const APPROVED_COLOUR = '#16A34A'   // green-600
const REJECTED_COLOUR = VIA_FACILITATOR_COLOUR
const PENDING_COLOUR  = '#94A3B8'   // slate-400

function ItemsCard({
  data, loading, accent, periodLabel,
}: {
  data: OrdersItemsResponse | null
  loading: boolean
  accent: string
  periodLabel: string
}) {
  // Third bucket = items whose story is still open OR closed
  // without an approve/reject decision (skipped / not-needed /
  // not-available). Label "pending" reads best for the common
  // case; hint text below spells out the caveat.
  const pending = data
    ? Math.max(0, data.items_total - data.items_approved - data.items_rejected)
    : 0
  const total = data?.items_total ?? 0
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">Items</p>
      {loading ? (
        <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
      ) : data ? (
        <>
          <p className="mt-3 text-5xl font-bold tabular-nums" style={{ color: accent }}>
            {data.items_total.toLocaleString()}
          </p>
          <div className="mt-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: APPROVED_COLOUR }}
              />
              {data.items_approved.toLocaleString()} approved
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: REJECTED_COLOUR }}
              />
              {data.items_rejected.toLocaleString()} rejected
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: PENDING_COLOUR }}
              />
              {pending.toLocaleString()} pending
            </span>
          </div>
          {total > 0 && (
            <div
              className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100"
              aria-label={
                `${data.items_approved} approved, ${data.items_rejected} rejected, ${pending} pending`
              }
            >
              <div className="h-full" style={{ width: `${pct(data.items_approved)}%`, backgroundColor: APPROVED_COLOUR }} />
              <div className="h-full" style={{ width: `${pct(data.items_rejected)}%`, backgroundColor: REJECTED_COLOUR }} />
              <div className="h-full" style={{ width: `${pct(pending)}%`, backgroundColor: PENDING_COLOUR }} />
            </div>
          )}
        </>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">
        {periodLabel}. Total counts every real item; REMOVED /
        REROUTED bookkeeping is excluded. Pending covers items
        still awaiting a decision plus items marked not-needed,
        skipped, or unavailable.
      </p>
    </div>
  )
}

// Brand mix palette. Locked = brand accent (direct business the
// client captured). Recommended = amber (SE guided but dealer can
// substitute). Open = slate (dealer's free choice). Classification
// is on SE AUTHORING intent (Practice), not on what the dealer sold.
function BrandMixCard({
  data, loading, accent, periodLabel,
}: {
  data: OrdersBrandMixResponse | null
  loading: boolean
  accent: string
  periodLabel: string
}) {
  const total = data ? data.locked + data.recommended + data.open : 0
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)
  const LOCKED_COLOUR      = accent
  const RECOMMENDED_COLOUR = VIA_FACILITATOR_COLOUR
  const OPEN_COLOUR        = PENDING_COLOUR
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">Brand Mix</p>
      {loading ? (
        <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
      ) : data ? (
        <>
          <p className="mt-3 text-5xl font-bold tabular-nums" style={{ color: accent }}>
            {total.toLocaleString()}
          </p>
          <div className="mt-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: LOCKED_COLOUR }}
              />
              {data.locked.toLocaleString()} locked
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: RECOMMENDED_COLOUR }}
              />
              {data.recommended.toLocaleString()} recommended
            </span>
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: OPEN_COLOUR }}
              />
              {data.open.toLocaleString()} open
            </span>
          </div>
          {total > 0 && (
            <div
              className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100"
              aria-label={
                `${data.locked} locked, ${data.recommended} recommended, ${data.open} open`
              }
            >
              <div className="h-full" style={{ width: `${pct(data.locked)}%`,      backgroundColor: LOCKED_COLOUR }} />
              <div className="h-full" style={{ width: `${pct(data.recommended)}%`, backgroundColor: RECOMMENDED_COLOUR }} />
              <div className="h-full" style={{ width: `${pct(data.open)}%`,        backgroundColor: OPEN_COLOUR }} />
            </div>
          )}
        </>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">
        {periodLabel}. Classified by what your Subject Expert
        authored on the practice — Locked = dealer must sell your
        specific brand (direct business); Recommended = you named a
        brand, dealer can substitute; Open = only the common name,
        dealer picks freely.
      </p>
    </div>
  )
}

type FilterValues = Record<typeof CHIPS[number]['urlKey'], string>
const EMPTY_FILTERS: FilterValues = { crop: '', state: '', district: '', package: '' }

export default function OrdersReportPage() {
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <OrdersReportInner />
    </Suspense>
  )
}

function OrdersReportInner() {
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

  const [count, setCount] = useState<OrdersCountResponse | null>(null)
  const [routing, setRouting] = useState<OrdersRoutingResponse | null>(null)
  const [items, setItems] = useState<OrdersItemsResponse | null>(null)
  const [brandMix, setBrandMix] = useState<OrdersBrandMixResponse | null>(null)
  const [options, setOptions] = useState<FilterOptionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    api
      .get<FilterOptionsResponse>(`/client/${clientId}/reports/filter-options`)
      .then(({ data }) => setOptions(data))
      .catch(() => { /* filter chips will just be empty; page still works */ })
  }, [clientId])

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
    const url = (metric: 'COUNT' | 'ROUTING' | 'ITEMS' | 'BRAND_MIX') => {
      const q = new URLSearchParams(filterParams)
      q.set('metric', metric)
      return `/client/${clientId}/reports/orders?${q.toString()}`
    }
    Promise.all([
      api.get<OrdersCountResponse>(url('COUNT')),
      api.get<OrdersRoutingResponse>(url('ROUTING')),
      api.get<OrdersItemsResponse>(url('ITEMS')),
      api.get<OrdersBrandMixResponse>(url('BRAND_MIX')),
    ])
      .then(([countRes, routingRes, itemsRes, brandRes]) => {
        setCount(countRes.data)
        setRouting(routingRes.data)
        setItems(itemsRes.data)
        setBrandMix(brandRes.data)
      })
      .catch((err) =>
        setError(extractErrorMessage(err, 'Could not load orders report.')),
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Reports
        </p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">
          Orders
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Orders your farmers placed. Only orders that reached the
          dealer (Sent and beyond) count — drafts, cancellations, and
          expiries are excluded. Training and cleaned-up entries are
          excluded automatically.
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
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1 text-sm text-slate-700 bg-white"
            />
          </label>
          <label className="text-xs text-slate-500 flex items-center gap-2">
            To
            <input
              type="date"
              value={customTo}
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          <p className="text-sm font-medium text-slate-500">Orders</p>
          {loading ? (
            <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
          ) : count ? (
            <>
              <p className="mt-3 text-5xl font-bold tabular-nums" style={{ color: accent }}>
                {count.orders.toLocaleString()}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {count.farmers.toLocaleString()}{' '}
                {count.farmers === 1 ? 'farmer' : 'farmers'}
              </p>
            </>
          ) : null}
          <p className="mt-3 text-xs text-slate-400">
            {periodLabel}. Orders that reached the dealer (Sent /
            Accepted / Processing / Sent for Approval / Partially
            Approved / Completed).
          </p>
        </div>

        <RoutingCard
          data={routing}
          loading={loading}
          accent={accent}
          periodLabel={periodLabel}
        />

        <ItemsCard
          data={items}
          loading={loading}
          accent={accent}
          periodLabel={periodLabel}
        />

        <BrandMixCard
          data={brandMix}
          loading={loading}
          accent={accent}
          periodLabel={periodLabel}
        />
      </div>

      <p className="text-xs text-slate-400">
        Coming next — sale conversion.
      </p>
    </div>
  )
}
