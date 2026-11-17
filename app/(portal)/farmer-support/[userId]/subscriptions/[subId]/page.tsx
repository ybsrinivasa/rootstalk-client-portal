'use client'

// Farmer Support — per-subscription detail page (Bundle B, 2026-11-16).
// Successor to the farmer-360° view. Route:
// /farmer-support/[userId]/subscriptions/[subId]. Pinned to one
// subscription — the RM navigates here by clicking a sub row on the
// collapsible list page.
//
// Carries EVERY section the old farmer-360° had, scoped to this sub:
//   1. Farmer header (name, phone, village, crops)
//   2. Who-follows-up strip + mutation controls (alert receiver,
//      promoter-pundit, follow-up promoter)
//   3. Nearby contacts panel + map
//   4. Input Tracking (with "Due Now" panel)
//   5. Practice Timeline
//   6. Pest Diagnoses
//   7. Expert Queries
//   8. Call Log — "Log a call" stamps subscription_id = this sub.
//
// The farmer-level roll-up that used to switch between subs is gone
// — this page is one sub, always. Back-navigation returns to the
// list with the farmer row re-expanded.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient, getUser, hasPortalRole } from '@/lib/auth'
import type {
  FarmerPin, FacilitatorPin,
} from '@/components/farmer-support/FacilitatorMap'

// Leaflet touches `window`; ssr:false keeps it out of the server bundle.
const FacilitatorMap = dynamic(
  () => import('@/components/farmer-support/FacilitatorMap'),
  { ssr: false, loading: () => (
    <div className="w-full h-72 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
      Loading map…
    </div>
  ) },
)
const RecommendationPanel = dynamic(
  () => import('@/components/farmer-support/RecommendationPanel'),
  { ssr: false, loading: () => (
    <div className="p-4 text-xs text-slate-400 italic">Loading recommendation…</div>
  ) },
)
const NearbyContactsPanel = dynamic(
  () => import('@/components/farmer-support/NearbyContactsPanel'),
  { ssr: false, loading: () => (
    <p className="text-xs text-slate-400 italic">Loading nearby contacts…</p>
  ) },
)

interface NearbyPayload {
  farmer: FarmerPin | { user_id: string; name: string | null; phone: string | null; gps_lat: null; gps_lng: null }
  facilitators: FacilitatorPin[]
  reason: string | null
}


interface FarmerHeader {
  user_id: string
  name: string | null
  phone: string | null
  state_name: string | null
  district_name: string | null
  sub_district_name: string | null
  crops: Array<{ crop_cosh_id: string; crop_name: string | null }>
}
interface SubscriptionRow {
  subscription_id: string
  status: string
  is_active: boolean
  // 2026-11-14 pt7 — gates the Follow-up Promoter radio column in
  // the Nearby Contacts panel. Only 'SELF' subs can get a Follow-up
  // Promoter in v3; 'ASSIGNED' subs already have a signup promoter.
  subscription_type: 'SELF' | 'ASSIGNED'
  package_id: string
  package_name: string | null
  crop_cosh_id: string | null
  crop_name: string | null
  crop_start_date: string | null
  created_at: string | null
  promoter_name: string | null
  // 2026-11-17 — Immutable signup attribution. Equal to promoter_name
  // on untouched ASSIGNED subs; diverges once the RM reassigns via
  // Follow-up Promoter. NULL on SELF subs. UI surfaces "Signup: X"
  // alongside "Follow-up: Y" when they differ.
  signup_promoter_user_id: string | null
  signup_promoter_name: string | null
  farm_area_acres: number | null
  number_of_plants: number | null
  // 2026-11-12 — tab badges + follow-up strip.
  diagnoses_count: number
  unanswered_queries_count: number
  alert_receiver: {
    user_id: string
    name: string | null
    phone: string | null
    gps_lat: number | null
    gps_lng: number | null
  } | null
  promoter_pundit: {
    user_id: string
    name: string | null
    phone: string | null
  } | null
  // 2026-11-14 pt7 — RM-delegated Follow-up Promoter on SELF subs.
  // Populated only when subscription_type=SELF AND a promoter_user_id
  // is set (via the RM mutation). ASSIGNED subs leave this null.
  followup_promoter: {
    user_id: string
    name: string | null
    phone: string | null
  } | null
  // 2026-11-14 — null when no filter was passed in the URL; true/false
  // when a filter is active. CP highlights matching tabs + pre-selects
  // the first match so the RM lands directly on a sub of interest.
  matches_filter: boolean | null
}
interface PracticeRow {
  practice_id: string
  practice_name: string | null
  l0_type: string | null
  l1_type: string | null
  l2_type: string | null
  timeline_id: string
  timeline_name: string | null
  window_start: string | null
  window_end: string | null
  status: 'COMPLETED' | 'SKIPPED' | 'MISSED' | 'CURRENT' | 'UPCOMING'
  marked_at: string | null
  hidden_at: string | null
}
interface DiagnosisRow {
  session_id: string
  created_at: string | null
  diagnosed_problem_cosh_id: string | null
  diagnosed_problem_name: string | null
  plant_part_cosh_id: string | null
  plant_part_name: string | null
  status: string
}
interface QueryRow {
  query_id: string
  title: string | null
  severity: string | null
  status: string
  ui_status: 'ANSWERED' | 'PENDING' | 'OVERDUE' | 'CLOSED'
  created_at: string | null
  assigned_to: string | null
  response_text: string | null
  response_at: string | null
  sla_hours: number
}
interface InputRow {
  practice_id: string
  practice_name: string | null
  l1_type: string | null
  l2_type: string | null
  timeline_id: string
  timeline_name: string | null
  window_start: string | null
  window_end: string | null
  status: 'PURCHASED' | 'ORDERED' | 'DUE_NOW' | 'UPCOMING' | 'MISSED' | 'NOT_REQUIRED'
  // 2026-11-13 — purchased_via distinguishes the three signals that
  // can mark a row Purchased so the UI can show pickup date / "farmer
  // tapped bought" / "accepted dealer offer" context.
  purchased_via: 'ack' | 'order_pickup' | 'order_approved' | null
  purchased_at: string | null
  picked_up_at: string | null
  purchased_brand_text: string | null
  purchased_brand_cosh_id: string | null
}
interface InputsPayload {
  due_now: InputRow[]
  all: InputRow[]
}
interface CallLogEntry {
  id: string
  call_type: 'OUTBOUND' | 'INBOUND'
  call_at: string | null
  logged_by_user_id: string
  logged_by_name: string | null
  // Bundle B (2026-11-16) — the sub this call was logged against.
  // NULL for pre-Bundle-B rows (farmer-level only) + calls logged
  // without picking a sub. The UI tags matching rows with a chip.
  subscription_id: string | null
  created_at: string | null
}
interface CallLogPayload {
  total: number
  outbound_count: number
  inbound_count: number
  rows: CallLogEntry[]
}


const INPUT_STATUS_META: Record<InputRow['status'], { label: string; cls: string }> = {
  PURCHASED:    { label: 'Purchased',     cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  ORDERED:      { label: 'Ordered',       cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  DUE_NOW:      { label: 'Due now',       cls: 'bg-red-100 text-red-800 border-red-300' },
  UPCOMING:     { label: 'Upcoming',      cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  MISSED:       { label: 'Missed',        cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  NOT_REQUIRED: { label: 'Not required',  cls: 'bg-slate-50 text-slate-500 border-slate-200' },
}
const PRACTICE_STATUS_META: Record<PracticeRow['status'], { label: string; cls: string }> = {
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800' },
  SKIPPED:   { label: 'Skipped',   cls: 'bg-slate-100 text-slate-500' },
  MISSED:    { label: 'Missed',    cls: 'bg-orange-100 text-orange-800' },
  CURRENT:   { label: 'Current',   cls: 'bg-blue-100 text-blue-800' },
  UPCOMING:  { label: 'Upcoming',  cls: 'bg-slate-100 text-slate-700' },
}
const QUERY_STATUS_META: Record<QueryRow['ui_status'], { label: string; cls: string }> = {
  ANSWERED: { label: 'Answered', cls: 'bg-emerald-100 text-emerald-800' },
  PENDING:  { label: 'Pending',  cls: 'bg-amber-100 text-amber-800' },
  OVERDUE:  { label: 'Overdue',  cls: 'bg-red-100 text-red-800' },
  CLOSED:   { label: 'Closed',   cls: 'bg-slate-100 text-slate-500' },
}


function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return iso }
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}


export default function FarmerSupportDetailPage() {
  const params = useParams<{ userId: string; subId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id
  const userId = params?.userId
  // Bundle B (2026-11-16) — page is pinned to this sub. URL is the
  // single source of truth; no tab-switcher mutates it. "Back to list"
  // preserves filter state via the query-string we preserve below.
  const subId = params?.subId
  void router

  // Preserve the list-page filter in the URL so "Back" lands the RM
  // back on the exact filter + scroll state they came from. We don't
  // forward subscription_id filters to the farmer fetch anymore — the
  // page is pinned to one sub. Only `filter_label` matters here, and
  // only as decoration on the back-link.
  const filterLabel = searchParams?.get('filter_label') || null

  // 2026-11-10 Phase 4 — gate the "Log a Call" button to users who
  // can actually log. Backend 403s anyone else; we hide the button so
  // CAs (who can VIEW the log) aren't tempted by a control that will
  // only error. `is_cm_for_this_client` covers CM-EDIT SSO users;
  // CLIENT_RM covers the primary audience.
  const currentUser = getUser()
  const canLog = !!(
    currentUser?.is_cm_for_this_client
    || hasPortalRole(currentUser, 'CLIENT_RM')
  )

  const [header, setHeader] = useState<FarmerHeader | null>(null)
  const [subs, setSubs] = useState<SubscriptionRow[]>([])
  // Bundle B — page is pinned to the URL's subId. No setter; stays
  // the whole lifetime of this page.
  const selectedSubId = subId || null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-tab data for the selected subscription
  const [practices, setPractices] = useState<PracticeRow[]>([])
  const [diagnoses, setDiagnoses] = useState<DiagnosisRow[]>([])
  const [queries, setQueries] = useState<QueryRow[]>([])
  const [inputs, setInputs] = useState<InputsPayload>({ due_now: [], all: [] })
  const [subLoading, setSubLoading] = useState(false)

  // Call log is per-FARMER not per-subscription, so it loads at the
  // farmer level and survives subscription-tab switching.
  const [callLog, setCallLog] = useState<CallLogPayload>({
    total: 0, outbound_count: 0, inbound_count: 0, rows: [],
  })
  const [callLogLoading, setCallLogLoading] = useState(true)

  // 2026-11-14 pt4 — counter bumped after a mutation that affects
  // the sub row (e.g. Alert Receiver change) so the subs-fetch
  // useEffect refires and selectedSub.alert_receiver reflects the
  // new state.
  const [subsReloadKey, setSubsReloadKey] = useState(0)

  // 2026-11-14 — per-row expand state for recommendation panels on
  // Input Tracking + Practice Timeline. Key = `${practice_id}-${timeline_id}`
  // so an occurrence_id collision across sections doesn't bleed.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  function toggleRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Map of farmer + nearby facilitators — lazy-loaded per sub when
  // the RM asks for it. Payload is cached by subscription_id so
  // toggling the map off/on doesn't refetch; switching subs resets.
  const [mapBySub, setMapBySub] = useState<Record<string, NearbyPayload>>({})
  const [mapOpenSubId, setMapOpenSubId] = useState<string | null>(null)
  const [mapLoadingSubId, setMapLoadingSubId] = useState<string | null>(null)
  const [mapErr, setMapErr] = useState<string | null>(null)

  // Nearby-contacts panel open state (per sub, same rationale as the
  // map). 2026-11-14 pt 1 — read-only list of all nearby onboarded
  // contacts (facilitators + dealers + company-designated promoters)
  // with distance, phone, address. v2 may add RM-assignment mutations.
  const [contactsOpenSubId, setContactsOpenSubId] = useState<string | null>(null)
  function toggleContacts(subId: string) {
    setContactsOpenSubId(prev => (prev === subId ? null : subId))
  }

  const [logOpen, setLogOpen] = useState(false)
  const [logType, setLogType] = useState<'OUTBOUND' | 'INBOUND'>('OUTBOUND')
  const [logDate, setLogDate] = useState<string>('')  // YYYY-MM-DD
  const [logTime, setLogTime] = useState<string>('')  // HH:mm
  const [logBusy, setLogBusy] = useState(false)
  const [logErr, setLogErr] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId || !userId) return
    setLoading(true); setError(null)
    // Bundle B — fetch the farmer header + the full subs list (no
    // filter — we want to know whether the pinned sub exists, and
    // the filter forwarded from the list page would hide it when the
    // RM arrived via an alert-tile shortcut). The subs array is still
    // used below for the follow-up strip's `selectedSub` lookup.
    const subsUrl = `/client/${clientId}/farmer-support/farmers/${userId}/subscriptions`
    Promise.all([
      api.get<FarmerHeader>(`/client/${clientId}/farmer-support/farmers/${userId}`),
      api.get<SubscriptionRow[]>(subsUrl),
    ])
      .then(([h, s]) => {
        setHeader(h.data)
        setSubs(s.data)
      })
      .catch((e: unknown) => {
        // 2026-11-11 — surface the backend status + detail so we can
        // tell 404 (gate) apart from 500 (handler crash) apart from
        // network issues. Earlier generic message was useless when
        // the user reported "farmer IS subscribed but I see 'may not
        // be subscribed'" — need signal, not a fallback.
        const err = e as {
          response?: {
            status?: number
            data?: { detail?: string | { message?: string } }
          }
          message?: string
        }
        const status = err?.response?.status
        const detail = err?.response?.data?.detail
        const detailMsg = typeof detail === 'object' ? detail?.message : (detail as string)
        if (status === 404) {
          setError(`Backend 404: ${detailMsg || 'Farmer not found'} (farmer_user_id ${userId}). If this farmer DOES have subscriptions with your company, the client_id on the subscription row may differ from the one your session is bound to — ask ops to check.`)
        } else if (status) {
          setError(`Backend ${status}: ${detailMsg || err.message || 'unknown error'}`)
        } else {
          setError(`Network error: ${err?.message || 'could not reach the backend'}`)
        }
      })
      .finally(() => setLoading(false))
    // subsReloadKey lets children (NearbyContactsPanel's Alert
    // Receiver mutation) force a refetch of the subs array so the
    // follow-up strip reflects the new state immediately.
  }, [clientId, userId, subsReloadKey])

  // 2026-11-11 — per-section error state so a 500 on any of the four
  // per-sub endpoints surfaces instead of silently rendering "empty".
  // Earlier .catch(() => ({data: []})) made a backend crash look
  // indistinguishable from a legitimately-empty section.
  const [practicesErr, setPracticesErr] = useState<string | null>(null)
  const [diagnosesErr, setDiagnosesErr] = useState<string | null>(null)
  const [queriesErr, setQueriesErr] = useState<string | null>(null)
  const [inputsErr, setInputsErr] = useState<string | null>(null)

  const loadSubDetails = useCallback(async (subId: string) => {
    if (!clientId || !userId) return
    setSubLoading(true)
    setPracticesErr(null); setDiagnosesErr(null); setQueriesErr(null); setInputsErr(null)
    const base = `/client/${clientId}/farmer-support/farmers/${userId}/subscriptions/${subId}`
    const extract = (e: unknown): string => {
      const err = e as { response?: { status?: number; data?: { detail?: string | { message?: string } } }; message?: string }
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      const detailMsg = typeof detail === 'object' ? detail?.message : (detail as string)
      if (status) return `Backend ${status}: ${detailMsg || err.message || 'unknown error'}`
      return `Network error: ${err?.message || 'could not reach the backend'}`
    }
    const [pRes, dRes, qRes, iRes] = await Promise.allSettled([
      api.get<PracticeRow[]>(`${base}/practices`),
      api.get<DiagnosisRow[]>(`${base}/diagnoses`),
      api.get<QueryRow[]>(`${base}/queries`),
      api.get<InputsPayload>(`${base}/inputs`),
    ])
    if (pRes.status === 'fulfilled') setPractices(pRes.value.data); else { setPractices([]); setPracticesErr(extract(pRes.reason)) }
    if (dRes.status === 'fulfilled') setDiagnoses(dRes.value.data); else { setDiagnoses([]); setDiagnosesErr(extract(dRes.reason)) }
    if (qRes.status === 'fulfilled') setQueries(qRes.value.data); else { setQueries([]); setQueriesErr(extract(qRes.reason)) }
    if (iRes.status === 'fulfilled') setInputs(iRes.value.data); else { setInputs({ due_now: [], all: [] }); setInputsErr(extract(iRes.reason)) }
    setSubLoading(false)
  }, [clientId, userId])

  useEffect(() => {
    if (selectedSubId) loadSubDetails(selectedSubId)
  }, [selectedSubId, loadSubDetails])

  // Switching subs collapses any open map / contacts panel so the RM
  // doesn't see stale data next to a different sub's "Who follows up".
  useEffect(() => {
    setMapOpenSubId(prev => (prev && prev !== selectedSubId ? null : prev))
    setContactsOpenSubId(prev => (prev && prev !== selectedSubId ? null : prev))
  }, [selectedSubId])

  const toggleMap = useCallback(async (subId: string) => {
    setMapErr(null)
    if (mapOpenSubId === subId) {
      setMapOpenSubId(null)
      return
    }
    setMapOpenSubId(subId)
    if (mapBySub[subId]) return  // cached
    if (!clientId || !userId) return
    setMapLoadingSubId(subId)
    try {
      const { data } = await api.get<NearbyPayload>(
        `/client/${clientId}/farmer-support/farmers/${userId}/subscriptions/${subId}/nearby-facilitators`,
      )
      setMapBySub(prev => ({ ...prev, [subId]: data }))
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      setMapErr(err?.response?.data?.detail || err?.message || 'Failed to load map data.')
    } finally {
      setMapLoadingSubId(null)
    }
  }, [clientId, userId, mapOpenSubId, mapBySub])

  const loadCallLog = useCallback(async () => {
    if (!clientId || !userId) return
    setCallLogLoading(true)
    try {
      const { data } = await api.get<CallLogPayload>(
        `/client/${clientId}/farmer-support/farmers/${userId}/call-log`,
      )
      setCallLog(data)
    } catch {
      // Keep whatever we had; log stays empty on first load failure.
    } finally { setCallLogLoading(false) }
  }, [clientId, userId])

  useEffect(() => { loadCallLog() }, [loadCallLog])

  function openLogModal() {
    // Default date/time = now (local) so the common case is a one-tap
    // save. Retrospective entries override before submit.
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    setLogDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
    setLogTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
    setLogType('OUTBOUND')
    setLogErr(null)
    setLogOpen(true)
  }

  async function submitLog() {
    if (!clientId || !userId) return
    setLogBusy(true); setLogErr(null)
    try {
      // Combine the date + time inputs into a local ISO string;
      // backend normalises to UTC.
      const callAt = logDate && logTime ? `${logDate}T${logTime}:00` : undefined
      await api.post(
        `/client/${clientId}/farmer-support/farmers/${userId}/call-log`,
        // Bundle B — stamp subscription_id so the call is attributed
        // to this sub. Backend validates it belongs to this farmer.
        { call_type: logType, call_at: callAt, subscription_id: selectedSubId },
      )
      setLogOpen(false)
      await loadCallLog()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = err?.response?.data?.detail
      const msg = typeof detail === 'object' ? detail?.message : (detail as string)
      setLogErr(msg || 'Could not log the call.')
    } finally { setLogBusy(false) }
  }

  const selectedSub = useMemo(
    () => subs.find(s => s.subscription_id === selectedSubId) || null,
    [subs, selectedSubId],
  )

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    )
  }
  if (error || !header) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <Link href="/farmer-support" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to Farmer Support
        </Link>
        <div className="bg-white border border-red-200 rounded-xl p-8 mt-4 text-center">
          <p className="text-sm text-red-600">{error || 'Farmer not found.'}</p>
        </div>
      </div>
    )
  }

  const locationBits = [header.sub_district_name, header.district_name, header.state_name].filter(Boolean)
  const cropNames = header.crops.map(c => c.crop_name || c.crop_cosh_id).filter(Boolean).join(' · ')

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-4">
        <Link href="/farmer-support" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to Farmer Support
        </Link>
      </div>

      {/* Persistent farmer header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5 sticky top-0 z-10 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{header.name || 'Unnamed farmer'}</h1>
            <div className="text-sm text-slate-600 mt-1 flex items-center gap-3 flex-wrap">
              {header.phone ? (
                <a href={`tel:${header.phone}`}
                  className="text-emerald-700 hover:underline font-mono">
                  📞 {header.phone}
                </a>
              ) : <span className="text-slate-400">no phone</span>}
              {locationBits.length > 0 && (
                <span className="text-slate-500">· {locationBits.join(' · ')}</span>
              )}
            </div>
            {cropNames && (
              <p className="text-xs text-slate-500 mt-1">Crops: {cropNames}</p>
            )}
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {header.user_id.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Subscription tabs */}
      {subs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          This farmer has no subscriptions with your company.
        </div>
      ) : !selectedSub ? (
        /* Bundle B — pinned sub not in this farmer's list. Could be a
           typo in the URL, a soft-deleted training sub, or a farmer
           swap. Show a clear error with a back link rather than
           crashing. */
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Subscription not found for this farmer.</p>
          <p className="text-xs mt-1 text-amber-800">
            It may have been removed or re-assigned. Go back to the Farmer Support
            list to pick another.
          </p>
          <button
            type="button"
            onClick={() => router.push('/farmer-support')}
            className="mt-2 text-amber-900 underline hover:no-underline text-xs font-semibold">
            Back to Farmer Support
          </button>
        </div>
      ) : (
        <>
          {/* Bundle B (2026-11-16) — single-sub header. Replaces the
              previous subscription-tab bar; the RM arrived here by
              clicking one sub on the list page. */}
          <div className="mb-4 flex items-start gap-3 flex-wrap bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-slate-900">
                {selectedSub.crop_name || 'Crop'}
                {selectedSub.is_active && <span className="ml-2 text-[10px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-emerald-100 text-emerald-800">Active</span>}
                {!selectedSub.is_active && (
                  <span className={`ml-2 text-[10px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded ${
                    (selectedSub.status || '').toUpperCase() === 'CANCELLED' ? 'bg-rose-100 text-rose-700'
                    : (selectedSub.status || '').toUpperCase() === 'UNSUBSCRIBED' ? 'bg-rose-100 text-rose-700'
                    : (selectedSub.status || '').toUpperCase() === 'WAITLISTED' ? 'bg-sky-100 text-sky-800'
                    : 'bg-slate-200 text-slate-700'
                  }`}>
                    {(selectedSub.status || 'Inactive').toUpperCase()}
                  </span>
                )}
                {(selectedSub.subscription_type) && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-slate-200 text-slate-700">
                    {selectedSub.subscription_type === 'SELF' ? 'Self-subscribed' : 'Promoter-assigned'}
                  </span>
                )}
                {(selectedSub.diagnoses_count > 0) && (
                  <span className="ml-2 inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-semibold bg-amber-100 text-amber-800">
                    D: {selectedSub.diagnoses_count}
                  </span>
                )}
                {(selectedSub.unanswered_queries_count > 0) && (
                  <span className="ml-2 inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-semibold bg-rose-100 text-rose-800">
                    Q: {selectedSub.unanswered_queries_count}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {selectedSub.package_name || '—'} · Start {fmtDate(selectedSub.crop_start_date)}
              </p>
              <p className="font-mono text-[10px] text-slate-400 mt-0.5">
                ID {selectedSub.subscription_id.slice(0, 8)}
                {filterLabel && (
                  <span className="ml-2 text-amber-700 not-italic">
                    · came from filter: {filterLabel}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push('/farmer-support')}
              className="text-xs text-slate-600 hover:text-slate-900 hover:underline font-semibold">
              ← Back to list
            </button>
          </div>
          {/* Who follows up — alert receiver + Promoter-Pundit for the
              active sub, with a toggleable mini-map that plots the
              farmer (red) + current alert receiver (blue) + other
              onboarded facilitators (grey/purple/teal by role) so
              the RM can judge relative distance before calling.
              2026-11-14 — strip always renders (even for SELF-subscribed
              subs with no alert_receiver / no Promoter-Pundit) so the
              Show-map affordance is available for every sub. */}
          {selectedSub && (() => {
            const mapOpen = mapOpenSubId === selectedSub.subscription_id
            const mapLoading = mapLoadingSubId === selectedSub.subscription_id
            const mapData = mapBySub[selectedSub.subscription_id]
            const hasContacts = !!(selectedSub.alert_receiver || selectedSub.promoter_pundit)
            return (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Who follows up
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleMap(selectedSub.subscription_id)}
                    className="text-[11px] text-blue-700 hover:text-blue-900 hover:underline font-semibold">
                    {mapOpen ? 'Hide map' : 'Show map'}
                  </button>
                </div>
                {!hasContacts && (
                  <p className="text-slate-500 italic mb-1">
                    No alert receiver or Promoter-Pundit assigned on this subscription
                    {' '}(likely a self-subscribed sub). Open the map to see nearby facilitators.
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                  {selectedSub.alert_receiver && (
                    <div>
                      <p className="text-[10px] text-slate-500">Alert receiver</p>
                      <p className="font-semibold text-slate-800">
                        {selectedSub.alert_receiver.name || '—'}
                        {selectedSub.alert_receiver.phone && (
                          <>
                            {' · '}
                            <a href={`tel:${selectedSub.alert_receiver.phone}`}
                               className="text-blue-700 hover:underline">
                              {selectedSub.alert_receiver.phone}
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  )}
                  {selectedSub.promoter_pundit && (
                    <div>
                      <p className="text-[10px] text-slate-500">Promoter-Pundit</p>
                      <p className="font-semibold text-slate-800">
                        {selectedSub.promoter_pundit.name || '—'}
                        {selectedSub.promoter_pundit.phone && (
                          <>
                            {' · '}
                            <a href={`tel:${selectedSub.promoter_pundit.phone}`}
                               className="text-blue-700 hover:underline">
                              {selectedSub.promoter_pundit.phone}
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  )}
                  {/* 2026-11-17 — Signup Promoter attribution. Shown
                      on ASSIGNED subs where an RM has reassigned a
                      Follow-up Promoter (promoter_user_id has diverged
                      from the original). Not shown on SELF subs (no
                      signup promoter) or on untouched ASSIGNED subs
                      (would duplicate the Follow-up Promoter display). */}
                  {selectedSub.signup_promoter_user_id
                    && selectedSub.followup_promoter
                    && selectedSub.signup_promoter_user_id !== selectedSub.followup_promoter.user_id && (
                    <div>
                      <p className="text-[10px] text-slate-500">Signup promoter</p>
                      <p className="font-semibold text-slate-600 line-through decoration-slate-400">
                        {selectedSub.signup_promoter_name || '—'}
                      </p>
                      <p className="text-[10px] text-slate-500 italic">
                        no longer serving
                      </p>
                    </div>
                  )}
                </div>
                {mapOpen && (
                  <div className="mt-3">
                    {mapLoading && (
                      <p className="text-[11px] text-slate-400 italic">Loading map…</p>
                    )}
                    {mapErr && (
                      <p className="text-[11px] text-red-600">{mapErr}</p>
                    )}
                    {!mapLoading && mapData && mapData.farmer.gps_lat != null && mapData.farmer.gps_lng != null && (
                      <>
                        <FacilitatorMap
                          farmer={mapData.farmer as FarmerPin}
                          facilitators={mapData.facilitators}
                        />
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block"></span>
                            Farmer
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
                            Alert receiver
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-violet-600 inline-block"></span>
                            Promoter-Pundit
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block"></span>
                            Promoter
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block"></span>
                            Other facilitator
                          </span>
                          <span className="italic text-slate-400">
                            Hover a pin for name · role · distance · phone
                          </span>
                        </div>
                      </>
                    )}
                    {!mapLoading && mapData && (mapData.farmer.gps_lat == null || mapData.farmer.gps_lng == null) && (
                      <p className="text-[11px] text-slate-500 italic">
                        {mapData.reason === 'farmer_gps_missing'
                          ? "Can't show map — this farmer has no GPS location on file."
                          : "Can't show map — farmer record not found."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* 2026-11-14 pt 1 — collapsible panel listing all ACTIVE
              ClientPromoter contacts (facilitators + dealers +
              company-designated) at this sub's effective client, with
              distance from farmer + phone + address. Read-only; v2
              will add assign-as-alert-receiver / assign-as-PP / etc.
              Lazy-loaded on expand. */}
          {selectedSub && (() => {
            const open = contactsOpenSubId === selectedSub.subscription_id
            return (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4 text-xs">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Nearby promoters &amp; dealers
                  </p>
                  <button type="button"
                    onClick={() => toggleContacts(selectedSub.subscription_id)}
                    className="text-[11px] text-blue-700 hover:text-blue-900 hover:underline font-semibold">
                    {open ? 'Hide list' : 'Show list'}
                  </button>
                </div>
                {open && clientId && (
                  <div className="mt-3">
                    <NearbyContactsPanel
                      clientId={clientId}
                      farmerUserId={userId as string}
                      subscriptionId={selectedSub.subscription_id}
                      currentAlertReceiverUserId={selectedSub.alert_receiver?.user_id || null}
                      currentAlertReceiverName={selectedSub.alert_receiver?.name || null}
                      currentAlertReceiverPhone={selectedSub.alert_receiver?.phone || null}
                      currentPromoterPunditUserId={selectedSub.promoter_pundit?.user_id || null}
                      currentPromoterPunditName={selectedSub.promoter_pundit?.name || null}
                      currentPromoterPunditPhone={selectedSub.promoter_pundit?.phone || null}
                      currentFollowupPromoterUserId={selectedSub.followup_promoter?.user_id || null}
                      currentFollowupPromoterName={selectedSub.followup_promoter?.name || null}
                      currentFollowupPromoterPhone={selectedSub.followup_promoter?.phone || null}
                      subscriptionIsSelfSubscribed={selectedSub.subscription_type === 'SELF'}
                      canAssignAlertReceiver={canLog}
                      onReceiverChanged={() => setSubsReloadKey(k => k + 1)}
                    />
                  </div>
                )}
              </div>
            )
          })()}

          {/* Selected subscription detail */}
          {selectedSub && (
            <div className="space-y-5">
              {/* Section 4.5: Input Tracking (first — operational heart) */}
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Input tracking
                </h2>
                {subLoading ? (
                  <p className="text-xs text-slate-400">Loading…</p>
                ) : inputsErr ? (
                  <p className="text-xs text-red-600">{inputsErr}</p>
                ) : (
                  <>
                    {inputs.due_now.length > 0 && (
                      <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-4">
                        <p className="text-xs font-bold text-red-800 uppercase tracking-wider mb-2">
                          ⚠ {inputs.due_now.length} input{inputs.due_now.length === 1 ? '' : 's'} due now · no order placed
                        </p>
                        <ul className="space-y-1">
                          {inputs.due_now.map(r => (
                            <li key={`${r.practice_id}-${r.timeline_id}`} className="text-sm text-slate-800">
                              <strong>{r.practice_name || '—'}</strong>
                              <span className="text-slate-600">
                                {' '}· {r.timeline_name || '—'} · Due {fmtDate(r.window_end)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs text-red-700 mt-2 italic">
                          Action: call the farmer and follow up with their dealer or facilitator.
                        </p>
                      </div>
                    )}
                    {inputs.all.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No input practices on this subscription.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                            <tr>
                              <th className="w-6"></th>
                              <th className="text-left px-2 py-2">Input practice</th>
                              <th className="text-left px-2 py-2">Window</th>
                              <th className="text-left px-2 py-2">Status</th>
                              <th className="text-left px-2 py-2">Purchased brand</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inputs.all.map(r => {
                              const meta = INPUT_STATUS_META[r.status]
                              const rowKey = `${r.practice_id}-${r.timeline_id}`
                              const expanded = expandedRows.has(rowKey)
                              return (
                                <React.Fragment key={rowKey}>
                                <tr className="border-b border-slate-50 cursor-pointer hover:bg-slate-50"
                                    onClick={() => toggleRow(rowKey)}>
                                  <td className="px-2 py-2 text-slate-400 text-center">
                                    {expanded ? '▾' : '▸'}
                                  </td>
                                  <td className="px-2 py-2 font-medium text-slate-800">
                                    {r.practice_name || '—'}
                                    <span className="text-slate-400 text-[10px] block">{r.timeline_name}</span>
                                  </td>
                                  <td className="px-2 py-2 text-slate-600">
                                    {fmtDate(r.window_start)} – {fmtDate(r.window_end)}
                                  </td>
                                  <td className="px-2 py-2">
                                    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-semibold ${meta.cls}`}>
                                      {meta.label}
                                    </span>
                                    {/* Second line explains which signal fired so the RM can
                                        tell "farmer tapped buy" from "in-app order picked up"
                                        from "accepted dealer offer but not yet picked up". */}
                                    {r.status === 'PURCHASED' && r.purchased_via === 'order_pickup' && r.picked_up_at && (
                                      <span className="text-[10px] text-slate-500 block mt-0.5">
                                        Picked up {fmtDate(r.picked_up_at)}
                                      </span>
                                    )}
                                    {r.status === 'PURCHASED' && r.purchased_via === 'order_approved' && (
                                      <span className="text-[10px] text-slate-500 block mt-0.5 italic">
                                        Order approved · pickup pending
                                      </span>
                                    )}
                                    {r.status === 'PURCHASED' && r.purchased_via === 'ack' && r.purchased_at && (
                                      <span className="text-[10px] text-slate-500 block mt-0.5">
                                        Marked {fmtDate(r.purchased_at)}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-2 text-slate-700">
                                    {r.purchased_brand_text || <span className="text-slate-400">—</span>}
                                  </td>
                                </tr>
                                {expanded && clientId && selectedSubId && (
                                  <tr>
                                    <td colSpan={5} className="px-2 pb-3">
                                      <RecommendationPanel
                                        clientId={clientId}
                                        farmerUserId={userId as string}
                                        subscriptionId={selectedSubId}
                                        practiceId={r.practice_id}
                                      />
                                    </td>
                                  </tr>
                                )}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Section 4.2: Practice Timeline */}
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Practice timeline
                </h2>
                {subLoading ? (
                  <p className="text-xs text-slate-400">Loading…</p>
                ) : practicesErr ? (
                  <p className="text-xs text-red-600">{practicesErr}</p>
                ) : practices.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No practices on this subscription.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="w-6"></th>
                          <th className="text-left px-2 py-2">Practice</th>
                          <th className="text-left px-2 py-2">Window</th>
                          <th className="text-left px-2 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {practices.map(p => {
                          const meta = PRACTICE_STATUS_META[p.status]
                          const rowKey = `pt-${p.practice_id}-${p.timeline_id}`
                          const expanded = expandedRows.has(rowKey)
                          return (
                            <React.Fragment key={rowKey}>
                            <tr className="border-b border-slate-50 cursor-pointer hover:bg-slate-50"
                                onClick={() => toggleRow(rowKey)}>
                              <td className="px-2 py-2 text-slate-400 text-center">
                                {expanded ? '▾' : '▸'}
                              </td>
                              <td className="px-2 py-2">
                                <p className="font-medium text-slate-800">{p.practice_name || '—'}</p>
                                <span className="text-slate-400 text-[10px]">
                                  {p.timeline_name}{p.l0_type ? ` · ${p.l0_type}` : ''}
                                </span>
                              </td>
                              <td className="px-2 py-2 text-slate-600">
                                {fmtDate(p.window_start)} – {fmtDate(p.window_end)}
                              </td>
                              <td className="px-2 py-2">
                                <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${meta.cls}`}>
                                  {meta.label}
                                </span>
                              </td>
                            </tr>
                            {expanded && clientId && selectedSubId && (
                              <tr>
                                <td colSpan={4} className="px-2 pb-3">
                                  <RecommendationPanel
                                    clientId={clientId}
                                    farmerUserId={userId as string}
                                    subscriptionId={selectedSubId}
                                    practiceId={p.practice_id}
                                  />
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Section 4.3: Pest Diagnoses */}
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Pest diagnoses
                </h2>
                {subLoading ? (
                  <p className="text-xs text-slate-400">Loading…</p>
                ) : diagnosesErr ? (
                  <p className="text-xs text-red-600">{diagnosesErr}</p>
                ) : diagnoses.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No diagnoses raised on this subscription.</p>
                ) : (
                  <ul className="space-y-2">
                    {diagnoses.map(d => {
                      // 2026-11-11 — OUTSIDE_LIST = farmer completed
                      // the flow but the catalog had no match → got
                      // pointed at the expert path. Call it out so
                      // the RM knows this is a "needs follow-up"
                      // signal, not a resolved diagnosis.
                      const isOutside = d.status === 'OUTSIDE_LIST'
                      return (
                        <li key={d.session_id}
                          className={`border-l-4 pl-3 text-xs ${
                            isOutside ? 'border-amber-400' : 'border-slate-200'
                          }`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-slate-500">{fmtDate(d.created_at)}</p>
                            {isOutside && (
                              <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
                                Outside catalogue · expert needed
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-slate-800 mt-0.5">
                            {d.diagnosed_problem_name || (
                              isOutside
                                ? <span className="text-slate-500 italic">Problem not in RootsTalk catalogue — farmer was shown the expert path</span>
                                : <span className="text-slate-400">(unresolved)</span>
                            )}
                          </p>
                          {d.plant_part_name && (
                            <p className="text-slate-500">Observed on: {d.plant_part_name}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {/* Section 4.4: Expert Queries */}
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">
                  Expert queries
                </h2>
                {subLoading ? (
                  <p className="text-xs text-slate-400">Loading…</p>
                ) : queriesErr ? (
                  <p className="text-xs text-red-600">{queriesErr}</p>
                ) : queries.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No expert queries on this subscription.</p>
                ) : (
                  <ul className="space-y-2">
                    {queries.map(q => {
                      const meta = QUERY_STATUS_META[q.ui_status]
                      return (
                        <li key={q.query_id}
                          className={`border-l-4 pl-3 text-xs ${
                            q.ui_status === 'OVERDUE' ? 'border-red-400' : 'border-slate-200'
                          }`}>
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-slate-500">{fmtDateTime(q.created_at)}</p>
                            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${meta.cls}`}>
                              {meta.label}
                            </span>
                            {q.assigned_to && (
                              <span className="text-slate-500">Assigned: {q.assigned_to}</span>
                            )}
                          </div>
                          <p className="font-medium text-slate-800 mt-0.5">{q.title || '—'}</p>
                          {q.response_text && (
                            <p className="italic text-slate-600 mt-1 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                              {q.response_text}
                              {q.response_at && (
                                <span className="text-slate-400 text-[10px] ml-2">— {fmtDateTime(q.response_at)}</span>
                              )}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {/* Section 4.6: Call Log — per-farmer, not per-sub, so
                  it's rendered once at the bottom of the detail stack
                  regardless of which subscription tab is active. */}
              <section className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                      Call log
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {callLog.total === 0
                        ? 'No calls logged yet with this farmer.'
                        : `${callLog.total} call${callLog.total === 1 ? '' : 's'} recorded — ${callLog.outbound_count} outbound · ${callLog.inbound_count} inbound`}
                    </p>
                  </div>
                  {canLog && (
                    <button onClick={openLogModal}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                      + Log a call
                    </button>
                  )}
                </div>
                {callLogLoading ? (
                  <p className="text-xs text-slate-400">Loading…</p>
                ) : callLog.rows.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    {canLog
                      ? 'Tap "Log a call" after your next conversation with this farmer.'
                      : 'Only the Relationship Manager role can add entries here.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {callLog.rows.map(c => (
                      <li key={c.id} className="py-2 text-xs flex items-center gap-2 flex-wrap">
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          c.call_type === 'OUTBOUND'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {c.call_type === 'OUTBOUND' ? 'Outbound' : 'Inbound'}
                        </span>
                        <span className="text-slate-700">{fmtDateTime(c.call_at)}</span>
                        <span className="text-slate-500">· Logged by {c.logged_by_name || '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-slate-400 mt-3 italic">
                  Log entries are permanent — they can&apos;t be edited or deleted. Keeps the contact
                  history reliable across RM handoffs.
                </p>
              </section>
            </div>
          )}
        </>
      )}

      {/* "Log a call" modal — rendered outside the sub-details so it
          stays open across tab switches. */}
      {logOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !logBusy && setLogOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-1">Log a call</h3>
            <p className="text-xs text-slate-500 mb-4">
              With {header.name || 'this farmer'}. Logged by{' '}
              <strong className="text-slate-700">{currentUser?.name || '—'}</strong>.
            </p>

            <label className="block text-xs font-semibold text-slate-700 mb-1">Call type</label>
            <div className="flex gap-2 mb-3">
              {(['OUTBOUND', 'INBOUND'] as const).map(t => (
                <button key={t} onClick={() => setLogType(t)}
                  className={`flex-1 text-xs py-2 rounded-lg border-2 font-semibold ${
                    logType === t
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}>
                  {t === 'OUTBOUND' ? 'I called the farmer (Outbound)' : 'Farmer called me (Inbound)'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                <input type="date" value={logDate}
                  onChange={e => setLogDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Time</label>
                <input type="time" value={logTime}
                  onChange={e => setLogTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            {logErr && (
              <p className="text-xs text-red-600 mb-3">{logErr}</p>
            )}

            <div className="flex gap-2">
              <button onClick={() => setLogOpen(false)} disabled={logBusy}
                className="flex-1 text-sm py-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitLog} disabled={logBusy || !logDate || !logTime}
                className="flex-1 text-sm py-2 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
                {logBusy ? 'Saving…' : 'Save log'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-3 italic">
              Permanent — this entry can&apos;t be edited or deleted after saving.
            </p>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-6 text-center">
        <strong>Read and remind, not act.</strong> No practice can be marked, no purchase
        recorded, no query answered from this view — those actions remain with the farmer.
      </p>
    </div>
  )
}
