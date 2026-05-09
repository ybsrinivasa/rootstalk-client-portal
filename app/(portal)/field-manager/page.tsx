'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Promoter {
  id: string; user_id: string; name: string | null; phone: string | null
  promoter_type: string; status: string; territory_notes: string | null; registered_at: string
}
interface Farmer {
  user_id: string; name: string | null; phone: string | null
  subscription_id: string; package_id: string; subscription_status: string
}

export default function FieldManagerPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'dealers' | 'facilitators' | 'farmers'>('dealers')
  const [dealers, setDealers] = useState<Promoter[]>([])
  const [facilitators, setFacilitators] = useState<Promoter[]>([])
  const [farmers, setFarmers] = useState<Farmer[]>([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [addingType, setAddingType] = useState<'DEALER' | 'FACILITATOR'>('DEALER')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  // V1.1 Item 3 (2026-05-09): the modal collects phone first; user
  // identity comes from the lookup payload, not from FM input. The
  // FM enters territory_notes after the user is recognised.
  const [addForm, setAddForm] = useState({ phone: '', territory_notes: '' })

  interface DealerProfilePreview {
    shop_name: string | null
    shop_address: string | null
    sell_categories: string[]
    shop_photo_url: string | null
    shop_registration_url: string | null
    pesticide_licence_url: string | null
    fertiliser_licence_url: string | null
    shop_gps_lat: number | null
    shop_gps_lng: number | null
  }
  interface LookupResult {
    exists: boolean
    user: { id: string; name: string | null; phone: string | null; photo_url: string | null } | null
    has_role: boolean
    already_onboarded: boolean
    dealer_profile: DealerProfilePreview | null
  }
  type PhoneLookupState =
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'loaded'; data: LookupResult }

  const [phoneLookup, setPhoneLookup] = useState<PhoneLookupState>({ state: 'idle' })

  const load = async () => {
    if (!clientId) return
    const [d, f, fa] = await Promise.all([
      api.get<Promoter[]>(`/client/${clientId}/field-manager/promoters?promoter_type=DEALER`).catch(() => ({ data: [] as Promoter[] })),
      api.get<Promoter[]>(`/client/${clientId}/field-manager/promoters?promoter_type=FACILITATOR`).catch(() => ({ data: [] as Promoter[] })),
      api.get<Farmer[]>(`/client/${clientId}/field-manager/farmers`).catch(() => ({ data: [] as Farmer[] })),
    ])
    setDealers(d.data)
    setFacilitators(f.data)
    setFarmers(fa.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAdding(true); setAddError('')
    try {
      await api.post(`/client/${clientId}/field-manager/promoters`, {
        phone: addForm.phone,
        territory_notes: addForm.territory_notes,
        promoter_type: addingType,
      })
      setShowAdd(false)
      setAddForm({ phone: '', territory_notes: '' })
      setPhoneLookup({ state: 'idle' })
      load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || 'Failed to onboard.'
      setAddError(msg)
    } finally { setAdding(false) }
  }

  async function deactivatePromoter(id: string) {
    if (!confirm('Deactivate this promoter? They will stop being able to assign packages on behalf of this company.')) return
    await api.put(`/client/${clientId}/field-manager/promoters/${id}/deactivate`)
    load()
  }

  async function reactivatePromoter(id: string) {
    if (!confirm('Reactivate this promoter? They will resume being able to assign packages.')) return
    await api.put(`/client/${clientId}/field-manager/promoters/${id}/reactivate`)
    load()
  }

  async function checkPhone(phone: string) {
    const trimmed = phone.trim()
    if (!trimmed || !clientId) {
      setPhoneLookup({ state: 'idle' })
      return
    }
    setPhoneLookup({ state: 'checking' })
    try {
      const params = new URLSearchParams({
        phone: trimmed,
        client_id: clientId,
        promoter_type: addingType,
      })
      const { data } = await api.get<LookupResult>(
        `/admin/users/lookup-for-onboarding?${params}`,
      )
      setPhoneLookup({ state: 'loaded', data })
    } catch {
      // Lookup failure shouldn't block — fall back to idle so the
      // modal still allows submit; the backend will 422 with a clear
      // message if the user isn't self-registered.
      setPhoneLookup({ state: 'idle' })
    }
  }

  const PromoterTable = ({ list, type }: { list: Promoter[], type: string }) => (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setAddingType(type as 'DEALER' | 'FACILITATOR'); setShowAdd(true); setAddError(''); setPhoneLookup({ state: 'idle' }) }}
          className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
          style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
          + Onboard {type === 'DEALER' ? 'Dealer' : 'Facilitator'}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">
            No {type.toLowerCase()}s registered yet. Register {type.toLowerCase()}s to route farmer orders to them.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Phone</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Territory</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-800">{p.name || '—'}</p>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-slate-600 hidden sm:table-cell">{p.phone || '—'}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs hidden md:table-cell">{p.territory_notes || '—'}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {p.status === 'ACTIVE' ? (
                      <button onClick={() => deactivatePromoter(p.id)}
                        className="text-xs px-2 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50">
                        Deactivate
                      </button>
                    ) : (
                      <button onClick={() => reactivatePromoter(p.id)}
                        className="text-xs px-2 py-1 rounded-lg border border-green-200 text-green-600 hover:bg-green-50">
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Field Manager</h1>
        <p className="text-slate-500 text-sm mt-0.5">Register dealers and facilitators</p>
      </div>

      {/* Signpost — replaces the old "Assign Advisory" tab. Per spec
          §11.2, advisory assignment is initiated by the Promoter on
          their RootsTalk PWA, not by the CA from this page.
          Allocation of subscription units to a Promoter happens on
          the Subscriptions page. This banner makes that workflow
          discoverable for CAs who land here looking for an action. */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 text-sm text-blue-800 leading-relaxed">
        <span className="font-semibold">How advisory assignment works:</span>{' '}
        Promoters assign advisories to farmers from their own RootsTalk PWA.
        To give a Promoter the units they need, see the{' '}
        <a href="/subscription" className="underline font-medium hover:text-blue-900">
          Subscriptions page
        </a>{' '}
        and allocate from your company pool.
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit overflow-x-auto">
        {(['dealers', 'facilitators', 'farmers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'dealers' ? `Dealers (${dealers.length})` :
             t === 'facilitators' ? `Facilitators (${facilitators.length})` :
             `Farmers (${farmers.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'dealers' ? (
        <PromoterTable list={dealers} type="DEALER" />
      ) : tab === 'facilitators' ? (
        <PromoterTable list={facilitators} type="FACILITATOR" />
      ) : (
        /* Farmers tab */
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {farmers.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-slate-500 text-sm">No farmers have subscriptions with this client yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Farmer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Phone</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {farmers.map(f => (
                  <tr key={f.user_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{f.name || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600 hidden sm:table-cell">{f.phone || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.subscription_status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {f.subscription_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Onboard Promoter Modal — V1.1 Item 3 (2026-05-09).
          Phone-only entry. The user must have already self-registered
          on the PWA; the FM's role here is recognition, not creation. */}
      {showAdd && (() => {
        const lookup = phoneLookup.state === 'loaded' ? phoneLookup.data : null
        const canOnboard = !!lookup
          && lookup.exists && lookup.has_role && !lookup.already_onboarded
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-100">
                <h2 className="font-bold text-slate-900">Onboard {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'}</h2>
                <p className="text-slate-500 text-sm mt-0.5">
                  Enter their RootsTalk phone number. They must have already registered as a {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'} on the PWA — your role here is to recognise them for this company.
                </p>
              </div>
              <form onSubmit={handleAdd} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Mobile Number</label>
                  <input value={addForm.phone}
                    onChange={e => {
                      setAddForm(f => ({ ...f, phone: e.target.value }))
                      if (phoneLookup.state !== 'idle') setPhoneLookup({ state: 'idle' })
                    }}
                    onBlur={e => checkPhone(e.target.value)}
                    required placeholder="+91XXXXXXXXXX"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono" />
                  {phoneLookup.state === 'idle' && (
                    <p className="text-xs text-slate-400 mt-1">Tab out (or click away) to look up the user.</p>
                  )}
                  {phoneLookup.state === 'checking' && (
                    <p className="text-xs text-slate-400 mt-1">Checking…</p>
                  )}
                </div>

                {/* Lookup result preview */}
                {lookup && !lookup.exists && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-sm text-amber-800">
                    <p className="font-semibold">No user with this phone</p>
                    <p className="text-xs mt-1">
                      Ask the person to register on the RootsTalk PWA first (Become a {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'}). Then come back here to recognise them.
                    </p>
                  </div>
                )}
                {lookup && lookup.exists && !lookup.has_role && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-sm text-amber-800">
                    <p className="font-semibold">
                      {lookup.user?.name || 'This user'} hasn&apos;t registered as a {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'} yet
                    </p>
                    <p className="text-xs mt-1">
                      Ask them to open the RootsTalk PWA, tap Become a {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'}, and complete their profile. Then return here to onboard.
                    </p>
                  </div>
                )}
                {lookup && lookup.exists && lookup.has_role && lookup.already_onboarded && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-3 text-sm text-blue-800">
                    <p className="font-semibold">
                      {lookup.user?.name || 'This user'} is already onboarded as a {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'} at this company.
                    </p>
                  </div>
                )}
                {canOnboard && lookup?.user && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">User found</p>
                    <p className="font-semibold text-slate-800">{lookup.user.name || 'Unnamed'}</p>
                    <p className="text-xs text-slate-500 font-mono">{lookup.user.phone}</p>
                    {addingType === 'DEALER' && lookup.dealer_profile && (
                      <div className="bg-white rounded-lg p-3 border border-green-100 space-y-1.5">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Shop profile</p>
                        {lookup.dealer_profile.shop_name && (
                          <p className="text-sm text-slate-800">{lookup.dealer_profile.shop_name}</p>
                        )}
                        {lookup.dealer_profile.shop_address && (
                          <p className="text-xs text-slate-500">{lookup.dealer_profile.shop_address}</p>
                        )}
                        {lookup.dealer_profile.sell_categories?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {lookup.dealer_profile.sell_categories.map(c => (
                              <span key={c} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{c}</span>
                            ))}
                          </div>
                        )}
                        {(lookup.dealer_profile.pesticide_licence_url || lookup.dealer_profile.fertiliser_licence_url || lookup.dealer_profile.shop_registration_url) && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {lookup.dealer_profile.pesticide_licence_url && (
                              <a href={lookup.dealer_profile.pesticide_licence_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 underline">Pesticide licence ↗</a>
                            )}
                            {lookup.dealer_profile.fertiliser_licence_url && (
                              <a href={lookup.dealer_profile.fertiliser_licence_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 underline">Fertiliser licence ↗</a>
                            )}
                            {lookup.dealer_profile.shop_registration_url && (
                              <a href={lookup.dealer_profile.shop_registration_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 underline">Shop registration ↗</a>
                            )}
                          </div>
                        )}
                        {(lookup.dealer_profile.shop_gps_lat && lookup.dealer_profile.shop_gps_lng) && (
                          <p className="text-xs text-slate-400 font-mono">
                            GPS: {lookup.dealer_profile.shop_gps_lat.toFixed(5)}, {lookup.dealer_profile.shop_gps_lng.toFixed(5)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {canOnboard && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Territory / Notes (optional)</label>
                    <textarea value={addForm.territory_notes} onChange={e => setAddForm(f => ({ ...f, territory_notes: e.target.value }))}
                      rows={2} placeholder="e.g. Covers Warangal district, 3 mandals"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
                  </div>
                )}

                {addError && <p className="text-sm text-red-600">{addError}</p>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => { setShowAdd(false); setAddError(''); setPhoneLookup({ state: 'idle' }) }}
                    className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={adding || !canOnboard}
                    className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {adding ? 'Onboarding…' : 'Onboard'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
