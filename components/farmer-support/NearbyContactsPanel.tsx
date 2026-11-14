'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'

// RM-facing list of nearby contacts (facilitators + dealers + company
// promoters) at the sub's effective client. Purpose: let the RM scan
// "who's around" before considering any assignment change (which is a
// separate v2 mutation surface — this panel is purely read).

type PromoterType = 'FACILITATOR' | 'DEALER'
// 2026-11-14 pt2 — filter chips are orthogonal: a Facilitator can
// also be a Promoter, so these aren't a disjoint partition. Each
// chip represents a BOOLEAN capability the RM might want to pick
// from (with counts inclusive).
type RoleFilter = 'ALL' | 'FACILITATOR' | 'DEALER' | 'PROMOTER' | 'PROMOTER_PUNDIT'

interface Contact {
  user_id: string
  name: string | null
  phone: string | null
  promoter_types: PromoterType[]
  is_promoter: boolean
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
}
const TYPE_TONE: Record<string, string> = {
  FACILITATOR: 'bg-emerald-100 text-emerald-800',
  DEALER: 'bg-sky-100 text-sky-800',
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
  const [typeFilter, setTypeFilter] = useState<RoleFilter>('ALL')

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

  // Filter predicates — each chip expresses one capability, and
  // they're inclusive (a Facilitator-who-is-also-Promoter matches
  // both the Facilitator chip AND the Promoter chip). Counts shown
  // on each chip reflect how many contacts would match that chip.
  function matches(c: Contact, f: RoleFilter): boolean {
    switch (f) {
      case 'ALL': return true
      case 'FACILITATOR': return c.promoter_types.includes('FACILITATOR')
      case 'DEALER': return c.promoter_types.includes('DEALER')
      case 'PROMOTER': return c.is_promoter
      case 'PROMOTER_PUNDIT': return c.is_promoter_pundit
    }
  }
  const filtered = data.contacts.filter(c => matches(c, typeFilter))
  const countBy = (f: RoleFilter) => data.contacts.filter(c => matches(c, f)).length

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
            {(['ALL', 'FACILITATOR', 'DEALER', 'PROMOTER', 'PROMOTER_PUNDIT'] as RoleFilter[]).map(f => {
              const n = countBy(f)
              if (f !== 'ALL' && n === 0) return null
              const label = f === 'ALL' ? 'All'
                : f === 'FACILITATOR' ? 'Facilitator'
                : f === 'DEALER' ? 'Dealer'
                : f === 'PROMOTER' ? 'Promoter'
                : 'Promoter-Pundit'
              return (
                <button key={f} type="button"
                  onClick={() => setTypeFilter(f)}
                  className={`px-2 py-0.5 rounded-full border ${
                    typeFilter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 hover:border-slate-500'
                  }`}>
                  {label} ({n})
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
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.promoter_types.map(t => (
                          <span key={t}
                            className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              TYPE_TONE[t] || 'bg-slate-100 text-slate-700'
                            }`}>
                            {TYPE_LABEL[t] || t}
                          </span>
                        ))}
                        {c.is_promoter && (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
                            Promoter
                          </span>
                        )}
                        {c.is_promoter_pundit && (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold bg-violet-100 text-violet-800">
                            Promoter-Pundit
                          </span>
                        )}
                      </div>
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
