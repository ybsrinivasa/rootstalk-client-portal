'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'

// RM-facing list of nearby contacts (facilitators + dealers + company
// promoters) at the sub's effective client. Purpose: let the RM scan
// "who's around" before considering any assignment change (which is a
// separate v2 mutation surface — this panel is purely read).

type PromoterType = 'FACILITATOR' | 'DEALER' | 'COMPANY_DESIGNATED'

interface Contact {
  user_id: string
  name: string | null
  phone: string | null
  promoter_type: PromoterType | string
  is_promoter_pundit: boolean
  distance_km: number | null
  gps_lat: number | null
  gps_lng: number | null
  address_line: string | null
  state_name: string | null
  district_name: string | null
  sub_district_name: string | null
}
interface Payload {
  farmer_has_gps: boolean
  contacts: Contact[]
}

const TYPE_LABEL: Record<string, string> = {
  FACILITATOR: 'Facilitator',
  DEALER: 'Dealer',
  COMPANY_DESIGNATED: 'Company designated',
}
const TYPE_TONE: Record<string, string> = {
  FACILITATOR: 'bg-emerald-100 text-emerald-800',
  DEALER: 'bg-sky-100 text-sky-800',
  COMPANY_DESIGNATED: 'bg-slate-200 text-slate-700',
}

function joinAddr(c: Contact): string {
  const parts = [
    c.address_line,
    c.sub_district_name,
    c.district_name,
    c.state_name,
  ].filter(Boolean)
  return parts.join(', ') || '—'
}

export default function NearbyContactsPanel({
  clientId,
  farmerUserId,
  subscriptionId,
}: {
  clientId: string
  farmerUserId: string
  subscriptionId: string
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<'ALL' | PromoterType>('ALL')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    api.get<Payload>(
      `/client/${clientId}/farmer-support/farmers/${farmerUserId}/subscriptions/${subscriptionId}/nearby-contacts`,
    )
      .then(r => { if (!cancelled) setData(r.data) })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { detail?: string } }; message?: string }
        if (!cancelled) setError(err?.response?.data?.detail || err?.message || 'Failed to load contacts.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId, farmerUserId, subscriptionId])

  if (loading) return <p className="text-xs text-slate-400 italic">Loading nearby contacts…</p>
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!data) return null

  const filtered = typeFilter === 'ALL'
    ? data.contacts
    : data.contacts.filter(c => c.promoter_type === typeFilter)

  const countBy = (t: PromoterType) => data.contacts.filter(c => c.promoter_type === t).length

  return (
    <div className="space-y-3">
      {!data.farmer_has_gps && (
        <p className="text-[11px] text-amber-700 italic">
          Farmer has no GPS on file — distances are not shown. Contacts are still listed.
        </p>
      )}
      {data.contacts.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No onboarded contacts at this client.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 text-[11px]">
            <button type="button"
              onClick={() => setTypeFilter('ALL')}
              className={`px-2 py-0.5 rounded-full border ${
                typeFilter === 'ALL' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 hover:border-slate-500'
              }`}>
              All ({data.contacts.length})
            </button>
            {(['FACILITATOR', 'DEALER', 'COMPANY_DESIGNATED'] as PromoterType[]).map(t => {
              const n = countBy(t)
              if (n === 0) return null
              return (
                <button key={t} type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-2 py-0.5 rounded-full border ${
                    typeFilter === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 hover:border-slate-500'
                  }`}>
                  {TYPE_LABEL[t]} ({n})
                </button>
              )
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left px-2 py-2">Name</th>
                  <th className="text-left px-2 py-2">Role</th>
                  <th className="text-left px-2 py-2">Distance</th>
                  <th className="text-left px-2 py-2">Phone</th>
                  <th className="text-left px-2 py-2">Address</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.user_id} className="border-b border-slate-50">
                    <td className="px-2 py-2 font-medium text-slate-800">
                      {c.name || '—'}
                      {c.is_promoter_pundit && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-violet-100 text-violet-800">
                          Promoter-Pundit
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        TYPE_TONE[c.promoter_type] || 'bg-slate-100 text-slate-700'
                      }`}>
                        {TYPE_LABEL[c.promoter_type] || c.promoter_type}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {c.distance_km != null ? `${c.distance_km} km` : <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline font-mono text-[11px]">
                          {c.phone}
                        </a>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-2 text-slate-600 text-[11px]">
                      {joinAddr(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
