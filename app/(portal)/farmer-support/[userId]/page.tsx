'use client'

// Farmer Support 360° View (Phase 3, 2026-11-10).
// Design: ~/Downloads/RootsTalk_ClientPortal_FarmerSupport.docx §4.
// Backend: clients/router.py farmer-support/farmers/{uid}/* endpoints.
//
// Persistent header (name, phone, village, crops) always visible as
// the RM scrolls. Below it, a subscription tab bar (active first);
// clicking a tab loads the four sections for that sub in parallel:
//   1. Input Tracking (first; "Due Now" panel surfaces the critical
//      follow-up signals at the very top of the section)
//   2. Practice Timeline — past / current / upcoming
//   3. Pest Diagnoses
//   4. Expert Queries
//   5. Call Log (Phase 4 stub)
//
// Everything is read-only. The farmer-mutation endpoints already
// refuse non-owner callers, so this UI deliberately offers no
// handles — "read and remind, not act".

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient, getUser, hasPortalRole } from '@/lib/auth'


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
  package_id: string
  package_name: string | null
  crop_cosh_id: string | null
  crop_name: string | null
  crop_start_date: string | null
  created_at: string | null
  promoter_name: string | null
  farm_area_acres: number | null
  number_of_plants: number | null
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
  purchased_at: string | null
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
  const params = useParams<{ userId: string }>()
  const client = getClient()
  const clientId = client?.id
  const userId = params?.userId

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
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null)
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
  const [logOpen, setLogOpen] = useState(false)
  const [logType, setLogType] = useState<'OUTBOUND' | 'INBOUND'>('OUTBOUND')
  const [logDate, setLogDate] = useState<string>('')  // YYYY-MM-DD
  const [logTime, setLogTime] = useState<string>('')  // HH:mm
  const [logBusy, setLogBusy] = useState(false)
  const [logErr, setLogErr] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId || !userId) return
    setLoading(true); setError(null)
    Promise.all([
      api.get<FarmerHeader>(`/client/${clientId}/farmer-support/farmers/${userId}`),
      api.get<SubscriptionRow[]>(`/client/${clientId}/farmer-support/farmers/${userId}/subscriptions`),
    ])
      .then(([h, s]) => {
        setHeader(h.data)
        setSubs(s.data)
        setSelectedSubId(prev => prev || s.data[0]?.subscription_id || null)
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
  }, [clientId, userId])

  const loadSubDetails = useCallback(async (subId: string) => {
    if (!clientId || !userId) return
    setSubLoading(true)
    const base = `/client/${clientId}/farmer-support/farmers/${userId}/subscriptions/${subId}`
    try {
      const [p, d, q, i] = await Promise.all([
        api.get<PracticeRow[]>(`${base}/practices`).catch(() => ({ data: [] })),
        api.get<DiagnosisRow[]>(`${base}/diagnoses`).catch(() => ({ data: [] })),
        api.get<QueryRow[]>(`${base}/queries`).catch(() => ({ data: [] })),
        api.get<InputsPayload>(`${base}/inputs`).catch(() => ({ data: { due_now: [], all: [] } })),
      ])
      setPractices(p.data as PracticeRow[])
      setDiagnoses(d.data as DiagnosisRow[])
      setQueries(q.data as QueryRow[])
      setInputs(i.data as InputsPayload)
    } finally { setSubLoading(false) }
  }, [clientId, userId])

  useEffect(() => {
    if (selectedSubId) loadSubDetails(selectedSubId)
  }, [selectedSubId, loadSubDetails])

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
        { call_type: logType, call_at: callAt },
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
      ) : (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            {subs.map(s => {
              const active = s.subscription_id === selectedSubId
              return (
                <button key={s.subscription_id}
                  onClick={() => setSelectedSubId(s.subscription_id)}
                  className={`text-left rounded-xl border-2 px-4 py-3 text-xs transition ${
                    active
                      ? 'bg-slate-800 border-slate-800 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                  }`}>
                  <p className="font-semibold">
                    {s.crop_name || 'Crop'}
                    {s.is_active && <span className="ml-2 text-[10px] uppercase tracking-wider">Active</span>}
                  </p>
                  <p className={`text-[11px] ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                    {s.package_name || '—'} · Start {fmtDate(s.crop_start_date)}
                  </p>
                </button>
              )
            })}
          </div>

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
                              <th className="text-left px-2 py-2">Input practice</th>
                              <th className="text-left px-2 py-2">Window</th>
                              <th className="text-left px-2 py-2">Status</th>
                              <th className="text-left px-2 py-2">Purchased brand</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inputs.all.map(r => {
                              const meta = INPUT_STATUS_META[r.status]
                              return (
                                <tr key={`${r.practice_id}-${r.timeline_id}`} className="border-b border-slate-50">
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
                                  </td>
                                  <td className="px-2 py-2 text-slate-700">
                                    {r.purchased_brand_text || <span className="text-slate-400">—</span>}
                                  </td>
                                </tr>
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
                ) : practices.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No practices on this subscription.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-2 py-2">Practice</th>
                          <th className="text-left px-2 py-2">Window</th>
                          <th className="text-left px-2 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {practices.map(p => {
                          const meta = PRACTICE_STATUS_META[p.status]
                          return (
                            <tr key={`${p.practice_id}-${p.timeline_id}`} className="border-b border-slate-50">
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
                ) : diagnoses.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No diagnoses raised on this subscription.</p>
                ) : (
                  <ul className="space-y-2">
                    {diagnoses.map(d => (
                      <li key={d.session_id} className="border-l-2 border-slate-200 pl-3 text-xs">
                        <p className="text-slate-500">{fmtDate(d.created_at)}</p>
                        <p className="font-medium text-slate-800">
                          {d.diagnosed_problem_name || <span className="text-slate-400">(unresolved)</span>}
                        </p>
                        {d.plant_part_name && (
                          <p className="text-slate-500">Observed on: {d.plant_part_name}</p>
                        )}
                      </li>
                    ))}
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
