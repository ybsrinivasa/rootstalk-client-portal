'use client'

// Training Sandbox page — Commit H of the 2026-07-24 build plan.
// CA-only surface for the lifecycle of a training session:
//   - When no session is running: a single "Start Training Session"
//     CTA and a short explainer.
//   - When a session is running: session summary (dates, remaining
//     days, counts of subscriptions / farmers / promoters / orders /
//     queries) plus an "End Session Now" CTA.
//   - Winding-down state renders the same summary but disables Start
//     and warns that the 24h grace is running.
//
// Per the build plan (2026-07-24, "Summary + View Details for V1"),
// this is the *summary* surface. No live activity feed; no
// per-participant drill-down. If CAs ask for a deeper view later,
// a /training/details page can hang off this tile without churning
// the summary shape.
//
// Backend endpoints:
//   GET  /client/{cid}/training/current   — session + counts (or {}).
//   POST /client/{cid}/training/start     — creates the child.
//   POST /client/{cid}/training/end       — HARD close (cascade-deletes now).
//   2026-07-25 — Switched from soft to hard close per team feedback:
//   the DB unique index covers both ACTIVE + WINDING_DOWN, so the
//   old soft-close blocked the CA from starting a fresh session for
//   ~25h. Hard-close runs the cascade synchronously and frees the
//   unique-index slot within seconds. WINDING_DOWN state is now
//   unreachable via the End button (still reachable via the 12-day
//   auto-expiry sweep, which keeps its 24h grace).

import { useCallback, useEffect, useState } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

interface TrainingCounts {
  subscriptions_total: number
  subscriptions_active: number
  farmers: number
  promoters: number
  orders_total: number
  queries_total: number
}

interface TrainingSession {
  id: string
  parent_client_id: string
  display_name: string | null
  primary_colour: string | null
  logo_url: string | null
  training_started_at: string
  training_ends_at: string
  training_status: 'ACTIVE' | 'WINDING_DOWN'
  training_expert_user_id: string | null
  training_dealer_user_id: string | null
  // 2026-08-19 — Backend now hydrates the assigned dealer's display
  // info (name, phone, shop) on the /current read so the CA panel
  // can show more than an opaque "Assigned" badge.
  training_dealer_info?: TrainingDealerInfo | null
  counts: TrainingCounts
}

interface OnboardedExpert {
  user_id: string
  name: string | null
  phone: string | null
}

interface TrainingDealerInfo {
  user_id: string
  name: string | null
  phone: string | null
  shop_name: string | null
  shop_address: string | null
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function daysRemaining(iso: string): number {
  const now = Date.now()
  const target = new Date(iso).getTime()
  const diffMs = target - now
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)))
}

function hoursRemaining(iso: string, graceHours: number = 24): number {
  const now = Date.now()
  const target = new Date(iso).getTime() + graceHours * 60 * 60 * 1000
  const diffMs = target - now
  return Math.max(0, Math.ceil(diffMs / (60 * 60 * 1000)))
}

export default function TrainingSandboxPage() {
  const client = getClient()
  const clientId = client?.id

  const [session, setSession] = useState<TrainingSession | null | undefined>(undefined)
  const [busy, setBusy] = useState<'start' | 'end' | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!clientId) return
    setError('')
    try {
      const { data } = await api.get<Partial<TrainingSession>>(
        `/client/${clientId}/training/current`,
      )
      // Backend returns {} when no session is active.
      if (!data || !data.id) {
        setSession(null)
      } else {
        setSession(data as TrainingSession)
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load training-session state.'))
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const onStart = useCallback(async () => {
    if (!clientId || busy) return
    setBusy('start'); setError('')
    try {
      await api.post(`/client/${clientId}/training/start`, {})
      await load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not start a training session.'))
    } finally {
      setBusy(null)
    }
  }, [clientId, busy, load])

  const onEnd = useCallback(async () => {
    if (!clientId || busy) return
    if (!confirm('End the training session now? All practice subscriptions, orders, and queries under it will be cleared immediately. This cannot be undone.')) return
    setBusy('end'); setError('')
    try {
      await api.post(`/client/${clientId}/training/end`, {})
      await load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not end the training session.'))
    } finally {
      setBusy(null)
    }
  }, [clientId, busy, load])

  if (session === undefined) {
    return <div className="p-6 text-slate-500">Loading…</div>
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Training Sandbox</h1>
        <p className="text-sm text-slate-600 mt-1">
          Run a 12-day practice session for your staff. Promoters can
          invite real farmers into the sandbox; the sandbox uses your
          real advisory content but doesn't affect any real
          subscriptions, orders, allocations, or payments.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {session === null && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 text-center">
          <div className="text-5xl mb-3" aria-hidden>🎓</div>
          <h2 className="font-semibold text-slate-800 text-lg">
            No training session running
          </h2>
          <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
            Start one when your team is ready. The session lasts 12
            days from creation; after that it winds down over 24 hours
            and everything under it (subscriptions, orders, queries)
            is cleared automatically. You can also end it earlier at
            any time — the clear happens immediately.
          </p>
          <button
            onClick={onStart}
            disabled={busy !== null}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold shadow-sm"
          >
            {busy === 'start' ? 'Starting…' : 'Start Training Session'}
          </button>
        </div>
      )}

      {session && (
        <>
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm p-5">
            <div className="flex items-start gap-4">
              <div className="text-4xl" aria-hidden>🎓</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-slate-900">
                    {session.display_name || 'Training session'}
                  </h2>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    session.training_status === 'ACTIVE'
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-orange-200 text-orange-900'
                  }`}>
                    {session.training_status === 'ACTIVE'
                      ? 'ACTIVE'
                      : 'WINDING DOWN'}
                  </span>
                </div>
                <p className="text-xs text-slate-700 mt-1">
                  Started {formatDateTime(session.training_started_at)}
                </p>
                {session.training_status === 'ACTIVE' && (
                  <p className="text-xs text-slate-700 mt-0.5">
                    Ends {formatDateTime(session.training_ends_at)}{' '}
                    · {daysRemaining(session.training_ends_at)} day
                    {daysRemaining(session.training_ends_at) === 1 ? '' : 's'} remaining
                  </p>
                )}
                {session.training_status === 'WINDING_DOWN' && (
                  <p className="text-xs text-orange-800 mt-0.5">
                    Winding down — {hoursRemaining(session.training_ends_at)} hour
                    {hoursRemaining(session.training_ends_at) === 1 ? '' : 's'} until the
                    sandbox is cleared. No new invitations can be sent.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SummaryTile
                label="Farmers in sandbox"
                value={session.counts.farmers}
              />
              <SummaryTile
                label="Promoters participating"
                value={session.counts.promoters}
              />
              <SummaryTile
                label="Subscriptions"
                value={session.counts.subscriptions_total}
                sub={`${session.counts.subscriptions_active} active`}
              />
              <SummaryTile
                label="Orders"
                value={session.counts.orders_total}
              />
              <SummaryTile
                label="Queries"
                value={session.counts.queries_total}
              />
            </div>
          </div>

          {session.training_status === 'ACTIVE' && clientId && (
            <SessionRolesPanel
              clientId={clientId}
              expertUserId={session.training_expert_user_id}
              dealerUserId={session.training_dealer_user_id}
              dealerInfo={session.training_dealer_info ?? null}
              onChanged={load}
            />
          )}

          {session.training_status === 'ACTIVE' && (
            <div className="flex items-center justify-end">
              <button
                onClick={onEnd}
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-900 text-sm font-semibold disabled:opacity-50"
              >
                {busy === 'end' ? 'Ending…' : 'End Session Now'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Session Roles — Training Expert + Training Dealer ────────────────────
//
// Two per-session assignment slots on the training-child row. Both
// are optional. Unset → today's behaviour (queries queue-routed,
// picker shows onboarded dealers only). Set → queries pin to the
// expert; the dealer surfaces in the farmer's picker with a
// "Training" chip. Both clear on session end via the existing
// hard-close cascade.

function SessionRolesPanel({
  clientId,
  expertUserId,
  dealerUserId,
  dealerInfo,
  onChanged,
}: {
  clientId: string
  expertUserId: string | null
  dealerUserId: string | null
  // 2026-08-19 — Hydrated by the backend on /current so the panel
  // renders the dealer's name + phone + shop instead of "Assigned".
  dealerInfo: TrainingDealerInfo | null
  onChanged: () => Promise<void>
}) {
  const [experts, setExperts] = useState<OnboardedExpert[]>([])
  const [expertBusy, setExpertBusy] = useState(false)
  const [expertError, setExpertError] = useState('')

  const [dealerPhone, setDealerPhone] = useState('')
  const [dealerBusy, setDealerBusy] = useState(false)
  const [dealerError, setDealerError] = useState('')

  useEffect(() => {
    api.get<OnboardedExpert[]>(`/client/${clientId}/training/onboarded-experts`)
      .then(r => setExperts(r.data))
      .catch(() => { /* CA sees empty dropdown */ })
  }, [clientId])

  async function setExpert(userId: string) {
    setExpertBusy(true); setExpertError('')
    try {
      await api.post(`/client/${clientId}/training/expert`, { user_id: userId })
      await onChanged()
    } catch (err) {
      setExpertError(extractErrorMessage(err, 'Could not assign training expert.'))
    } finally { setExpertBusy(false) }
  }

  async function clearExpert() {
    setExpertBusy(true); setExpertError('')
    try {
      await api.delete(`/client/${clientId}/training/expert`)
      await onChanged()
    } catch (err) {
      setExpertError(extractErrorMessage(err, 'Could not clear training expert.'))
    } finally { setExpertBusy(false) }
  }

  async function setDealer() {
    const digits = dealerPhone.replace(/\D/g, '')
    if (digits.length < 10) {
      setDealerError('Enter a 10-digit phone number.')
      return
    }
    setDealerBusy(true); setDealerError('')
    try {
      const { data } = await api.post<TrainingSession>(
        `/client/${clientId}/training/dealer`,
        { phone: digits },
      )
      // The POST returns the whole training session; refresh the parent to pick up new ids.
      void data
      await onChanged()
      setDealerPhone('')
      // Prime the info card with what we now know (name is not in
      // that payload, so a follow-up lookup would be needed for
      // richness — deliberately kept lightweight for now).
    } catch (err) {
      setDealerError(extractErrorMessage(err, 'Could not assign training dealer.'))
    } finally { setDealerBusy(false) }
  }

  async function clearDealer() {
    setDealerBusy(true); setDealerError('')
    try {
      await api.delete(`/client/${clientId}/training/dealer`)
      await onChanged()
    } catch (err) {
      setDealerError(extractErrorMessage(err, 'Could not clear training dealer.'))
    } finally { setDealerBusy(false) }
  }

  const currentExpert = experts.find(e => e.user_id === expertUserId)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-slate-800">Session Roles</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Optional per-session assignments. Both clear automatically when the session ends.
        </p>
      </div>

      {/* Training Expert */}
      <div className="border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Training Expert</p>
            <p className="text-xs text-slate-500 mt-0.5">
              All training-farmer queries route directly to this Primary Expert&apos;s device.
            </p>
          </div>
          {expertUserId && (
            <button
              onClick={clearExpert}
              disabled={expertBusy}
              className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50">
              Clear
            </button>
          )}
        </div>
        <select
          value={expertUserId || ''}
          onChange={e => e.target.value && setExpert(e.target.value)}
          disabled={expertBusy || experts.length === 0}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:bg-slate-50">
          <option value="">
            {experts.length === 0 ? 'No active Primary Experts onboarded' : 'Pick a Primary Expert…'}
          </option>
          {experts.map(e => (
            <option key={e.user_id} value={e.user_id}>
              {e.name || e.phone} {e.phone && e.name ? `(${e.phone})` : ''}
            </option>
          ))}
        </select>
        {currentExpert && (
          <p className="text-xs text-emerald-700 mt-1.5">
            ✓ Assigned: {currentExpert.name || currentExpert.phone}
          </p>
        )}
        {expertError && (
          <p className="text-xs text-rose-600 mt-1.5">{expertError}</p>
        )}
      </div>

      {/* Training Dealer */}
      <div className="border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">Training Dealer</p>
            <p className="text-xs text-slate-500 mt-0.5">
              A dummy dealer for this training session — the farmer&apos;s picker will show only this dealer for training orders. Must be active on RootsTalk with a shop profile, and not already onboarded by your company as a real dealer.
            </p>
          </div>
          {dealerUserId && (
            <button
              onClick={clearDealer}
              disabled={dealerBusy}
              className="text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50">
              Clear
            </button>
          )}
        </div>
        {dealerUserId && (
          <div className="mb-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 space-y-0.5">
            <p className="font-semibold">
              ✓ Assigned{dealerInfo?.name ? `: ${dealerInfo.name}` : ''}
              {dealerInfo?.phone ? ` · ${dealerInfo.phone}` : ''}
            </p>
            {(dealerInfo?.shop_name || dealerInfo?.shop_address) && (
              <p className="text-emerald-800">
                {dealerInfo.shop_name}
                {dealerInfo.shop_name && dealerInfo.shop_address ? ' · ' : ''}
                {dealerInfo.shop_address}
              </p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="tel"
            inputMode="numeric"
            value={dealerPhone}
            onChange={e => setDealerPhone(e.target.value)}
            placeholder="10-digit phone number"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
          />
          <button
            onClick={setDealer}
            disabled={dealerBusy || dealerPhone.replace(/\D/g, '').length < 10}
            className="px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-semibold disabled:opacity-50">
            {dealerBusy ? '…' : (dealerUserId ? 'Replace' : 'Assign')}
          </button>
        </div>
        {dealerError && (
          <p className="text-xs text-rose-600 mt-1.5">{dealerError}</p>
        )}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
      <p className="text-2xl font-bold text-slate-900 tabular-nums">
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-slate-600 mt-0.5">{label}</p>
      {sub && (
        <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>
      )}
    </div>
  )
}
