'use client'
import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

// 2026-07-08 — Payload rewritten to carry location + crop context so
// the RM can act on the alert without leaving the page.
interface BaseAlertRow {
  subscription_id: string
  subscription_ref: string | null
  farmer_name: string | null
  farmer_phone: string | null
  state_cosh_id: string | null
  state_name: string | null
  district_cosh_id: string | null
  district_name: string | null
  crop_cosh_id: string | null
  crop_name: string | null
  crop_measure: 'AREA_WISE' | 'PLANT_WISE' | null
  farm_area_acres: number | null
  number_of_plants: number | null
}
interface PendingStartDate extends BaseAlertRow {
  subscribed_at: string | null
}
interface OverdueInput extends BaseAlertRow {
  crop_start_date: string | null
  computed_crop_age: { value: number; unit: string; is_minimum?: boolean } | null
  day_offset: number
  timeline_name: string
}

function CropMeasure({ row }: { row: BaseAlertRow }) {
  if (row.crop_measure === 'PLANT_WISE' && row.number_of_plants != null) {
    return <>{row.number_of_plants.toLocaleString()} plants</>
  }
  if (row.farm_area_acres != null) {
    return <>{row.farm_area_acres.toLocaleString()} acres</>
  }
  return <>—</>
}

function LocationCell({ row }: { row: BaseAlertRow }) {
  if (!row.state_name && !row.district_name) return <span className="text-slate-400">—</span>
  return (
    <div className="text-xs text-slate-600 leading-tight">
      {row.district_name && <div>{row.district_name}</div>}
      {row.state_name && <div className="text-slate-400">{row.state_name}</div>}
    </div>
  )
}

function CropAge({ age }: { age: OverdueInput['computed_crop_age'] }) {
  if (!age) return <>—</>
  return (
    <>
      {age.is_minimum ? '> ' : ''}{age.value} {age.unit}
    </>
  )
}

export default function AlertsPage() {
  const client = getClient()
  const clientId = client?.id

  const [tab, setTab] = useState<'start_date' | 'inputs'>('start_date')
  const [pendingDates, setPendingDates] = useState<PendingStartDate[]>([])
  const [overdueInputs, setOverdueInputs] = useState<OverdueInput[]>([])
  const [loading, setLoading] = useState(true)
  const [stateFilter, setStateFilter] = useState<string>('')  // state_cosh_id
  const [districtFilter, setDistrictFilter] = useState<string>('')  // district_cosh_id

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

  // Filter options derived from whichever tab is active — only surface
  // states/districts that actually appear in the current alert list, so
  // the RM doesn't wade through every state we support.
  const rowsForFilter: BaseAlertRow[] = tab === 'start_date' ? pendingDates : overdueInputs
  const stateOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rowsForFilter) {
      if (r.state_cosh_id && r.state_name) seen.set(r.state_cosh_id, r.state_name)
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [rowsForFilter])
  const districtOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rowsForFilter) {
      if (r.district_cosh_id && r.district_name) {
        if (stateFilter && r.state_cosh_id !== stateFilter) continue
        seen.set(r.district_cosh_id, r.district_name)
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [rowsForFilter, stateFilter])

  function matchesFilter(r: BaseAlertRow): boolean {
    if (stateFilter && r.state_cosh_id !== stateFilter) return false
    if (districtFilter && r.district_cosh_id !== districtFilter) return false
    return true
  }

  const visiblePending = pendingDates.filter(matchesFilter)
  const visibleOverdue = overdueInputs.filter(matchesFilter)

  function clearFilters() { setStateFilter(''); setDistrictFilter('') }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
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

      {/* Filters — only render when there's something to filter by. */}
      {!loading && rowsForFilter.length > 0 && stateOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filter:</span>
          <select
            value={stateFilter}
            onChange={e => { setStateFilter(e.target.value); setDistrictFilter('') }}
            className="text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">All states</option>
            {stateOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            value={districtFilter}
            onChange={e => setDistrictFilter(e.target.value)}
            disabled={districtOptions.length === 0}
            className="text-sm bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">All districts</option>
            {districtOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          {(stateFilter || districtFilter) && (
            <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-800 underline">
              Clear
            </button>
          )}
          <span className="text-xs text-slate-400">
            {tab === 'start_date'
              ? `Showing ${visiblePending.length} of ${pendingDates.length}`
              : `Showing ${visibleOverdue.length} of ${overdueInputs.length}`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'start_date' ? (
        visiblePending.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
            <span className="text-3xl">✅</span>
            <p className="text-slate-500 text-sm mt-3">
              {pendingDates.length === 0
                ? 'All active farmers have set their start dates.'
                : 'No farmers match the current filter.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
              <p className="text-xs text-amber-700 font-medium">
                These farmers have ACTIVE subscriptions but haven&apos;t set their sowing date yet. Advisory won&apos;t start until they do.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Farmer</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Location</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Crop</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Area / Plants</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Subscription</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Subscribed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visiblePending.map(f => (
                    <tr key={f.subscription_id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5 font-medium text-slate-800">{f.farmer_name || '—'}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600">{f.farmer_phone || '—'}</td>
                      <td className="px-5 py-3.5"><LocationCell row={f} /></td>
                      <td className="px-5 py-3.5 text-slate-700">{f.crop_name || '—'}</td>
                      <td className="px-5 py-3.5 text-slate-600 text-xs"><CropMeasure row={f} /></td>
                      <td className="px-5 py-3.5 font-mono text-[11px] text-slate-500">{f.subscription_ref || '—'}</td>
                      <td className="px-5 py-3.5 text-slate-400 text-xs">
                        {f.subscribed_at ? new Date(f.subscribed_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        visibleOverdue.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
            <span className="text-3xl">✅</span>
            <p className="text-slate-500 text-sm mt-3">
              {overdueInputs.length === 0
                ? 'No overdue inputs today. All active farmers have orders in progress.'
                : 'No farmers match the current filter.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-red-50 border-b border-red-100">
              <p className="text-xs text-red-700 font-medium">
                These farmers have input practices due today but no active order for that timeline. Follow up with their dealer or facilitator.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Farmer</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Location</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Crop</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Area / Plants</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Start</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Age</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Subscription</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Day</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {visibleOverdue.map(f => (
                    <tr key={f.subscription_id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5 font-medium text-slate-800">{f.farmer_name || '—'}</td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600">{f.farmer_phone || '—'}</td>
                      <td className="px-5 py-3.5"><LocationCell row={f} /></td>
                      <td className="px-5 py-3.5 text-slate-700">{f.crop_name || '—'}</td>
                      <td className="px-5 py-3.5 text-slate-600 text-xs"><CropMeasure row={f} /></td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs">
                        {f.crop_start_date ? new Date(f.crop_start_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs"><CropAge age={f.computed_crop_age} /></td>
                      <td className="px-5 py-3.5 text-slate-600 text-xs">{f.timeline_name}</td>
                      <td className="px-5 py-3.5 font-mono text-[11px] text-slate-500">{f.subscription_ref || '—'}</td>
                      <td className="px-5 py-3.5 text-right text-slate-400 text-xs">Day +{f.day_offset}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}
