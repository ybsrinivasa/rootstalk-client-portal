'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface PendingStartDate {
  subscription_id: string; farmer_name: string | null; farmer_phone: string | null
  package_id: string; subscribed_at: string | null
}
interface OverdueInput {
  subscription_id: string; farmer_name: string | null; farmer_phone: string | null
  day_offset: number; timeline_name: string; package_id: string
}

export default function AlertsPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'start_date' | 'inputs'>('start_date')
  const [pendingDates, setPendingDates] = useState<PendingStartDate[]>([])
  const [overdueInputs, setOverdueInputs] = useState<OverdueInput[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      api.get<PendingStartDate[]>(`/client/${clientId}/alerts/pending-start-dates`).catch(() => ({ data: [] as PendingStartDate[] })),
      api.get<OverdueInput[]>(`/client/${clientId}/alerts/overdue-inputs`).catch(() => ({ data: [] as OverdueInput[] })),
    ]).then(([a, b]) => {
      setPendingDates(a.data)
      setOverdueInputs(b.data)
    }).finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Alerts</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Farmers who need attention — missing start dates or overdue input orders
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <p className="text-3xl font-bold text-amber-700">{loading ? '…' : pendingDates.length}</p>
          <p className="text-amber-600 text-sm mt-1">Missing start dates</p>
          <p className="text-amber-500 text-xs mt-0.5">Farmers yet to set sowing date</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
          <p className="text-3xl font-bold text-red-600">{loading ? '…' : overdueInputs.length}</p>
          <p className="text-red-500 text-sm mt-1">Overdue inputs</p>
          <p className="text-red-400 text-xs mt-0.5">Input practices due with no order</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['start_date', 'inputs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'start_date' ? `Missing Start Date (${pendingDates.length})` : `Overdue Inputs (${overdueInputs.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'start_date' ? (
        pendingDates.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
            <span className="text-3xl">✅</span>
            <p className="text-slate-500 text-sm mt-3">All active farmers have set their start dates.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
              <p className="text-xs text-amber-700 font-medium">
                These farmers have ACTIVE subscriptions but haven't set their sowing date yet. Advisory won't start until they do.
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Farmer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Phone</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Subscribed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingDates.map(f => (
                  <tr key={f.subscription_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{f.farmer_name || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600 hidden sm:table-cell">{f.farmer_phone || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs hidden sm:table-cell">
                      {f.subscribed_at ? new Date(f.subscribed_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        overdueInputs.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
            <span className="text-3xl">✅</span>
            <p className="text-slate-500 text-sm mt-3">No overdue inputs today. All active farmers have orders in progress.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-red-50 border-b border-red-100">
              <p className="text-xs text-red-700 font-medium">
                These farmers have input practices due today but no active order. Follow up with their dealer or facilitator.
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Farmer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Phone</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {overdueInputs.map(f => (
                  <tr key={f.subscription_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{f.farmer_name || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600 hidden sm:table-cell">{f.farmer_phone || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-600 text-xs">{f.timeline_name}</td>
                    <td className="px-5 py-3.5 text-right text-slate-400 text-xs hidden sm:table-cell">Day +{f.day_offset}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
