'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Pundit {
  id: string; pundit_id: string; name: string | null; phone: string | null
  role: string; status: string; is_promoter_pundit: boolean
  round_robin_sequence: number | null; active_query_count: number
  onboarded_at: string
}
interface PendingInvitation {
  id: string; pundit_id: string; name: string | null; phone: string | null; email: string | null
  role: string; status: string; rejection_reason: string | null; created_at: string
}
interface SearchResult {
  id: string; user_id: string; name: string | null; phone: string | null; email: string | null
  education: string | null; experience_band: string | null; support_method: string | null; already_onboarded: boolean
}
interface CompanyQuery {
  id: string; title: string; status: string; severity: string; created_at: string; farmer_user_id: string
}

const COLOUR = '#3C3489'
const STATUS_COLOUR: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  FORWARDED: 'bg-purple-100 text-purple-700',
  RETURNED: 'bg-amber-100 text-amber-700',
  RESPONDED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-600',
  EXPIRED: 'bg-slate-100 text-slate-500',
}

// Filter option lists — kept in sync with the PWA `/pundit/register`
// page so the CA filters can match what experts actually selected on
// their profile. If the spec or the register page adds new values,
// update both places.
const STATES: Array<[string, string]> = [
  ['state_andhra_pradesh', 'Andhra Pradesh'],
  ['state_arunachal_pradesh', 'Arunachal Pradesh'],
  ['state_assam', 'Assam'],
  ['state_bihar', 'Bihar'],
  ['state_chhattisgarh', 'Chhattisgarh'],
  ['state_goa', 'Goa'],
  ['state_gujarat', 'Gujarat'],
  ['state_haryana', 'Haryana'],
  ['state_himachal_pradesh', 'Himachal Pradesh'],
  ['state_jharkhand', 'Jharkhand'],
  ['state_karnataka', 'Karnataka'],
  ['state_kerala', 'Kerala'],
  ['state_madhya_pradesh', 'Madhya Pradesh'],
  ['state_maharashtra', 'Maharashtra'],
  ['state_manipur', 'Manipur'],
  ['state_meghalaya', 'Meghalaya'],
  ['state_mizoram', 'Mizoram'],
  ['state_nagaland', 'Nagaland'],
  ['state_odisha', 'Odisha'],
  ['state_punjab', 'Punjab'],
  ['state_rajasthan', 'Rajasthan'],
  ['state_sikkim', 'Sikkim'],
  ['state_tamil_nadu', 'Tamil Nadu'],
  ['state_telangana', 'Telangana'],
  ['state_tripura', 'Tripura'],
  ['state_uttar_pradesh', 'Uttar Pradesh'],
  ['state_uttarakhand', 'Uttarakhand'],
  ['state_west_bengal', 'West Bengal'],
  ['state_delhi', 'Delhi'],
  ['state_jammu_and_kashmir', 'Jammu & Kashmir'],
]
const EXPERTISE_DOMAINS: Array<[string, string]> = [
  ['plant_protection', 'Plant Protection'],
  ['plant_nutrition', 'Plant Nutrition'],
  ['overall_agronomy', 'Overall Agronomy'],
  ['plant_propagation', 'Plant Propagation'],
  ['farm_equipments_and_mechanisation', 'Farm Equipment & Mechanisation'],
]
const CROP_GROUPS: Array<[string, string]> = [
  ['cereals', 'Cereals'],
  ['oilseeds', 'Oilseeds'],
  ['fruit_trees', 'Fruit Trees'],
  ['fibre_crops', 'Fibre Crops'],
  ['flower_crops', 'Flower Crops'],
  ['fodder_crops', 'Fodder Crops'],
  ['medicinal_and_aromatic_crops', 'Medicinal & Aromatic'],
]
const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['hi', 'Hindi'], ['te', 'Telugu'], ['kn', 'Kannada'],
  ['ta', 'Tamil'], ['ml', 'Malayalam'], ['mr', 'Marathi'], ['gu', 'Gujarati'],
  ['pa', 'Punjabi'], ['bn', 'Bengali'],
]
const EDUCATIONS: Array<[string, string]> = [
  ['DOCTORATE', 'Doctorate'],
  ['MASTERS', 'Masters'],
  ['BACCALAUREATE', 'Baccalaureate'],
  ['CLASS_XII_AND_BELOW', 'Class XII and below'],
  ['NO_FORMAL_EDUCATION', 'No formal education'],
]
const EXPERIENCES: Array<[string, string]> = [
  ['UP_TO_5_YEARS', 'Up to 5 years'],
  ['FROM_5_TO_10', '5–10 years'],
  ['FROM_10_TO_15', '10–15 years'],
  ['ABOVE_15', 'More than 15 years'],
]
const SUPPORT_METHODS: Array<[string, string]> = [
  ['CONVENTIONAL', 'Conventional'],
  ['NON_CHEMICAL', 'Non-chemical'],
]
const CULTIVATION_TYPES: Array<[string, string]> = [
  ['open_field', 'Open Field'],
  ['greenhouse', 'Greenhouse / Polyhouse'],
  ['nursery', 'Nursery'],
  ['hydroponic', 'Hydroponic'],
]

export default function FarmPunditsPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'pundits' | 'search' | 'queries'>('pundits')
  const [pundits, setPundits] = useState<Pundit[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([])
  const [rejectedInvitations, setRejectedInvitations] = useState<PendingInvitation[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [queries, setQueries] = useState<CompanyQuery[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState('')

  // Multi-select filters use string arrays so the URLSearchParams
  // builder can repeat each key (?state_cosh_ids=a&state_cosh_ids=b).
  const [searchForm, setSearchForm] = useState({
    state_cosh_ids: [] as string[],
    expertise_domains: [] as string[],
    language_codes: [] as string[],
    crop_groups: [] as string[],
    education: '',
    experience_band: '',
    support_method: '',
    cultivation_type: '',
    phone: '',
  })

  const [inviteRole, setInviteRole] = useState<Record<string, string>>({})

  const load = async () => {
    if (!clientId) return
    const [p, invPending, invRejected, q] = await Promise.all([
      api.get<Pundit[]>(`/client/${clientId}/pundits`).catch(() => ({ data: [] as Pundit[] })),
      api.get<PendingInvitation[]>(`/client/${clientId}/pundit-invitations?status=PENDING`).catch(() => ({ data: [] as PendingInvitation[] })),
      api.get<PendingInvitation[]>(`/client/${clientId}/pundit-invitations?status=REJECTED`).catch(() => ({ data: [] as PendingInvitation[] })),
      api.get<CompanyQuery[]>(`/client/${clientId}/queries`).catch(() => ({ data: [] as CompanyQuery[] })),
    ])
    setPundits(p.data)
    setPendingInvitations(invPending.data)
    setRejectedInvitations(invRejected.data)
    setQueries(q.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId])

  function toggleArr(field: 'state_cosh_ids' | 'expertise_domains' | 'language_codes' | 'crop_groups', value: string) {
    setSearchForm(f => ({
      ...f,
      [field]: f[field].includes(value) ? f[field].filter(x => x !== value) : [...f[field], value],
    }))
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    setSearching(true)
    try {
      const params = new URLSearchParams()
      // Multi-value: append once per selected value so backend's
      // list[str] = QueryParam(default=[]) reads them as a list.
      searchForm.state_cosh_ids.forEach(v => params.append('state_cosh_ids', v))
      searchForm.expertise_domains.forEach(v => params.append('expertise_domains', v))
      searchForm.language_codes.forEach(v => params.append('language_codes', v))
      searchForm.crop_groups.forEach(v => params.append('crop_groups', v))
      // Single-value: append only if set.
      if (searchForm.education) params.append('education', searchForm.education)
      if (searchForm.experience_band) params.append('experience_band', searchForm.experience_band)
      if (searchForm.support_method) params.append('support_method', searchForm.support_method)
      if (searchForm.cultivation_type) params.append('cultivation_type', searchForm.cultivation_type)
      if (searchForm.phone) params.append('phone', searchForm.phone)
      const { data } = await api.get<SearchResult[]>(`/client/${clientId}/pundit-search?${params}`)
      setSearchResults(data)
    } finally { setSearching(false) }
  }

  async function invite(punditUserId: string, resultId: string) {
    setInviting(resultId); setInviteError('')
    try {
      await api.post(`/client/${clientId}/pundit-invitations`, {
        pundit_user_id: punditUserId,
        role: inviteRole[resultId] || 'PRIMARY',
      })
      // The expert hasn't accepted yet — flag the result as "Invited"
      // (not "Onboarded") and refresh the pendingInvitations list so
      // the My Experts tab reflects the new pending row.
      setSearchResults(prev => prev.map(r => r.id === resultId ? { ...r, already_onboarded: true } : r))
      // Refresh both lists — re-inviting a previously-rejected expert
      // creates a new PENDING row, but the old REJECTED row (with its
      // reason text) is still useful context for the CA.
      const [pending, rejected] = await Promise.all([
        api.get<PendingInvitation[]>(`/client/${clientId}/pundit-invitations?status=PENDING`),
        api.get<PendingInvitation[]>(`/client/${clientId}/pundit-invitations?status=REJECTED`),
      ])
      setPendingInvitations(pending.data)
      setRejectedInvitations(rejected.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setInviteError(msg || 'Failed to invite.')
    } finally { setInviting(null) }
  }

  async function deactivate(cpId: string) {
    if (!confirm('Deactivate this FarmPundit? They will stop receiving new queries. Their currently-held queries can still be acted on until resolved.')) return
    await api.put(`/client/${clientId}/pundits/${cpId}/deactivate`)
    load()
  }

  async function reactivate(cpId: string) {
    if (!confirm('Reactivate this FarmPundit? They will start receiving new queries again.')) return
    await api.put(`/client/${clientId}/pundits/${cpId}/reactivate`)
    load()
  }

  async function changeRole(cpId: string, currentRole: string) {
    const target = currentRole === 'PRIMARY' ? 'PANEL' : 'PRIMARY'
    if (!confirm(`Change role to ${target === 'PRIMARY' ? 'Primary' : 'Panel'}? ${target === 'PANEL' ? 'They will be removed from the round-robin sequence.' : 'They will be added to the end of the round-robin sequence.'}`)) return
    try {
      await api.put(`/client/${clientId}/pundits/${cpId}/role`, { role: target })
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg || 'Failed to change role.')
    }
  }

  async function removePundit(cpId: string, name: string | null) {
    if (!confirm(`Remove ${name || 'this FarmPundit'} from your company entirely? Their PWA profile remains, and they can still be invited by other companies.`)) return
    try {
      await api.delete(`/client/${clientId}/pundits/${cpId}`)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(msg || 'Failed to remove.')
    }
  }

  async function togglePromoterPundit(cpId: string, current: boolean) {
    await api.put(`/client/${clientId}/pundits/${cpId}/promoter-pundit`, { is_promoter_pundit: !current })
    load()
  }

  // Reusable multi-select pill block — selected values fill with the
  // role colour, unselected sit on a muted border.
  const PillGroup = ({
    label, options, selected, onToggle,
  }: {
    label: string
    options: Array<[string, string]>
    selected: string[]
    onToggle: (v: string) => void
  }) => (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([val, lbl]) => (
          <button key={val} type="button" onClick={() => onToggle(val)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
              selected.includes(val) ? 'text-white border-transparent' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            style={selected.includes(val) ? { background: COLOUR } : {}}>
            {lbl}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">FarmPundit Experts</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Find, invite, and manage your company's expert advisors
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit overflow-x-auto">
        {([
          ['pundits', `My Experts (${pundits.length}${pendingInvitations.length > 0 ? ` · ${pendingInvitations.length} pending` : ''})`],
          ['search', 'Find Experts'],
          ['queries', `Queries (${queries.length})`],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'pundits' ? (
        <div className="space-y-4">
          {/* Pending invitations — surfaced separately so the CA can
              see what's "in flight" before the expert accepts.
              Without this, an invited expert vanishes from the
              workflow until they tap Accept in the PWA. */}
          {pendingInvitations.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-amber-200 bg-amber-100/60">
                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
                  Invitations sent · awaiting expert acceptance
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-amber-100">
                  {pendingInvitations.map(inv => (
                    <tr key={inv.id}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-800">{inv.name || '—'}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          {inv.phone && <span className="font-mono">{inv.phone}</span>}
                          {inv.email && <span>{inv.email}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                          {inv.role === 'PRIMARY' ? 'Primary' : 'Panel'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-amber-700 font-medium">
                        Pending acceptance
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Rejected invitations — surfaced so the CA can see WHY
              an expert declined, per spec §14.3 Step 3 ("If
              rejected: the expert must provide reasons before
              rejection is processed"). The reason is captured by
              the backend already; before this batch it had no path
              back to the CA UI. */}
          {rejectedInvitations.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-rose-200 bg-rose-100/60">
                <p className="text-xs font-semibold text-rose-800 uppercase tracking-wide">
                  Invitations declined
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-rose-100">
                  {rejectedInvitations.map(inv => (
                    <tr key={inv.id}>
                      <td className="px-5 py-3 align-top">
                        <p className="font-medium text-slate-800">{inv.name || '—'}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                          {inv.phone && <span className="font-mono">{inv.phone}</span>}
                          {inv.email && <span>{inv.email}</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                          {inv.role === 'PRIMARY' ? 'Primary' : 'Panel'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-rose-800">
                        {inv.rejection_reason ? (
                          <p className="leading-relaxed">"{inv.rejection_reason}"</p>
                        ) : (
                          <p className="italic text-slate-400">No reason given</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pundits.length === 0 && pendingInvitations.length === 0 && rejectedInvitations.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No FarmPundits yet. Use the "Find Experts" tab to search and invite them.</p>
            </div>
          ) : pundits.length > 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Expert</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Role</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Seq.</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pundits.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-slate-800">{p.name || '—'}</p>
                        <p className="text-xs text-slate-400 font-mono">{p.phone || '—'}</p>
                        {p.is_promoter_pundit && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Promoter-Pundit</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.role === 'PRIMARY' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                          {p.role === 'PRIMARY' ? 'Primary' : 'Panel'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400 text-xs hidden md:table-cell">
                        {p.round_robin_sequence || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">
                          <button onClick={() => togglePromoterPundit(p.id, p.is_promoter_pundit)}
                            className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                            {p.is_promoter_pundit ? 'Remove PP' : 'Mark PP'}
                          </button>
                          {p.status === 'ACTIVE' && (
                            <button onClick={() => deactivate(p.id)}
                              className="text-xs px-2 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50">
                              Deactivate
                            </button>
                          )}
                          {p.status === 'INACTIVE' && (
                            <>
                              <button onClick={() => reactivate(p.id)}
                                className="text-xs px-2 py-1 rounded-lg border border-green-200 text-green-600 hover:bg-green-50">
                                Reactivate
                              </button>
                              {/* Role-change + delete are only allowed
                                  per spec §14.5 once active queries
                                  are drained. The active_query_count
                                  comes from the list endpoint. */}
                              {p.active_query_count === 0 ? (
                                <>
                                  <button onClick={() => changeRole(p.id, p.role)}
                                    className="text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50">
                                    {p.role === 'PRIMARY' ? '→ Panel' : '→ Primary'}
                                  </button>
                                  <button onClick={() => removePundit(p.id, p.name)}
                                    className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                                    Remove
                                  </button>
                                </>
                              ) : (
                                <span title="Wait until all active queries are resolved or returned"
                                  className="text-xs text-slate-400 italic px-1">
                                  {p.active_query_count} active
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
            <strong>Promoter-Pundit (PP)</strong> — A facilitator who is also a FarmPundit. Queries from farmers they personally assigned get routed to them directly (not via round-robin).
          </div>
        </div>
      ) : tab === 'search' ? (
        <div className="space-y-4">
          {/* Search filters — full §14.3 Step 1 set: 4 multi-select +
              4 single-select + phone aid. */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">Search FarmPundits</h3>
            <form onSubmit={handleSearch} className="space-y-4">
              <PillGroup label="Support States" options={STATES}
                selected={searchForm.state_cosh_ids}
                onToggle={v => toggleArr('state_cosh_ids', v)} />
              <PillGroup label="Expertise Domains" options={EXPERTISE_DOMAINS}
                selected={searchForm.expertise_domains}
                onToggle={v => toggleArr('expertise_domains', v)} />
              <PillGroup label="Crop Groups" options={CROP_GROUPS}
                selected={searchForm.crop_groups}
                onToggle={v => toggleArr('crop_groups', v)} />
              <PillGroup label="Languages" options={LANGUAGES}
                selected={searchForm.language_codes}
                onToggle={v => toggleArr('language_codes', v)} />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Education</label>
                  <select value={searchForm.education}
                    onChange={e => setSearchForm(f => ({ ...f, education: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                    <option value="">Any</option>
                    {EDUCATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Years of Experience</label>
                  <select value={searchForm.experience_band}
                    onChange={e => setSearchForm(f => ({ ...f, experience_band: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                    <option value="">Any</option>
                    {EXPERIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Support Method</label>
                  <select value={searchForm.support_method}
                    onChange={e => setSearchForm(f => ({ ...f, support_method: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                    <option value="">Any</option>
                    {SUPPORT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Cultivation Type</label>
                  <select value={searchForm.cultivation_type}
                    onChange={e => setSearchForm(f => ({ ...f, cultivation_type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                    <option value="">Any</option>
                    {CULTIVATION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Phone Number (search aid)</label>
                  <input value={searchForm.phone}
                    onChange={e => setSearchForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="Partial match — e.g. 9876"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none font-mono" />
                </div>
              </div>

              <button type="submit" disabled={searching}
                className="w-full text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {searching ? 'Searching…' : 'Search FarmPundits'}
              </button>
            </form>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{searchResults.length} results</p>
              {inviteError && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl">{inviteError}</p>}
              {searchResults.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-slate-800">{r.name || '—'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {r.phone && <span className="text-xs font-mono text-slate-500">{r.phone}</span>}
                        {r.email && <span className="text-xs text-slate-400">{r.email}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {r.education && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{r.education}</span>}
                        {r.experience_band && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{r.experience_band}</span>}
                        {r.support_method && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{r.support_method}</span>}
                      </div>
                    </div>
                    {r.already_onboarded ? (
                      // After invite OR already accepted — both paths
                      // converge to already_onboarded=true. The
                      // pendingInvitations list above is what tells
                      // the CA whether the expert has actually
                      // accepted.
                      <span className="text-xs text-amber-600 font-medium shrink-0">✓ Invited</span>
                    ) : (
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <select value={inviteRole[r.id] || 'PRIMARY'}
                          onChange={e => setInviteRole(v => ({ ...v, [r.id]: e.target.value }))}
                          className="border border-slate-200 rounded-lg px-2 py-1 text-xs">
                          <option value="PRIMARY">Primary</option>
                          <option value="PANEL">Panel</option>
                        </select>
                        <button onClick={() => invite(r.user_id, r.id)} disabled={inviting === r.id}
                          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ background: COLOUR }}>
                          {inviting === r.id ? '…' : 'Invite'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Queries tab */
        <div className="space-y-4">
          {queries.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-slate-100">
              <p className="text-slate-400 text-sm">No queries yet</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Query</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Severity</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {queries.map(q => (
                    <tr key={q.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5 font-medium text-slate-800 max-w-xs">
                        <p className="truncate">{q.title}</p>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs hidden sm:table-cell">{q.severity}</td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[q.status] || 'bg-slate-100 text-slate-500'}`}>
                          {q.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-400 text-xs hidden md:table-cell">
                        {new Date(q.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
