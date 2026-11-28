'use client'

// Farmer Support — list view (Bundle B, 2026-11-16).
// CRM-style list for CLIENT_RM (plus CA + CM-EDIT + SA). Alert tiles
// at the top double as one-tap filters. Farmer rows are collapsed by
// default; clicking a row expands it inline to show that farmer's
// matching subscriptions. Each sub row is clickable and navigates to
// the per-sub detail page (/farmer-support/[userId]/subscriptions/[subId]).
//
// Default filter: subscription_status=ACTIVE. Keeps the inline sub
// list naturally bounded to the 1–6 actionable crops the RM typically
// calls about. "No Active Subscription" alert-tile widens the filter.
//
// Origin is rendered as a secondary chip under Status visually; both
// are independent URL params so flipping Status doesn't reset Origin.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'


interface FarmerRow {
  user_id: string
  name: string | null
  phone: string | null
  state_cosh_id: string | null
  // 2026-11-11 — backend-resolved readable names next to cosh_ids.
  state_name: string | null
  district_cosh_id: string | null
  district_name: string | null
  sub_district_cosh_id: string | null
  latest_subscription_id: string | null
  latest_subscription_status: string | null
  latest_crop_start_date: string | null  // ISO date or null
  // Bundle B (2026-11-16) — count of subs matching the current
  // filter set (status / origin / crop / date / promoter). Was
  // `active_subscription_count` which ignored every sub-level filter
  // → confusing numbers under Origin/Crop filters.
  matching_subscription_count: number
  promoter_name: string | null
}
interface FarmersPage {
  total: number
  page: number
  page_size: number
  rows: FarmerRow[]
}

// Bundle B — per-farmer sub summary, fetched on row expand from
// /farmer-support/farmers/{uid}/subscriptions with the same filters.
interface FarmerSub {
  subscription_id: string
  status: string
  is_active: boolean
  subscription_type: 'SELF' | 'ASSIGNED'
  package_name: string | null
  crop_cosh_id: string | null
  crop_name: string | null
  crop_start_date: string | null
  promoter_name: string | null
  diagnoses_count: number
  unanswered_queries_count: number
  auto_remove_at: string | null
  matches_filter: boolean | null
}

interface BaseAlertRow {
  subscription_id: string
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  state_cosh_id: string | null
  state_name: string | null
  district_cosh_id: string | null
  district_name: string | null
  crop_cosh_id: string | null
  crop_name: string | null
}
interface PendingStartDateRow extends BaseAlertRow {
  subscribed_at: string | null
}
interface OverdueInputRow extends BaseAlertRow {
  crop_start_date: string | null
  timeline_name: string
}
interface MissedInputRow extends BaseAlertRow {
  timeline_name: string
  window_end: string
}
interface OverdueExpertQueryRow extends BaseAlertRow {
  query_id: string
  query_title: string
  query_status: string
  query_created_at: string | null
  sla_hours: number
}
interface NoActiveSubRow extends BaseAlertRow {
  last_subscription_status: string | null
  last_subscription_created_at: string | null
}

type AlertType =
  | 'MISSING_START_DATE'
  | 'OVERDUE_INPUT'
  | 'MISSED_INPUT'
  | 'OVERDUE_EXPERT_QUERY'
  | 'NO_ACTIVE_SUBSCRIPTION'

const ALERT_META: Record<AlertType, { label: string; shortLabel: string; tone: string }> = {
  MISSING_START_DATE:      { label: 'Awaiting Start Date',     shortLabel: 'Awaiting start',   tone: 'amber' },
  OVERDUE_INPUT:           { label: 'Input Due Now, No Order', shortLabel: 'Due now',          tone: 'orange' },
  MISSED_INPUT:            { label: 'Missed Inputs',           shortLabel: 'Missed',           tone: 'red' },
  OVERDUE_EXPERT_QUERY:    { label: 'Unanswered Queries',      shortLabel: 'Query overdue',    tone: 'pink' },
  NO_ACTIVE_SUBSCRIPTION:  { label: 'No Active Subscription',  shortLabel: 'Inactive',         tone: 'slate' },
}

function toneClasses(tone: string): { tile: string; badge: string } {
  switch (tone) {
    case 'amber':  return { tile: 'border-amber-300 bg-amber-50',   badge: 'bg-amber-100 text-amber-800' }
    case 'orange': return { tile: 'border-orange-300 bg-orange-50', badge: 'bg-orange-100 text-orange-800' }
    case 'red':    return { tile: 'border-red-300 bg-red-50',       badge: 'bg-red-100 text-red-800' }
    case 'pink':   return { tile: 'border-pink-300 bg-pink-50',     badge: 'bg-pink-100 text-pink-800' }
    default:       return { tile: 'border-slate-300 bg-slate-50',   badge: 'bg-slate-200 text-slate-700' }
  }
}

// Status values the list filter accepts. 'ALL' = no status filter
// (used by the "No Active Subscription" alert tile which needs to
// override the default-ACTIVE scope). Default on initial page load is
// 'ACTIVE' — see rationale in the file header.
type StatusFilter = '' | 'ACTIVE' | 'COMPLETED' | 'NOT_STARTED' | 'ALL'

// sessionStorage key for the expansion state so a back-nav from a
// sub-detail page lands with the right farmer row re-opened.
const EXPANSION_KEY = 'rt_fs_expanded_v1'


export default function FarmerSupportPage() {
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id

  // Filters. Default statusFilter = ACTIVE per the Bundle B design —
  // the collapsed-row list is most useful when it defaults to the
  // actionable crops. RM can flip to COMPLETED/etc. manually.
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [cropFilter, setCropFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')
  const [originFilter, setOriginFilter] = useState<'' | 'SELF' | 'PROMOTER'>('')
  const [startFrom, setStartFrom] = useState('')
  const [startTo, setStartTo] = useState('')
  const [alertType, setAlertType] = useState<'' | AlertType>('')

  // Sort + pagination
  const [sortBy, setSortBy] = useState<'name' | 'start_date' | 'district'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Data
  const [farmers, setFarmers] = useState<FarmersPage>({ total: 0, page: 1, page_size: 25, rows: [] })
  // 2026-11-28 — Capture the specific "role not allowed" 403 so the
  // empty-state message tells the user WHY they can't see the list
  // instead of the misleading "No farmers match these filters". The
  // list endpoint is deliberately gated to SA/CA/CLIENT_RM/CM-EDIT
  // (see _assert_ca_or_rm in clients/router.py); the alert tiles on
  // this page use a looser gate and will still load.
  const [restricted, setRestricted] = useState(false)
  const [loading, setLoading] = useState(true)

  // Bundle B — per-farmer expansion state + lazy-fetched sub list.
  // Hydrated from sessionStorage on mount so returning from a sub-
  // detail page restores the opened rows.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = sessionStorage.getItem(EXPANSION_KEY)
      if (!raw) return new Set()
      return new Set(JSON.parse(raw) as string[])
    } catch { return new Set() }
  })
  const [subsByFarmer, setSubsByFarmer] = useState<Record<string, FarmerSub[]>>({})
  const [subsLoading, setSubsLoading] = useState<Set<string>>(new Set())
  const [subsError, setSubsError] = useState<Record<string, string>>({})

  // Alert tile data (counts + farmer_user_id set for cross-referencing)
  const [pendingDates, setPendingDates] = useState<PendingStartDateRow[]>([])
  const [overdueInputs, setOverdueInputs] = useState<OverdueInputRow[]>([])
  const [missedInputs, setMissedInputs] = useState<MissedInputRow[]>([])
  const [overdueQueries, setOverdueQueries] = useState<OverdueExpertQueryRow[]>([])
  const [noActiveSubs, setNoActiveSubs] = useState<NoActiveSubRow[]>([])
  const [alertsLoading, setAlertsLoading] = useState(true)

  // Derived state/district options from the loaded farmer rows.
  const stateOptions = useMemo(() => {
    const seen = new Map<string, string>()
    farmers.rows.forEach(r => {
      if (r.state_cosh_id) seen.set(r.state_cosh_id, r.state_name || r.state_cosh_id)
    })
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [farmers.rows])
  const districtOptions = useMemo(() => {
    const seen = new Map<string, string>()
    farmers.rows.forEach(r => {
      if (!r.district_cosh_id) return
      if (stateFilter && r.state_cosh_id !== stateFilter) return
      seen.set(r.district_cosh_id, r.district_name || r.district_cosh_id)
    })
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [farmers.rows, stateFilter])

  const loadAlerts = useCallback(async () => {
    if (!clientId) return
    setAlertsLoading(true)
    try {
      const [a, b, c, d, e] = await Promise.all([
        api.get<PendingStartDateRow[]>(`/client/${clientId}/alerts/pending-start-dates`).catch(() => ({ data: [] })),
        api.get<OverdueInputRow[]>(`/client/${clientId}/alerts/overdue-inputs`).catch(() => ({ data: [] })),
        api.get<MissedInputRow[]>(`/client/${clientId}/alerts/missed-inputs`).catch(() => ({ data: [] })),
        api.get<OverdueExpertQueryRow[]>(`/client/${clientId}/alerts/overdue-expert-queries`).catch(() => ({ data: [] })),
        api.get<NoActiveSubRow[]>(`/client/${clientId}/alerts/no-active-subscription`).catch(() => ({ data: [] })),
      ])
      setPendingDates(a.data as PendingStartDateRow[])
      setOverdueInputs(b.data as OverdueInputRow[])
      setMissedInputs(c.data as MissedInputRow[])
      setOverdueQueries(d.data as OverdueExpertQueryRow[])
      setNoActiveSubs(e.data as NoActiveSubRow[])
    } finally { setAlertsLoading(false) }
  }, [clientId])

  // Bundle B — current filter-set as a query string. Shared between
  // the list fetch + the per-farmer subs fetch on row-expand (so the
  // inline sub list matches the chip the RM saw on the farmer row).
  // Omits farmer-side filters (search/state/district) which don't
  // make sense inside a single farmer's sub list.
  const subFilterQs = useMemo(() => {
    const p = new URLSearchParams()
    if (cropFilter) p.set('crop_cosh_id', cropFilter)
    if (statusFilter && statusFilter !== 'ALL') {
      p.set('subscription_status', statusFilter)
    }
    if (originFilter) p.set('origin', originFilter)
    if (startFrom) p.set('start_date_from', startFrom)
    if (startTo) p.set('start_date_to', startTo)
    return p
  }, [cropFilter, statusFilter, originFilter, startFrom, startTo])

  const loadFarmers = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (stateFilter) params.set('state_cosh_id', stateFilter)
      if (districtFilter) params.set('district_cosh_id', districtFilter)
      if (cropFilter) params.set('crop_cosh_id', cropFilter)
      if (statusFilter && statusFilter !== 'ALL') {
        params.set('subscription_status', statusFilter)
      }
      if (originFilter) params.set('origin', originFilter)
      if (startFrom) params.set('start_date_from', startFrom)
      if (startTo) params.set('start_date_to', startTo)
      params.set('sort_by', sortBy)
      params.set('sort_dir', sortDir)
      params.set('page', String(page))
      params.set('page_size', String(pageSize))
      const { data } = await api.get<FarmersPage>(
        `/client/${clientId}/farmer-support/farmers?${params}`,
      )
      setFarmers(data)
      setRestricted(false)
    } catch (err: unknown) {
      setFarmers({ total: 0, page: 1, page_size: pageSize, rows: [] })
      // Detect the deliberate role-restriction 403 so the UI can
      // show a helpful message instead of "No farmers match".
      const e = err as { response?: { status?: number; data?: { detail?: { code?: string } } } }
      const code = e?.response?.data?.detail?.code
      setRestricted(
        e?.response?.status === 403 && code === 'farmer_support_role_required',
      )
    } finally { setLoading(false) }
  }, [
    clientId, search, stateFilter, districtFilter, cropFilter,
    statusFilter, originFilter, startFrom, startTo,
    sortBy, sortDir, page, pageSize,
  ])

  useEffect(() => { loadAlerts() }, [loadAlerts])
  useEffect(() => { loadFarmers() }, [loadFarmers])

  // When any filter (other than page) changes, reset to page 1 so the
  // user doesn't land on an out-of-range page after narrowing. Also
  // clear the lazy sub cache — cached subs were fetched under the
  // previous filter set and would be stale for the new view.
  useEffect(() => {
    setPage(1)
    setSubsByFarmer({})
    setSubsError({})
  }, [search, stateFilter, districtFilter, cropFilter, statusFilter,
      originFilter, startFrom, startTo, sortBy, sortDir, pageSize, alertType])

  // Persist expansion state so back-nav from a sub page restores it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.setItem(
        EXPANSION_KEY,
        JSON.stringify(Array.from(expandedIds)),
      )
    } catch { /* quota exceeded — harmless */ }
  }, [expandedIds])

  // Alert-type filter is applied in the UI rather than pushed down to
  // the backend: intersection of (full farmer list) ∩ (farmer_user_ids
  // on that alert endpoint). Alert tiles for "No Active Subscription"
  // additionally widen Status to ALL (rows with 0 active subs would
  // otherwise be hidden by the default-ACTIVE scope).
  const alertRowsByType: Record<AlertType, BaseAlertRow[]> = {
    MISSING_START_DATE:     pendingDates,
    OVERDUE_INPUT:          overdueInputs,
    MISSED_INPUT:           missedInputs,
    OVERDUE_EXPERT_QUERY:   overdueQueries,
    NO_ACTIVE_SUBSCRIPTION: noActiveSubs,
  }
  const alertSubIdsByFarmer = useMemo(() => {
    const out: Record<AlertType, Record<string, Set<string>>> = {
      MISSING_START_DATE: {},
      OVERDUE_INPUT: {},
      MISSED_INPUT: {},
      OVERDUE_EXPERT_QUERY: {},
      NO_ACTIVE_SUBSCRIPTION: {},
    }
    for (const t of Object.keys(alertRowsByType) as AlertType[]) {
      for (const r of alertRowsByType[t]) {
        if (!r.farmer_user_id || !r.subscription_id) continue
        const bucket = out[t][r.farmer_user_id] || new Set<string>()
        bucket.add(r.subscription_id)
        out[t][r.farmer_user_id] = bucket
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDates, overdueInputs, missedInputs, overdueQueries, noActiveSubs])

  const alertFarmerIdsByType = useMemo(() => {
    const out: Record<AlertType, Set<string>> = {
      MISSING_START_DATE: new Set(),
      OVERDUE_INPUT: new Set(),
      MISSED_INPUT: new Set(),
      OVERDUE_EXPERT_QUERY: new Set(),
      NO_ACTIVE_SUBSCRIPTION: new Set(),
    }
    for (const t of Object.keys(alertRowsByType) as AlertType[]) {
      for (const r of alertRowsByType[t]) {
        if (r.farmer_user_id) out[t].add(r.farmer_user_id)
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDates, overdueInputs, missedInputs, overdueQueries, noActiveSubs])

  const visibleRows = useMemo(() => {
    if (!alertType) return farmers.rows
    const allowed = alertFarmerIdsByType[alertType]
    return farmers.rows.filter(r => allowed.has(r.user_id))
  }, [farmers.rows, alertType, alertFarmerIdsByType])

  // Per-row alert tags for badge rendering.
  const rowAlerts = useCallback((r: FarmerRow): AlertType[] => {
    return (Object.keys(alertFarmerIdsByType) as AlertType[])
      .filter(t => alertFarmerIdsByType[t].has(r.user_id))
  }, [alertFarmerIdsByType])

  // Alert-tile click. For "No Active Subscription" we also widen the
  // Status filter to ALL — the rows that trigger the alert have ZERO
  // active subs, so the default-ACTIVE list scope would hide them.
  function onAlertTileClick(t: AlertType) {
    const active = alertType === t
    if (active) {
      setAlertType('')
      return
    }
    setAlertType(t)
    if (t === 'NO_ACTIVE_SUBSCRIPTION' && statusFilter === 'ACTIVE') {
      setStatusFilter('ALL')
    }
  }

  function clearFilters() {
    setSearch(''); setStateFilter(''); setDistrictFilter(''); setCropFilter('')
    // Reset Status back to the Bundle B default (ACTIVE), not blank —
    // the design anchor is "actionable crops first".
    setStatusFilter('ACTIVE'); setOriginFilter('')
    setStartFrom(''); setStartTo(''); setAlertType('')
  }

  // Bundle B — toggle a farmer's expansion state + lazy-fetch its
  // sub list on first expand.
  const toggleExpand = useCallback((userId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }, [])

  // Fetch subs for any newly-expanded farmer that doesn't have cached
  // subs yet. Deliberately NOT a per-row fetch inside the render loop
  // — we batch through useEffect so changing filters while rows are
  // open re-fetches cleanly.
  useEffect(() => {
    if (!clientId) return
    for (const uid of expandedIds) {
      if (subsByFarmer[uid] || subsLoading.has(uid)) continue
      setSubsLoading(prev => {
        const next = new Set(prev); next.add(uid); return next
      })
      const qs = subFilterQs.toString()
      api.get<FarmerSub[]>(
        `/client/${clientId}/farmer-support/farmers/${uid}/subscriptions${qs ? `?${qs}` : ''}`,
      )
        .then(({ data }) => {
          setSubsByFarmer(prev => ({ ...prev, [uid]: data }))
        })
        .catch(e => {
          const err = e as { message?: string; response?: { status?: number } }
          setSubsError(prev => ({
            ...prev,
            [uid]: `Could not load subscriptions (${err?.response?.status || err?.message || 'error'})`,
          }))
        })
        .finally(() => {
          setSubsLoading(prev => {
            const next = new Set(prev); next.delete(uid); return next
          })
        })
    }
  }, [expandedIds, clientId, subsByFarmer, subsLoading, subFilterQs])

  // Build the human-readable filter label passed through to the
  // sub-detail page so the "came from filter: X" strip there reads
  // true to what the RM had applied on this list.
  function filterLabelForFarmer(farmerUserId: string): string {
    const parts: string[] = []
    if (cropFilter) parts.push('Crop filter')
    if (statusFilter && statusFilter !== 'ALL') {
      const label = {
        ACTIVE: 'Status = Active',
        COMPLETED: 'Status = Completed',
        NOT_STARTED: 'Status = Not started',
      }[statusFilter] || statusFilter
      parts.push(label)
    }
    if (originFilter) {
      parts.push(originFilter === 'SELF' ? 'Origin = Self' : 'Origin = Promoter')
    }
    if (startFrom) parts.push(`Start ≥ ${startFrom}`)
    if (startTo) parts.push(`Start ≤ ${startTo}`)
    if (alertType) {
      const sids = alertSubIdsByFarmer[alertType]?.[farmerUserId]
      if (sids && sids.size > 0) {
        parts.splice(0, parts.length, ALERT_META[alertType].label)
      }
    }
    return parts.join(' · ')
  }

  const totalPages = Math.max(1, Math.ceil(farmers.total / pageSize))

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Farmer Support</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          Monitor all farmers across your field network. Search when a farmer calls in,
          or filter by alert to find farmers who need a proactive call. This view is{' '}
          <strong>read-only</strong> — the farmer continues to drive their own advisory.
        </p>
      </div>

      {/* Alert tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {(Object.keys(ALERT_META) as AlertType[]).map(t => {
          const meta = ALERT_META[t]
          const count = alertRowsByType[t].length
          const tc = toneClasses(meta.tone)
          const active = alertType === t
          return (
            <button key={t}
              onClick={() => onAlertTileClick(t)}
              disabled={alertsLoading && count === 0}
              className={`text-left rounded-xl border-2 p-3 transition ${tc.tile} ${
                active ? 'ring-2 ring-slate-800' : 'hover:ring-1 hover:ring-slate-400'
              }`}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-600">
                {meta.label}
              </p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {alertsLoading ? '…' : count}
              </p>
            </button>
          )
        })}
      </div>
      {alertType && (
        <div className="mb-3 text-xs text-slate-600 flex items-center gap-2">
          <span>Showing only farmers with <strong>{ALERT_META[alertType].label}</strong>.</span>
          <button onClick={() => setAlertType('')} className="underline hover:text-slate-900">
            Clear alert filter
          </button>
        </div>
      )}

      {/* Filter bar — Status + nested Origin on the top row (Bundle B) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <div className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
              Subscription status
            </label>
            <select value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white">
              <option value="ACTIVE">Active only (default)</option>
              <option value="COMPLETED">Completed only</option>
              <option value="NOT_STARTED">Not started (no start date)</option>
              <option value="ALL">All (any status)</option>
            </select>
            <div className="mt-2 ml-3 pl-3 border-l-2 border-slate-300">
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                ↳ Origin
              </label>
              <select value={originFilter}
                onChange={e => setOriginFilter(e.target.value as typeof originFilter)}
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white">
                <option value="">All origins</option>
                <option value="SELF">Self-subscribed only</option>
                <option value="PROMOTER">Promoter-assigned only</option>
              </select>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <select value={stateFilter}
            onChange={e => { setStateFilter(e.target.value); setDistrictFilter('') }}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All states</option>
            {stateOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select value={districtFilter}
            onChange={e => setDistrictFilter(e.target.value)}
            disabled={!stateFilter && districtOptions.length === 0}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50">
            <option value="">All districts</option>
            {districtOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <input value={startFrom} onChange={e => setStartFrom(e.target.value)}
            type="date" placeholder="Start date from"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <input value={startTo} onChange={e => setStartTo(e.target.value)}
            type="date" placeholder="Start date to"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Sort</span>
            <select value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="name">Name</option>
              <option value="start_date">Latest start date</option>
              <option value="district">District</option>
            </select>
            <select value={sortDir}
              onChange={e => setSortDir(e.target.value as typeof sortDir)}
              className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value="asc">↑ asc</option>
              <option value="desc">↓ desc</option>
            </select>
            <span className="text-slate-500 ml-3">Per page</span>
            <select value={pageSize}
              onChange={e => setPageSize(parseInt(e.target.value, 10))}
              className="border border-slate-300 rounded px-2 py-1 text-xs">
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <button onClick={clearFilters}
            className="text-xs text-slate-500 hover:text-slate-900 underline">
            Reset to defaults
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : restricted ? (
        <div className="text-center py-16 px-6">
          <p className="text-sm font-medium text-slate-700">
            Farmer Support is restricted to Customer Admin and Relationship Manager roles.
          </p>
          <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto">
            Ask your CA to assign the Relationship Manager role to your account at this client.
            Alert counts above are visible to all portal users.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <p className="text-center py-16 text-sm text-slate-400">
          No farmers match these filters.
        </p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold w-8"></th>
                <th className="text-left px-4 py-2.5 font-semibold">Name</th>
                <th className="text-left px-4 py-2.5 font-semibold">Phone</th>
                <th className="text-left px-4 py-2.5 font-semibold">Subs</th>
                <th className="text-left px-4 py-2.5 font-semibold">Promoter</th>
                <th className="text-left px-4 py-2.5 font-semibold">Latest start</th>
                <th className="text-left px-4 py-2.5 font-semibold">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(r => {
                const alerts = rowAlerts(r)
                const expanded = expandedIds.has(r.user_id)
                const subs = subsByFarmer[r.user_id]
                const loadingSubs = subsLoading.has(r.user_id)
                const errorSubs = subsError[r.user_id]
                const filterLabel = filterLabelForFarmer(r.user_id)
                return (
                  <ExpandableFarmerRow
                    key={r.user_id}
                    row={r}
                    alerts={alerts}
                    expanded={expanded}
                    onToggle={() => toggleExpand(r.user_id)}
                    subs={subs}
                    loadingSubs={loadingSubs}
                    errorSubs={errorSubs}
                    filterLabel={filterLabel}
                    onSubClick={(subId) => {
                      const qs = new URLSearchParams()
                      if (filterLabel) qs.set('filter_label', filterLabel)
                      const q = qs.toString()
                      router.push(
                        `/farmer-support/${r.user_id}/subscriptions/${subId}${q ? `?${q}` : ''}`,
                      )
                    }}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {farmers.total > pageSize && (
        <div className="flex items-center justify-between mt-4 text-xs text-slate-600">
          <span>
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, farmers.total)} of {farmers.total}
            {alertType && <span className="ml-1">(filtered by {ALERT_META[alertType].label.toLowerCase()})</span>}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1 border border-slate-300 rounded disabled:opacity-40">
              ← Prev
            </button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 py-1 border border-slate-300 rounded disabled:opacity-40">
              Next →
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-6 max-w-3xl">
        Design principle: <strong>read and remind, not act</strong>. All actions on a farmer&apos;s
        subscription — marking practices done, recording purchases, answering queries — remain
        with the farmer. This view is for visibility and follow-up.
      </p>
    </div>
  )
}


// ── Expandable farmer row ─────────────────────────────────────────────────────
//
// Click anywhere on the header row (except the phone link) to toggle
// expansion. When expanded, inline sub rows render underneath with
// crop / status / origin / promoter / start date / auto-remove chip.
// Clicking a sub row fires `onSubClick(subscription_id)` which the
// parent navigates with.

function ExpandableFarmerRow({
  row, alerts, expanded, onToggle,
  subs, loadingSubs, errorSubs,
  filterLabel, onSubClick,
}: {
  row: FarmerRow
  alerts: AlertType[]
  expanded: boolean
  onToggle: () => void
  subs: FarmerSub[] | undefined
  loadingSubs: boolean
  errorSubs: string | undefined
  filterLabel: string
  onSubClick: (subId: string) => void
}) {
  // Capture click events on the phone link separately so tapping the
  // tel: link doesn't collapse the row.
  function stop(e: React.MouseEvent) { e.stopPropagation() }

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
        <td className="px-4 py-3 text-slate-400 w-8">
          <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>
            ▸
          </span>
        </td>
        <td className="px-4 py-3">
          <p className="font-medium text-slate-800">
            {row.name || <span className="text-slate-400">—</span>}
          </p>
        </td>
        <td className="px-4 py-3">
          {row.phone ? (
            <a href={`tel:${row.phone}`} onClick={stop}
              className="text-emerald-700 hover:underline font-mono text-xs">
              {row.phone}
            </a>
          ) : <span className="text-slate-400">—</span>}
        </td>
        <td className="px-4 py-3 text-slate-700">
          <span className="font-semibold">{row.matching_subscription_count}</span>
          {row.matching_subscription_count === 0 && (
            <span className="ml-2 text-[10px] text-slate-400">
              (no matching subs under current filter)
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-slate-600">
          {row.promoter_name || <span className="text-slate-400 italic">Self</span>}
        </td>
        <td className="px-4 py-3 text-xs text-slate-600">
          {row.latest_crop_start_date
            ? new Date(row.latest_crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
            : <span className="text-slate-400">—</span>}
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-1 flex-wrap">
            {alerts.length === 0 ? (
              <span className="text-slate-400 text-xs">—</span>
            ) : alerts.map(t => {
              const tc = toneClasses(ALERT_META[t].tone)
              return (
                <span key={t}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${tc.badge}`}>
                  {ALERT_META[t].shortLabel}
                </span>
              )
            })}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td></td>
          <td colSpan={6} className="px-4 py-3">
            {loadingSubs ? (
              <p className="text-xs text-slate-400 italic">Loading subscriptions…</p>
            ) : errorSubs ? (
              <p className="text-xs text-rose-600">{errorSubs}</p>
            ) : !subs || subs.length === 0 ? (
              <p className="text-xs text-slate-500 italic">
                No subscriptions{filterLabel ? ` matching ${filterLabel}` : ''}.
              </p>
            ) : (
              <div className="space-y-2">
                {subs.map(s => (
                  <SubRow key={s.subscription_id} sub={s} onClick={() => onSubClick(s.subscription_id)} />
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}


function SubRow({ sub, onClick }: { sub: FarmerSub; onClick: () => void }) {
  const status = (sub.status || '').toUpperCase()
  const statusCls = sub.is_active
    ? 'bg-emerald-100 text-emerald-800'
    : status === 'CANCELLED' || status === 'UNSUBSCRIBED'
      ? 'bg-rose-100 text-rose-700'
      : status === 'WAITLISTED' ? 'bg-sky-100 text-sky-800'
      : 'bg-slate-200 text-slate-700'
  // Auto-remove chip — only for training crops with a running clock.
  let autoRemoveChip: string | null = null
  if (sub.auto_remove_at) {
    const diffMs = new Date(sub.auto_remove_at).getTime() - Date.now()
    const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000))
    autoRemoveChip = days > 0
      ? `🎓 Auto-removes in ${days}d`
      : '🎓 Clearing shortly'
  }
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left bg-white border border-slate-200 rounded-lg px-3 py-2 hover:border-slate-400 hover:shadow-sm transition">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-slate-800">
          {sub.crop_name || 'Crop'}
        </span>
        <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded ${statusCls}`}>
          {sub.is_active ? 'Active' : status || 'Inactive'}
        </span>
        <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-slate-100 text-slate-700">
          {sub.subscription_type === 'SELF' ? 'Self' : 'Promoter-assigned'}
        </span>
        {sub.matches_filter === true && (
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-amber-100 text-amber-800">
            Filter match
          </span>
        )}
        {autoRemoveChip && (
          <span className="text-[10px] font-medium px-2 py-[1px] rounded-full bg-amber-100 text-amber-900 border border-amber-200">
            {autoRemoveChip}
          </span>
        )}
        {sub.diagnoses_count > 0 && (
          <span className="text-[10px] font-semibold rounded-full px-2 py-[1px] bg-amber-100 text-amber-800">
            D: {sub.diagnoses_count}
          </span>
        )}
        {sub.unanswered_queries_count > 0 && (
          <span className="text-[10px] font-semibold rounded-full px-2 py-[1px] bg-rose-100 text-rose-800">
            Q: {sub.unanswered_queries_count}
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mt-1">
        {sub.package_name || '—'}
        {sub.crop_start_date && (
          <> · Start {new Date(sub.crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</>
        )}
        {sub.promoter_name && <> · Promoter: {sub.promoter_name}</>}
      </p>
    </button>
  )
}
