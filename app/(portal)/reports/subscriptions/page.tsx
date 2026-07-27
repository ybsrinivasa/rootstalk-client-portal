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

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

function SubscriptionsReportInner() {
  const client = getClient()
  const clientId = client?.id
  const accent = client?.primary_colour || '#1A5C2A'

  const router = useRouter()
  const searchParams = useSearchParams()

  // Filter values read straight from the URL — no local state to
  // fall out of sync with the URL bar.
  const filterValues = useMemo(
    () => Object.fromEntries(
      CHIPS.map(c => [c.urlKey, searchParams.get(c.urlKey) || '']),
    ) as Record<typeof CHIPS[number]['urlKey'], string>,
    [searchParams],
  )

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

  const updateFilter = useCallback((urlKey: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(urlKey, value)
    else params.delete(urlKey)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?')
  }, [router, searchParams])

  const clearAll = useCallback(() => {
    router.replace('?')
  }, [router])

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
          const selectedLabel = isSet
            ? (opts.find(o => o.id === value)?.name ?? value)
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
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
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
                  className="relative z-10 text-white/70 hover:text-white leading-none"
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
