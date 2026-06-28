'use client'
// 2026-06-28 — CA Admin test-data cleanup screen.
//
// Purpose: clients begin training in 5-7 days; staff create practice
// subscriptions that need to be cleared before going live. This is
// the CA-only surface that lists every live subscription for the
// company (all lifecycle states) and lets the admin select + clear
// them via a soft-delete. Decision memo:
// project_rootstalk_ca_admin_test_cleanup_2026_06_27.md.
//
// Soft-delete model:
// - Marked rows stay in the DB carrying `deleted_at`. No purge.
// - The subscription disappears from every other UI surface
//   (farmer PWA, dealer/facilitator/pundit feeds, CA reports). The
//   farmer's User account is NOT touched.
// - In-flight commerce isn't blocked here — we surface warnings via
//   the `in_flight_orders` / `in_flight_queries` badges so the admin
//   sees the consequence before confirming.

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface CleanupRow {
  subscription_id: string
  reference_number: string | null
  status: string
  package_id: string
  package_name: string | null
  crop_name: string | null
  scale_label: string | null
  location: string | null
  farmer_user_id: string
  farmer_name: string | null
  farmer_phone: string | null
  created_at: string
  in_flight_orders: number
  in_flight_queries: number
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'LAPSED' | 'CANCELLED' | 'UNSUBSCRIBED' | 'WAITLISTED' | 'SUSPENDED'

const STATUS_PILL: Record<string, string> = {
  ACTIVE:        'bg-emerald-100 text-emerald-700',
  WAITLISTED:    'bg-blue-100 text-blue-700',
  LAPSED:        'bg-amber-100 text-amber-700',
  CANCELLED:     'bg-red-100 text-red-700',
  UNSUBSCRIBED:  'bg-slate-200 text-slate-700',
  SUSPENDED:     'bg-orange-100 text-orange-700',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function CleanupPage() {
  const client = getClient()
  const clientId = client?.id

  const [rows, setRows] = useState<CleanupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ── Data ──────────────────────────────────────────────────────────
  const load = async () => {
    if (!clientId) return
    setLoading(true); setLoadError(null)
    try {
      const { data } = await api.get<CleanupRow[]>(
        `/admin/client/${clientId}/subscriptions/cleanup`,
      )
      setRows(data)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || 'Failed to load subscriptions.'
      setLoadError(msg)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [clientId])

  // ── Derived ───────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (!q) return true
      const hay = [
        r.reference_number, r.farmer_name, r.farmer_phone,
        r.crop_name, r.package_name, r.location,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, search, statusFilter])

  const allFilteredChecked =
    filteredRows.length > 0 && filteredRows.every(r => selected.has(r.subscription_id))
  const someFilteredChecked =
    filteredRows.some(r => selected.has(r.subscription_id))

  const selectedRows = useMemo(
    () => rows.filter(r => selected.has(r.subscription_id)),
    [rows, selected],
  )
  const selectedInFlightOrders = selectedRows.reduce((s, r) => s + r.in_flight_orders, 0)
  const selectedInFlightQueries = selectedRows.reduce((s, r) => s + r.in_flight_queries, 0)

  // ── Selection helpers ─────────────────────────────────────────────
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allFilteredChecked) {
        for (const r of filteredRows) next.delete(r.subscription_id)
      } else {
        for (const r of filteredRows) next.add(r.subscription_id)
      }
      return next
    })
  }
  function clearSelection() {
    setSelected(new Set())
  }

  // ── Bulk action ───────────────────────────────────────────────────
  async function doSoftDelete() {
    if (!clientId || selected.size === 0) return
    setSubmitting(true); setSubmitError(null)
    try {
      const ids = Array.from(selected)
      const { data } = await api.post<{
        soft_deleted_count: number
        already_deleted_count: number
        skipped_cross_tenant_count: number
      }>(
        `/admin/client/${clientId}/subscriptions/bulk-soft-delete`,
        { subscription_ids: ids },
      )
      setConfirmOpen(false)
      clearSelection()
      const parts = [`${data.soft_deleted_count} cleared`]
      if (data.already_deleted_count > 0) parts.push(`${data.already_deleted_count} already cleared`)
      if (data.skipped_cross_tenant_count > 0) parts.push(`${data.skipped_cross_tenant_count} skipped`)
      setSuccessMsg(parts.join(' · '))
      void load()
      setTimeout(() => setSuccessMsg(null), 5000)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || 'Failed to clear subscriptions.'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Cleanup</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          Clear practice / test subscriptions that staff created during training.
          Cleared subscriptions disappear from every RootsTalk surface — the farmer
          PWA, dealer and facilitator feeds, FarmPundit queues, and your own reports —
          but the rows stay in the database carrying a deletion marker. Farmer
          accounts are not touched.
        </p>
      </div>

      {/* Top controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reference, farmer name / phone, crop, package, location…"
          className="flex-1 min-w-[280px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="WAITLISTED">Waitlisted</option>
          <option value="LAPSED">Lapsed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="UNSUBSCRIBED">Unsubscribed</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      {/* Success/error banners */}
      {successMsg && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {successMsg}
        </div>
      )}
      {loadError && (
        <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-left text-slate-600">
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={allFilteredChecked}
                    ref={el => { if (el) el.indeterminate = !allFilteredChecked && someFilteredChecked }}
                    onChange={toggleAllVisible}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Farmer</th>
                <th className="px-3 py-2 font-medium">Package · Crop</th>
                <th className="px-3 py-2 font-medium">Scale</th>
                <th className="px-3 py-2 font-medium">Location</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">In-flight</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400 text-sm">Loading…</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-12 text-center text-slate-400 text-sm">
                  {rows.length === 0 ? 'No subscriptions yet.' : 'No subscriptions match your filters.'}
                </td></tr>
              ) : filteredRows.map(r => {
                const isChecked = selected.has(r.subscription_id)
                return (
                  <tr
                    key={r.subscription_id}
                    className={`border-t border-slate-100 ${isChecked ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(r.subscription_id)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{r.reference_number || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{r.farmer_name || <span className="italic text-slate-400">unknown</span>}</div>
                      <div className="text-xs text-slate-500">{r.farmer_phone || '—'}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{r.package_name || <span className="italic text-slate-400">no package name</span>}</div>
                      <div className="text-xs text-slate-500">{r.crop_name || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.scale_label || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.location || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatDate(r.created_at)}</td>
                    <td className="px-3 py-2">
                      {r.in_flight_orders + r.in_flight_queries === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <span className="text-xs">
                          {r.in_flight_orders > 0 && <span className="inline-block px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 mr-1">{r.in_flight_orders} orders</span>}
                          {r.in_flight_queries > 0 && <span className="inline-block px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">{r.in_flight_queries} queries</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_PILL[r.status] || 'bg-slate-100 text-slate-600'}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sticky action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-0 left-0 right-0 -mx-6 px-6 py-3 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] flex items-center justify-between">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">{selected.size}</span> selected
            {(selectedInFlightOrders + selectedInFlightQueries) > 0 && (
              <span className="text-amber-700 ml-2">
                · {selectedInFlightOrders + selectedInFlightQueries} in-flight {selectedInFlightOrders + selectedInFlightQueries === 1 ? 'item' : 'items'} will also disappear
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={clearSelection}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Clear selection
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg"
              style={{ background: '#b91c1c' }}
            >
              Clear {selected.size} subscription{selected.size === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4">
            <h2 className="text-lg font-semibold text-slate-800">Clear {selected.size} subscription{selected.size === 1 ? '' : 's'}?</h2>
            <p className="text-sm text-slate-600 mt-2">
              Each cleared subscription disappears from every RootsTalk surface — including
              the farmer's PWA, the dealer / facilitator queues, and your own reports.
              The row stays in the database carrying a deletion marker; the farmer's
              account is not touched.
            </p>
            {(selectedInFlightOrders + selectedInFlightQueries) > 0 && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
                <strong>{selectedInFlightOrders + selectedInFlightQueries}</strong> in-flight item{(selectedInFlightOrders + selectedInFlightQueries) === 1 ? '' : 's'} ({selectedInFlightOrders} order{selectedInFlightOrders === 1 ? '' : 's'}, {selectedInFlightQueries} quer{selectedInFlightQueries === 1 ? 'y' : 'ies'}) will also be hidden. Pending payments and partner pundit response counts are preserved separately.
              </div>
            )}
            {submitError && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {submitError}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => { setConfirmOpen(false); setSubmitError(null) }}
                disabled={submitting}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doSoftDelete}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60"
                style={{ background: '#b91c1c' }}
              >
                {submitting ? 'Clearing…' : `Clear ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
