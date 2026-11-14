'use client'

// Farmer Support View (Phase 2, 2026-11-10) — CRM-style list for the
// CLIENT_RM role (plus CA + CM-EDIT + SA). Alert tiles at the top
// double as one-tap filters. Clicking a farmer row opens the 360°
// view — that page is a Phase 3 placeholder for now.
//
// Design: ~/Downloads/RootsTalk_ClientPortal_FarmerSupport.docx
// Backend endpoints live in clients/router.py (Phase 1 shipped 2026-11-10).
//
// Read-and-remind principle: this page is view-only. There are no
// actions on farmer state from here — the farmer-mutation endpoints
// on the backend refuse non-owner callers anyway, so the UI
// deliberately offers no handles.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'


interface FarmerRow {
  user_id: string
  name: string | null
  phone: string | null
  state_cosh_id: string | null
  // 2026-11-11 — backend now resolves state/district names (first-cohort
  // RM reported seeing truncated cosh_ids like "3b9f56d0…" in the
  // dropdowns). sub_district stays cosh_id-only; the list filter UI
  // doesn't surface it.
  state_name: string | null
  district_cosh_id: string | null
  district_name: string | null
  sub_district_cosh_id: string | null
  latest_subscription_id: string | null
  latest_subscription_status: string | null
  latest_crop_start_date: string | null  // ISO date or null
  active_subscription_count: number
  promoter_name: string | null
}
interface FarmersPage {
  total: number
  page: number
  page_size: number
  rows: FarmerRow[]
}
interface BaseAlertRow {
  subscription_id: string
  farmer_user_id: string  // 2026-11-10 Phase 3 — added backend-side so
                          // per-row badge match is a hard id-match.
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
  MISSING_START_DATE:      { label: 'Missing Start Date',      shortLabel: 'No start date',    tone: 'amber' },
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


export default function FarmerSupportPage() {
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id

  // Filters
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [cropFilter, setCropFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'COMPLETED' | 'NOT_STARTED'>('')
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
  const [loading, setLoading] = useState(true)

  // Alert tile data (counts + farmer_user_id set for cross-referencing)
  const [pendingDates, setPendingDates] = useState<PendingStartDateRow[]>([])
  const [overdueInputs, setOverdueInputs] = useState<OverdueInputRow[]>([])
  const [missedInputs, setMissedInputs] = useState<MissedInputRow[]>([])
  const [overdueQueries, setOverdueQueries] = useState<OverdueExpertQueryRow[]>([])
  const [noActiveSubs, setNoActiveSubs] = useState<NoActiveSubRow[]>([])
  const [alertsLoading, setAlertsLoading] = useState(true)

  // Derived state/district options from the loaded farmer rows so the
  // RM doesn't wade through every geography we support. Same pattern
  // the existing /alerts page uses.
  // Keep (cosh_id, name) pairs so the <option value> stays the id we
  // POST back to the backend, but the LABEL is the human-readable name
  // the RM actually recognises.
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

  const loadFarmers = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (stateFilter) params.set('state_cosh_id', stateFilter)
      if (districtFilter) params.set('district_cosh_id', districtFilter)
      if (cropFilter) params.set('crop_cosh_id', cropFilter)
      if (statusFilter) params.set('subscription_status', statusFilter)
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
    } catch {
      setFarmers({ total: 0, page: 1, page_size: pageSize, rows: [] })
    } finally { setLoading(false) }
  }, [
    clientId, search, stateFilter, districtFilter, cropFilter,
    statusFilter, originFilter, startFrom, startTo,
    sortBy, sortDir, page, pageSize,
  ])

  useEffect(() => { loadAlerts() }, [loadAlerts])
  useEffect(() => { loadFarmers() }, [loadFarmers])

  // When any filter (other than page) changes, reset to page 1 so the
  // user doesn't land on an out-of-range page after narrowing.
  useEffect(() => { setPage(1) },
    [search, stateFilter, districtFilter, cropFilter, statusFilter,
     originFilter, startFrom, startTo, sortBy, sortDir, pageSize, alertType])

  // Alert-type filter is applied in the UI rather than pushed down to
  // the backend: when alertType is set, the rows displayed are the
  // intersection of (full farmer list) ∩ (farmer_user_ids on that
  // alert endpoint). The farmers endpoint is slim; the alert endpoint
  // already returned once as part of the tile summary. No extra
  // round-trip per filter toggle.
  const alertRowsByType: Record<AlertType, BaseAlertRow[]> = {
    MISSING_START_DATE:     pendingDates,
    OVERDUE_INPUT:          overdueInputs,
    MISSED_INPUT:           missedInputs,
    OVERDUE_EXPERT_QUERY:   overdueQueries,
    NO_ACTIVE_SUBSCRIPTION: noActiveSubs,
  }
  // 2026-11-14 — collect the subscription_ids that the alert endpoint
  // emitted PER farmer, so a row click while an alert is active can
  // forward the exact subs that triggered the alert to the 360° view.
  // Previously the 360° view only knew the alert type in the CP's
  // local state → clicking a farmer discarded that context and showed
  // all subs with no indication of which ones triggered the alert.
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
    // 2026-11-10 Phase 3 — alert endpoints now surface
    // farmer_user_id, so the per-row badge match is a hard id-match.
    // (The Phase 2 original matched on name+phone; soft-but-adequate
    // for the sample size we had, but id is the obviously-correct
    // key now that it's available.)
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

  function clearFilters() {
    setSearch(''); setStateFilter(''); setDistrictFilter(''); setCropFilter('')
    setStatusFilter(''); setOriginFilter('')
    setStartFrom(''); setStartTo(''); setAlertType('')
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
              onClick={() => setAlertType(active ? '' : t)}
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

      {/* Filter bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <select value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All subscription status</option>
            <option value="ACTIVE">Active only</option>
            <option value="COMPLETED">Completed only</option>
            <option value="NOT_STARTED">Not started (no start date)</option>
          </select>
          <select value={originFilter}
            onChange={e => setOriginFilter(e.target.value as typeof originFilter)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All origins</option>
            <option value="SELF">Self-subscribed only</option>
            <option value="PROMOTER">Promoter-assigned only</option>
          </select>
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
            Clear all filters
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-center py-16 text-sm text-slate-400">
          No farmers match these filters.
        </p>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Name</th>
                <th className="text-left px-4 py-2.5 font-semibold">Phone</th>
                <th className="text-left px-4 py-2.5 font-semibold">Active subs</th>
                <th className="text-left px-4 py-2.5 font-semibold">Promoter</th>
                <th className="text-left px-4 py-2.5 font-semibold">Latest start</th>
                <th className="text-left px-4 py-2.5 font-semibold">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(r => {
                const alerts = rowAlerts(r)
                // 2026-11-14 — forward the sub-side filters (not
                // farmer/user-side ones like search/state/district)
                // so the 360° view can hide non-matching tabs + pre-
                // select the first match.
                const subFilterQs = new URLSearchParams()
                const labelParts: string[] = []
                if (cropFilter) {
                  subFilterQs.set('crop_cosh_id', cropFilter)
                  labelParts.push('Crop filter')  // no dropdown label here
                }
                if (statusFilter) {
                  subFilterQs.set('subscription_status', statusFilter)
                  const statusLabel = {
                    ACTIVE: 'Status = Active',
                    COMPLETED: 'Status = Completed',
                    NOT_STARTED: 'Status = Not started',
                  }[statusFilter] || statusFilter
                  labelParts.push(statusLabel)
                }
                if (originFilter) {
                  subFilterQs.set('origin', originFilter)
                  labelParts.push(originFilter === 'SELF' ? 'Origin = Self' : 'Origin = Promoter')
                }
                if (startFrom) {
                  subFilterQs.set('start_date_from', startFrom)
                  labelParts.push(`Start ≥ ${startFrom}`)
                }
                if (startTo) {
                  subFilterQs.set('start_date_to', startTo)
                  labelParts.push(`Start ≤ ${startTo}`)
                }
                // 2026-11-14 pm — if an alert tile is active, forward
                // the exact subscription_ids that triggered THIS
                // farmer's alert. Alert signal wins over the broader
                // sub-side filters (per-sub, more specific).
                if (alertType) {
                  const sids = alertSubIdsByFarmer[alertType]?.[r.user_id]
                  if (sids && sids.size > 0) {
                    subFilterQs.set('highlight_subscription_ids', Array.from(sids).join(','))
                    // Alert label overrides the sub-side labels —
                    // backend also prioritises highlight_subscription_ids.
                    labelParts.splice(0, labelParts.length, ALERT_META[alertType].label)
                  }
                }
                // 2026-11-14 pm — pre-formatted label so the 360° view
                // can display WHAT the filter is without re-resolving
                // cosh_ids or inventing its own labels.
                if (labelParts.length > 0) {
                  subFilterQs.set('filter_label', labelParts.join(' · '))
                }
                const qs = subFilterQs.toString()
                const href = `/farmer-support/${r.user_id}${qs ? `?${qs}` : ''}`
                return (
                  <tr key={r.user_id}
                    onClick={() => router.push(href)}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{r.name || <span className="text-slate-400">—</span>}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.phone ? (
                        <a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()}
                          className="text-emerald-700 hover:underline font-mono text-xs">
                          {r.phone}
                        </a>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{r.active_subscription_count}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {r.promoter_name || <span className="text-slate-400 italic">Self</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {r.latest_crop_start_date
                        ? new Date(r.latest_crop_start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
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
