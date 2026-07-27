'use client'

// Client Reports — Subscriptions drill (Phase 1, vertical slice).
//
// Filters (2026-07-27): Crop · State · District · Package. Selected
// values persist in the URL so a Report User can bookmark or share
// a specific view. Period chip lands with the subs_new metric —
// ACTIVE right-now has no period semantics.
//
// The only backend metric wired today is ACTIVE
// (GET /client/{cid}/reports/subscriptions?metric=ACTIVE). Renders
// the number in client.primary_colour so managers see "their own"
// number, not a generic chart palette.
//
// NEW, TOTAL, and every dimension drill land as backend fills in
// queries.py; add tabs / cards to this page then. Keep the current
// page honest: nothing on screen we can't back with real data.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

interface SubsActiveResponse {
  subscriptions: number
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

export default function SubscriptionsReportPage() {
  // useSearchParams needs a Suspense boundary for static prerendering
  // in Next 15. See: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
  return (
    <Suspense fallback={<div className="text-slate-400 text-sm">Loading…</div>}>
      <SubscriptionsReportInner />
    </Suspense>
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

  const [data, setData] = useState<SubsActiveResponse | null>(null)
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

  // Fetch metric whenever any filter changes.
  useEffect(() => {
    if (!clientId) return
    setLoading(true); setError('')
    const q = new URLSearchParams({ metric: 'ACTIVE' })
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) q.set(chip.apiKey, v)
    }
    api
      .get<SubsActiveResponse>(
        `/client/${clientId}/reports/subscriptions?${q.toString()}`,
      )
      .then(({ data }) => setData(data))
      .catch((err) =>
        setError(
          extractErrorMessage(err, 'Could not load subscriptions report.'),
        ),
      )
      .finally(() => setLoading(false))
  }, [clientId, filterValues])

  // Sync URL bar to filter state so bookmarks + shares keep working.
  useEffect(() => {
    const params = new URLSearchParams()
    for (const chip of CHIPS) {
      const v = filterValues[chip.urlKey]
      if (v) params.set(chip.urlKey, v)
    }
    const qs = params.toString()
    const target = qs ? `${pathname}?${qs}` : pathname
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(null, '', target)
    }
  }, [pathname, filterValues])

  const updateFilter = useCallback((urlKey: keyof FilterValues, value: string) => {
    setFilterValues(prev => ({ ...prev, [urlKey]: value }))
  }, [])

  const clearAll = useCallback(() => {
    setFilterValues(EMPTY_FILTERS)
  }, [])

  const anyFilter = CHIPS.some(c => filterValues[c.urlKey])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <p className="text-sm font-medium text-slate-500">Active Subscriptions</p>
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
      </div>

      <p className="text-xs text-slate-400">
        More metrics — New and Total subscriptions, trends over time, drills
        by crop, district, and package — arrive in the next few builds.
      </p>
    </div>
  )
}
