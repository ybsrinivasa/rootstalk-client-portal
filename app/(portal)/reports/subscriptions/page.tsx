'use client'

// Client Reports — Subscriptions drill (Phase 1).
//
// Filters:
//   Crop · State · District · Package — narrow subject scope.
//   Period — bounds "New" only (Active / Total are point-in-time).
// All filter state lives in local useState; URL is a side-effect
// via window.history.replaceState (Next 15 router pitfall — see
// feedback_next15_url_filter_state_pattern.md).
//
// Metrics wired today: ACTIVE, TOTAL, NEW. Dimension drills come
// as the *_by_dimension queries fill in on the backend.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { ExportCsvButton } from '@/components/reports/export-button'
import { DrillPanel, type MetricConfig } from '@/components/reports/drill-panel'

// Subscriptions drill metrics. Active is point-in-time, so TIME is
// deliberately absent from its supported dimensions (backend also
// enforces).
const SUBS_DRILL_METRICS: readonly MetricConfig[] = [
  {
    key: 'ACTIVE',
    label: 'Active',
    dimensions: ['CROP', 'SPACE', 'PACKAGE'],
    renderRow: (r) => ({
      primary: r.subscriptions,
      caption: `${r.farmers.toLocaleString()} farmer${r.farmers === 1 ? '' : 's'}`,
    }),
  },
  {
    key: 'TOTAL',
    label: 'Total',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'TIME'],
    renderRow: (r) => ({
      primary: r.subscriptions,
      caption: `${r.farmers.toLocaleString()} farmer${r.farmers === 1 ? '' : 's'}`,
    }),
  },
  {
    key: 'NEW',
    label: 'New',
    dimensions: ['CROP', 'SPACE', 'PACKAGE', 'TIME'],
    renderRow: (r) => ({
      primary: r.relationships,
      caption: `${r.farmers.toLocaleString()} first-time farmer${r.farmers === 1 ? '' : 's'}`,
    }),
  },
]

interface SubsMetricResponse {
  subscriptions: number
  farmers: number
}

interface SubsNewResponse {
  relationships: number
  farmers: number
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

// URL param key ↔ backend query param + user-facing label
const CHIPS = [
  { urlKey: 'crop',     apiKey: 'crop_cosh_id',     optionsKey: 'crops' as const,     label: 'Crop',     allLabel: 'All crops' },
  { urlKey: 'state',    apiKey: 'state_cosh_id',    optionsKey: 'states' as const,    label: 'State',    allLabel: 'All states' },
  { urlKey: 'district', apiKey: 'district_cosh_id', optionsKey: 'districts' as const, label: 'District', allLabel: 'All districts' },
  { urlKey: 'package',  apiKey: 'package_id',       optionsKey: 'packages' as const,  label: 'Package',  allLabel: 'All packages' },
] as const

// Period presets — the Period chip is a preset picker rather than a
// UUID picker. Default is 'this-month' so the "New" card answers
// "how many new farmers signed up this month?" out of the box.
// 'custom' reveals two native date inputs below the chip row.
const PERIOD_PRESETS = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-90d',   label: 'Last 90 days' },
  { key: 'all',        label: 'All time' },
  { key: 'custom',     label: 'Custom range' },
] as const

type PeriodPreset = typeof PERIOD_PRESETS[number]['key']

// Format a Date as YYYY-MM-DD (local timezone) for <input type="date">.
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
    // Date-input value ("YYYY-MM-DD") + local midnight is the user's
    // intent. To is INCLUSIVE from the user's view, so bump +1 day
    // to match the backend's [from, to) half-open window semantics.
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : undefined
    let to: Date | undefined
    if (customTo) {
      to = new Date(`${customTo}T00:00:00`)
      to.setDate(to.getDate() + 1)
    }
    return { from, to }
  }
  return {}  // 'all' — no bounds
}

export default function SubscriptionsReportPage() {
  // useSearchParams needs a Suspense boundary for static prerendering
  // in Next 15. See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <SubscriptionsReportInner />
    </Suspense>
  )
}

function MetricCard({
  label, hint, data, loading, accent,
}: {
  label: string
  hint: string
  data: SubsMetricResponse | null
  loading: boolean
  accent: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      {loading ? (
        <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
      ) : data ? (
        <>
          <p
            className="mt-3 text-5xl font-bold tabular-nums"
            style={{ color: accent }}
          >
            {data.subscriptions.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {data.farmers.toLocaleString()}{' '}
            {data.farmers === 1 ? 'farmer' : 'farmers'}
          </p>
        </>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">{hint}</p>
    </div>
  )
}

function NewSubscriptionsCard({
  data, loading, accent, periodLabel,
}: {
  data: SubsNewResponse | null
  loading: boolean
  accent: string
  periodLabel: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
      <p className="text-sm font-medium text-slate-500">New Subscriptions</p>
      {loading ? (
        <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
      ) : data ? (
        <>
          <p
            className="mt-3 text-5xl font-bold tabular-nums"
            style={{ color: accent }}
          >
            {data.relationships.toLocaleString()}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {data.farmers.toLocaleString()}{' '}
            first-time {data.farmers === 1 ? 'farmer' : 'farmers'}
          </p>
        </>
      ) : null}
      <p className="mt-3 text-xs text-slate-400">
        {periodLabel}. First-time = farmer's very first subscription
        within the current chip scope fell inside the window.
      </p>
    </div>
  )
}

type FilterValues = Record<typeof CHIPS[number]['urlKey'], string>

const EMPTY_FILTERS: FilterValues = { crop: '', state: '', district: '', package: '' }

function SubscriptionsReportInner() {
  const client = getClient()
  const clientId = client?.id
  const accent = client?.primary_colour || '#1A5C2A'

  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Filter values live in local state; URL is a side-effect for
  // bookmarking. We deliberately do NOT drive the UI through
  // useRouter/useSearchParams — Next 15 shallow-navigation on the same
  // pathname was skipping re-renders and the chip clears did nothing
  // (2026-07-27 staging bug). window.history.replaceState updates the
  // URL bar without touching the router, and useState guarantees the
  // re-render.
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

  const [active, setActive] = useState<SubsMetricResponse | null>(null)
  const [total, setTotal] = useState<SubsMetricResponse | null>(null)
  const [newSubs, setNewSubs] = useState<SubsNewResponse | null>(null)
  const [options, setOptions] = useState<FilterOptionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Fetch filter chip options once per client.
  useEffect(() => {
    if (!clientId) return
    api
      .get<FilterOptionsResponse>(`/client/${clientId}/reports/filter-options`)
      .then(({ data }) => setOptions(data))
      .catch(() => { /* filter chips will just be empty; page still works */ })
  }, [clientId])

  // Fetch all three metrics whenever any filter or the period changes.
  useEffect(() => {
    if (!clientId) return
    setLoading(true); setError('')
    const filterParams = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) filterParams.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    const url = (metric: 'ACTIVE' | 'TOTAL' | 'NEW') => {
      const q = new URLSearchParams(filterParams)
      q.set('metric', metric)
      if (metric === 'NEW') {
        if (from) q.set('period_from', from.toISOString())
        if (to)   q.set('period_to',   to.toISOString())
      }
      return `/client/${clientId}/reports/subscriptions?${q.toString()}`
    }
    Promise.all([
      api.get<SubsMetricResponse>(url('ACTIVE')),
      api.get<SubsMetricResponse>(url('TOTAL')),
      api.get<SubsNewResponse>(url('NEW')),
    ])
      .then(([activeRes, totalRes, newRes]) => {
        setActive(activeRes.data)
        setTotal(totalRes.data)
        setNewSubs(newRes.data)
      })
      .catch((err) =>
        setError(
          extractErrorMessage(err, 'Could not load subscriptions report.'),
        ),
      )
      .finally(() => setLoading(false))
  }, [clientId, filterValues, period, customFrom, customTo])

  // Sync URL bar to filter + period state so bookmarks + shares work.
  // Skip the 'this-month' default so ordinary URLs stay clean.
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

  // Switching to Custom for the first time — seed the two inputs
  // with this-month's range so the user has something to edit
  // rather than staring at two empty date pickers.
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

  // Export URL mirrors the fetch URL construction — same chips,
  // same period — so CSV always matches what's on-screen.
  const exportUrl = (() => {
    const q = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) q.set(chip.apiKey, v)
    }
    const { from, to } = periodDates(period, customFrom, customTo)
    if (from) q.set('period_from', from.toISOString())
    if (to)   q.set('period_to',   to.toISOString())
    const qs = q.toString()
    return `/client/${clientId}/reports/subscriptions/export.csv${qs ? '?' + qs : ''}`
  })()
  const shortName = client?.short_name || 'client'
  const stamp = toYmd(new Date()).replace(/-/g, '')
  const exportFallbackName = `${shortName}-subscriptions-${stamp}.csv`

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Reports
          </p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Subscriptions
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            A snapshot of your subscription base. Training-session subscriptions
            and cleaned-up entries are excluded automatically.
          </p>
        </header>
        {clientId && (
          <ExportCsvButton href={exportUrl} fallbackFilename={exportFallbackName} />
        )}
      </div>

      <ReportSubjectTabs />

      {/* Filter chip row.
          Native <select> would auto-size to the WIDEST option in its
          dropdown (long package names blew the Package chip to full
          width, wrapping the row). We layer the select as an invisible
          overlay on top of the label so the pill sizes to the DISPLAYED
          text — short — while keeping every native affordance
          (keyboard, mobile picker, ARIA). */}
      <div className="flex flex-wrap gap-2 items-center">
        {CHIPS.map(chip => {
          const opts = options?.[chip.optionsKey] ?? []
          const value = filterValues[chip.urlKey]
          const isSet = !!value
          // While options are loading, show a placeholder instead of
          // the raw UUID from the URL — otherwise the chip briefly
          // renders "…4116-4d01-8c06-…" before the friendly name resolves.
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
              {/* Select overlay: covers the LABEL + VALUE area only,
                  leaving the × button (when present) outside so the
                  clear click never falls through to the select. When
                  no × is showing, right-0 makes the overlay fill the
                  whole pill so opening the dropdown works everywhere. */}
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
        {/* Period chip. Always has a value (default 'this-month'); no ×
            because "no period" is not a state — 'all' is the wide-open
            preset. Only affects the "New" card; Active + Total ignore. */}
        <div className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors border-slate-800 bg-slate-800 text-white">
          <span className="text-xs uppercase tracking-wider text-white/70">
            Period
          </span>
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

      {/* Custom date range — visible only when Custom is picked.
          Native <input type="date"> gives a real calendar on every
          modern browser + a proper wheel picker on mobile, no
          dependency. "To" is inclusive from the user's view; we
          bump it +1 day inside periodDates so backend's half-open
          [from, to) semantics match. */}
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
            <span className="text-xs text-amber-700">
              Pick both dates to filter.
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Active Subscriptions"
          hint="Currently ACTIVE (excludes lapsed, cancelled, unsubscribed). Period does not apply."
          data={active}
          loading={loading}
          accent={accent}
        />
        <MetricCard
          label="Total Subscriptions"
          hint="Every subscription ever created, any status. Period does not apply."
          data={total}
          loading={loading}
          accent={accent}
        />
        <NewSubscriptionsCard
          data={newSubs}
          loading={loading}
          accent={accent}
          periodLabel={
            period === 'custom' && customFrom && customTo
              ? `${customFrom} → ${customTo}`
              : (PERIOD_PRESETS.find(p => p.key === period)?.label ?? 'This month')
          }
        />
      </div>

      {clientId && (() => {
        const baseQuery = new URLSearchParams()
        for (const chip of CHIPS) {
          const v = filterValues[chip.urlKey]
          if (v) baseQuery.set(chip.apiKey, v)
        }
        const { from, to } = periodDates(period, customFrom, customTo)
        if (from) baseQuery.set('period_from', from.toISOString())
        if (to)   baseQuery.set('period_to',   to.toISOString())
        return (
          <DrillPanel
            clientId={clientId}
            endpoint={`/client/${clientId}/reports/subscriptions`}
            baseQuery={baseQuery}
            metrics={SUBS_DRILL_METRICS}
            accent={accent}
            heading="Subscriptions broken down by"
          />
        )
      })()}

      <p className="text-xs text-slate-400">
        Active is a point-in-time snapshot, so its Time dimension is
        deliberately unavailable. Total and New support all four.
      </p>
    </div>
  )
}
