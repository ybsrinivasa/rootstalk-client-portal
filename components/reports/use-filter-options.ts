'use client'

// Cascading filter-options fetcher shared across the Reports pages.
//
// On every filter-value change, refetches /filter-options with the
// current selection so each chip's options list narrows to only
// values intersectable with the OTHER active chips. Also reconciles:
// if a currently-selected chip value no longer appears in the fresh
// options list, clear it and fire the caller-supplied onEvicted hook
// (used to toast "X filter cleared — no data with the new filters").
//
// Keeps the fetch cheap on rapid chip changes by debouncing 200ms.

import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'

// Backend chip → API param name. Kept aligned with the CHIPS
// tables on each page.
export const CHIP_API_KEYS = {
  crop:     'crop_cosh_id',
  state:    'state_cosh_id',
  district: 'district_cosh_id',
  package:  'package_id',
  dealer:   'dealer_user_id',
  promoter: 'promoter_user_id',
  severity: 'severity',
  pundit:   'pundit_id',
} as const

export type ChipKey = keyof typeof CHIP_API_KEYS

export interface FilterOption {
  id: string
  name: string
}

export interface FilterOptionsResponse {
  crops: FilterOption[]
  states: FilterOption[]
  districts: FilterOption[]
  packages?: FilterOption[]
  dealers?: FilterOption[]
  promoters?: FilterOption[]
  severities?: FilterOption[]
  pundits?: FilterOption[]
}

// Which options key corresponds to which chip.
const CHIP_TO_OPTIONS_KEY: Record<ChipKey, keyof FilterOptionsResponse> = {
  crop: 'crops',
  state: 'states',
  district: 'districts',
  package: 'packages',
  dealer: 'dealers',
  promoter: 'promoters',
  severity: 'severities',
  pundit: 'pundits',
}

interface UseCascadingFilterOptionsArgs {
  clientId: string | undefined
  filterValues: Partial<Record<ChipKey, string>>
  /** Called when a currently-selected chip value is no longer
   *  available in the fresh options list. Caller clears + toasts. */
  onEvicted?: (evicted: ChipKey[], clear: (chip: ChipKey) => void) => void
  /** Subject-specific endpoint suffix. Defaults to the shared
   *  Subscription-scoped one. Queries area passes 'queries/filter-options'. */
  endpointPath?: string
}

export function useCascadingFilterOptions({
  clientId,
  filterValues,
  onEvicted,
  endpointPath = 'filter-options',
}: UseCascadingFilterOptionsArgs): FilterOptionsResponse | null {
  const [options, setOptions] = useState<FilterOptionsResponse | null>(null)
  // Stable ref to the callback so useEffect doesn't re-run when the
  // caller passes a fresh arrow function each render.
  const onEvictedRef = useRef(onEvicted)
  onEvictedRef.current = onEvicted

  // Serialise filter values so useEffect's dep array is a plain string
  // (avoids re-firing on same-shape re-renders of an object literal).
  const filterKey = JSON.stringify(filterValues)

  useEffect(() => {
    if (!clientId) return
    const q = new URLSearchParams()
    for (const chip of Object.keys(CHIP_API_KEYS) as ChipKey[]) {
      const v = filterValues[chip]
      if (v) q.set(CHIP_API_KEYS[chip], v)
    }
    const qs = q.toString()
    const url = `/client/${clientId}/reports/${endpointPath}${qs ? '?' + qs : ''}`

    // Small debounce so a rapid chip-clear-and-reselect doesn't
    // fire two requests.
    const handle = setTimeout(() => {
      let cancelled = false
      api
        .get<FilterOptionsResponse>(url)
        .then(({ data }) => {
          if (cancelled) return
          setOptions(data)
          // Reconcile: any current chip value that isn't in the new
          // options list → evict.
          const evicted: ChipKey[] = []
          for (const chip of Object.keys(CHIP_API_KEYS) as ChipKey[]) {
            const value = filterValues[chip]
            if (!value) continue
            const bucket = data[CHIP_TO_OPTIONS_KEY[chip]] as FilterOption[] | undefined
            if (!bucket || !bucket.some(o => o.id === value)) {
              evicted.push(chip)
            }
          }
          if (evicted.length && onEvictedRef.current) {
            onEvictedRef.current(evicted, () => { /* per-call clear delegated to caller */ })
          }
        })
        .catch(() => { /* chip options stay stale; safer than emptying them */ })
      return () => { cancelled = true }
    }, 200)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, filterKey, endpointPath])

  return options
}
