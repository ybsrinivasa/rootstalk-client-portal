'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

interface Pundit {
  id: string; pundit_id: string; name: string | null; phone: string | null
  role: string; status: string
  is_promoter_pundit: boolean
  // True only when the Pundit also has an ACTIVE Facilitator-Promoter
  // row at this client (spec §14.2 / M5). The Mark-PP button is
  // hidden when false; clicking it would otherwise 409 with
  // `promoter_pundit_requires_facilitator_promoter`.
  can_be_promoter_pundit: boolean
  /** 2026-05-31 — distinguishes the two P-P paths.
   *  REGISTERED_PUNDIT: a real FarmPundit who was designated as P-P
   *  via the existing FarmPundits-tab toggle. FM_PROMOTER: a phantom
   *  CFP row backing an FM-side ClientPromoter.is_promoter_pundit
   *  flag (Sanjay's path — no separate Pundit registration). */
  source: 'REGISTERED_PUNDIT' | 'FM_PROMOTER'
  round_robin_sequence: number | null; active_query_count: number
  onboarded_at: string
}
interface PendingInvitation {
  id: string; pundit_id: string; name: string | null; phone: string | null; email: string | null
  role: string; status: string; rejection_reason: string | null; created_at: string
}
interface CoshNamedRef { cosh_id: string; name: string | null }
interface Address {
  line: string | null
  locality: string | null
  town: string | null
  pin_code: string | null
  district: string | null
  state: string | null
}
type InvitationStatus = 'NONE' | 'PENDING' | 'ONBOARDED'
interface SearchResult {
  id: string; user_id: string; name: string | null; phone: string | null; email: string | null
  address: Address | null
  invitation_status: InvitationStatus
}
interface SupportArea {
  state_cosh_id: string; state_name: string | null
  district_cosh_id: string | null; district_name: string | null
}
interface FullPunditProfile {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  address: Address | null
  education: CoshNamedRef | null
  experience: CoshNamedRef | null
  is_employed_by_organization: boolean
  organisation_type: CoshNamedRef | null
  non_employed_kind: 'RETIRED' | 'EXPERIENCED_FARMER' | null
  farming_methods: CoshNamedRef[]
  cultivation_types: CoshNamedRef[]
  expertise_domains: CoshNamedRef[]
  crop_groups: CoshNamedRef[]
  languages: CoshNamedRef[]
  support_areas: SupportArea[]
  role: string
  status: string
  round_robin_sequence: number | null
  is_promoter_pundit: boolean
  onboarded_at: string
}
interface CoshOption { cosh_id: string; name: string }
interface CoshState { cosh_id: string; name: string | null }
interface CoshLocationsResponse { states: CoshState[] }
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

// Every dropdown now binds to a Cosh `core_type` slug (the same set
// the PWA /pundit/register form fetches). Two effects below load
// the option lists at mount; if the user has used the PWA register
// form, the values being matched against are the same Cosh UUIDs.
const PUNDIT_SLUGS = [
  'pundit_education',
  'pundit_experience',
  'pundit_farming_methods',
  'pundit_cultivation_types',
  'pundit_domain_expertise',
  'pundit_crop_groups',
  'pundit_languages',
] as const
type Slug = typeof PUNDIT_SLUGS[number]

export default function FarmPunditsPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'pundits' | 'promoter-pundits' | 'search' | 'queries'>('pundits')
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
    farming_methods: [] as string[],
    cultivation_types: [] as string[],
    education_cosh_id: '',
    experience_cosh_id: '',
    phone: '',
  })

  // Cosh-driven option lists for every dropdown. Loaded once on mount;
  // state_list comes from /cosh/locations/india (already used elsewhere),
  // the eight pundit_* slugs from the allowlisted /cosh/pundit-options.
  const [options, setOptions] = useState<Record<Slug, CoshOption[]>>(() => {
    const seed = {} as Record<Slug, CoshOption[]>
    PUNDIT_SLUGS.forEach(s => { seed[s] = [] })
    return seed
  })
  const [states, setStates] = useState<CoshOption[]>([])

  useEffect(() => {
    PUNDIT_SLUGS.forEach(slug => {
      api.get<CoshOption[]>(`/cosh/pundit-options?slug=${slug}`)
        .then(r => setOptions(o => ({ ...o, [slug]: r.data })))
        .catch(() => { /* dropdown stays empty — search still works */ })
    })
    api.get<CoshLocationsResponse>('/cosh/locations/india')
      .then(r => setStates(
        (r.data.states || [])
          .filter(s => s.name)
          .map(s => ({ cosh_id: s.cosh_id, name: s.name! }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ))
      .catch(() => {})
  }, [])

  const [inviteRole, setInviteRole] = useState<Record<string, string>>({})

  // Active-Expert drill-down: viewing the full Cosh-resolved profile
  // of an onboarded Pundit in a modal. Null = closed.
  const [viewingProfile, setViewingProfile] = useState<FullPunditProfile | null>(null)
  const [viewingProfileLoading, setViewingProfileLoading] = useState(false)

  async function openProfile(cpId: string) {
    setViewingProfileLoading(true)
    setViewingProfile(null)
    try {
      const { data } = await api.get<FullPunditProfile>(
        `/client/${clientId}/pundits/${cpId}/profile`,
      )
      setViewingProfile(data)
    } finally { setViewingProfileLoading(false) }
  }

  function clearAll() {
    setSearchForm({
      state_cosh_ids: [], expertise_domains: [], language_codes: [],
      crop_groups: [], farming_methods: [], cultivation_types: [],
      education_cosh_id: '', experience_cosh_id: '', phone: '',
    })
    setSearchResults([])
    setInviteError('')
  }

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

  type MultiField =
    | 'state_cosh_ids' | 'expertise_domains' | 'language_codes'
    | 'crop_groups' | 'farming_methods' | 'cultivation_types'
  function toggleArr(field: MultiField, value: string) {
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
      searchForm.farming_methods.forEach(v => params.append('farming_methods', v))
      searchForm.cultivation_types.forEach(v => params.append('cultivation_types', v))
      // Single-value: append only if set.
      if (searchForm.education_cosh_id) params.append('education_cosh_id', searchForm.education_cosh_id)
      if (searchForm.experience_cosh_id) params.append('experience_cosh_id', searchForm.experience_cosh_id)
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
      // Flip this row's status to PENDING so the card shows the
      // disabled "⏳ Invitation Pending" button instead of Invite.
      // Backend dedupe also refuses a second invite, but this keeps
      // the UI honest within the session before a fresh search.
      setSearchResults(prev => prev.map(r =>
        r.id === resultId ? { ...r, invitation_status: 'PENDING' as InvitationStatus } : r,
      ))
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
      setInviteError(extractErrorMessage(err, 'Failed to invite.'))
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
      alert(extractErrorMessage(err, 'Failed to change role.'))
    }
  }

  async function removePundit(cpId: string, name: string | null) {
    if (!confirm(`Remove ${name || 'this FarmPundit'} from your company entirely? Their PWA profile remains, and they can still be invited by other companies.`)) return
    try {
      await api.delete(`/client/${clientId}/pundits/${cpId}`)
      load()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to remove.'))
    }
  }

  async function togglePromoterPundit(cpId: string, current: boolean) {
    await api.put(`/client/${clientId}/pundits/${cpId}/promoter-pundit`, { is_promoter_pundit: !current })
    load()
  }

  // Reusable multi-select pill block — selected values fill with the
  // role colour, unselected sit on a muted border. Options now come
  // from Cosh ({cosh_id, name}); a loading message replaces the pills
  // until the fetch resolves.
  const PillGroup = ({
    label, options, selected, onToggle,
  }: {
    label: string
    options: CoshOption[]
    selected: string[]
    onToggle: (v: string) => void
  }) => (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1.5">{label}</p>
      {options.length === 0 ? (
        <p className="text-xs text-slate-400 italic">Loading…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map(o => (
            <button key={o.cosh_id} type="button" onClick={() => onToggle(o.cosh_id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                selected.includes(o.cosh_id) ? 'text-white border-transparent' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              style={selected.includes(o.cosh_id) ? { background: COLOUR } : {}}>
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: COLOUR }}>FarmPundit Experts</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Find, invite, and manage your company's expert advisors
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit overflow-x-auto">
        {([
          ['pundits', `My Experts (${pundits.filter(p => p.source !== 'FM_PROMOTER').length}${pendingInvitations.length > 0 ? ` · ${pendingInvitations.length} pending` : ''})`],
          ['promoter-pundits', `Promoter-Pundits (${pundits.filter(p => p.is_promoter_pundit).length})`],
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

          {pundits.filter(p => p.source !== 'FM_PROMOTER').length === 0 && pendingInvitations.length === 0 && rejectedInvitations.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No FarmPundits yet. Use the &quot;Find Experts&quot; tab to search and invite them.</p>
            </div>
          ) : pundits.filter(p => p.source !== 'FM_PROMOTER').length > 0 ? (
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
                  {pundits.filter(p => p.source !== 'FM_PROMOTER').map(p => (
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
                          <button onClick={() => openProfile(p.id)}
                            className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 whitespace-nowrap">
                            View profile
                          </button>
                          {/* Mark PP: only offered when the Pundit
                              also has an ACTIVE Facilitator-Promoter
                              row at this client (server-side M5 gate
                              mirrors this). Remove PP is always
                              allowed when the flag is already on. */}
                          {p.is_promoter_pundit ? (
                            <button onClick={() => togglePromoterPundit(p.id, p.is_promoter_pundit)}
                              className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                              Remove PP
                            </button>
                          ) : p.can_be_promoter_pundit ? (
                            <button onClick={() => togglePromoterPundit(p.id, p.is_promoter_pundit)}
                              className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                              Mark PP
                            </button>
                          ) : null}
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
      ) : tab === 'promoter-pundits' ? (
        <div className="space-y-4">
          {/* Read-only roster — assignment lives on the Field Manager
              page, not here. CA sees who's currently routable as a P-P. */}
          {pundits.filter(p => p.is_promoter_pundit).length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No Promoter-Pundits yet.</p>
              <p className="text-slate-400 text-xs mt-2 leading-relaxed max-w-md mx-auto">
                Promoter-Pundits are designated by the Field Manager from the Promoter list. They receive farmer queries from the round-robin chain alongside any registered FarmPundits.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Promoter-Pundit</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Path</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Active queries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pundits.filter(p => p.is_promoter_pundit).map(p => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-slate-800">{p.name || '—'}</p>
                        {p.phone && (
                          <p className="text-xs text-slate-500 font-mono mt-0.5">{p.phone}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        {p.source === 'REGISTERED_PUNDIT' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                            Registered Pundit
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                            Promoter (FM-assigned)
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          p.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-slate-600 hidden md:table-cell">
                        {p.active_query_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
            <strong>Read-only.</strong> Designation lives on the Field Manager page — a Promoter is marked as a P-P from there. Registered Pundits with P-P status appear here for completeness.
          </div>
        </div>
      ) : tab === 'search' ? (
        <div className="space-y-4">
          {/* Search filters — full §14.3 Step 1 set: 4 multi-select +
              4 single-select + phone aid. */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">Search FarmPundits</h3>
            <form onSubmit={handleSearch} className="space-y-4">
              <PillGroup label="Preferred States" options={states}
                selected={searchForm.state_cosh_ids}
                onToggle={v => toggleArr('state_cosh_ids', v)} />
              <PillGroup label="Domain Expertise" options={options.pundit_domain_expertise}
                selected={searchForm.expertise_domains}
                onToggle={v => toggleArr('expertise_domains', v)} />
              <PillGroup label="Crop Groups" options={options.pundit_crop_groups}
                selected={searchForm.crop_groups}
                onToggle={v => toggleArr('crop_groups', v)} />
              <PillGroup label="Languages" options={options.pundit_languages}
                selected={searchForm.language_codes}
                onToggle={v => toggleArr('language_codes', v)} />
              <PillGroup label="Farming Methods" options={options.pundit_farming_methods}
                selected={searchForm.farming_methods}
                onToggle={v => toggleArr('farming_methods', v)} />
              <PillGroup label="Cultivation Types" options={options.pundit_cultivation_types}
                selected={searchForm.cultivation_types}
                onToggle={v => toggleArr('cultivation_types', v)} />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Education</label>
                  <select value={searchForm.education_cosh_id}
                    onChange={e => setSearchForm(f => ({ ...f, education_cosh_id: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                    <option value="">Any</option>
                    {options.pundit_education.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Years of Experience</label>
                  <select value={searchForm.experience_cosh_id}
                    onChange={e => setSearchForm(f => ({ ...f, experience_cosh_id: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                    <option value="">Any</option>
                    {options.pundit_experience.map(o => <option key={o.cosh_id} value={o.cosh_id}>{o.name}</option>)}
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

              <div className="flex gap-2">
                <button type="submit" disabled={searching}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {searching ? 'Searching…' : 'Search FarmPundits'}
                </button>
                <button type="button" onClick={clearAll}
                  className="px-4 py-2.5 rounded-xl text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">
                  Clear all
                </button>
              </div>
            </form>
          </div>

          {/* Search results — compact identity card. The criteria the
              CA used to filter stay visible on the form above; the
              card shows only what's needed to recognise the person
              (name + phone if not hidden + email + address). */}
          {searchResults.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{searchResults.length} results</p>
              {inviteError && <p className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl">{inviteError}</p>}
              {searchResults.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-800">{r.name || '—'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {r.phone && <span className="text-xs font-mono text-slate-500">{r.phone}</span>}
                        {r.email && <span className="text-xs text-slate-400">{r.email}</span>}
                      </div>
                      {r.address && (
                        <p className="text-xs text-slate-500 mt-1">
                          {[
                            r.address.line, r.address.locality, r.address.town,
                            r.address.district, r.address.state, r.address.pin_code,
                          ].filter(Boolean).join(', ') || (
                            <span className="italic text-slate-300">Address not provided</span>
                          )}
                        </p>
                      )}
                    </div>
                    {r.invitation_status === 'ONBOARDED' ? (
                      <span className="text-xs text-green-700 font-medium shrink-0 whitespace-nowrap">✓ Onboarded</span>
                    ) : r.invitation_status === 'PENDING' ? (
                      <span className="text-xs text-amber-600 font-medium shrink-0 whitespace-nowrap"
                        title="Awaiting expert's response. Re-invite blocked until accepted or declined.">
                        ⏳ Invitation Pending
                      </span>
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

      {/* Active-Expert profile drawer. Triggered by "View profile" on
          any onboarded Pundit row. Reads live from the DB on each
          open so any subsequent edit by the Pundit shows up here
          immediately. */}
      {(viewingProfile || viewingProfileLoading) && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30"
          onClick={() => { setViewingProfile(null); setViewingProfileLoading(false) }}>
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">FarmPundit Profile</h2>
              <button onClick={() => { setViewingProfile(null); setViewingProfileLoading(false) }}
                className="text-slate-400 hover:text-slate-700 text-xl">×</button>
            </div>
            {viewingProfileLoading && (
              <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
            )}
            {viewingProfile && (
              <div className="p-5 space-y-4 text-sm">
                <div>
                  <p className="font-semibold text-slate-800 text-base">{viewingProfile.name || '—'}</p>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">{viewingProfile.phone || 'Phone hidden'}</p>
                  {viewingProfile.email && <p className="text-xs text-slate-500">{viewingProfile.email}</p>}
                </div>

                {viewingProfile.address && (
                  <ProfileBlock label="Address">
                    {[
                      viewingProfile.address.line, viewingProfile.address.locality,
                      viewingProfile.address.town, viewingProfile.address.district,
                      viewingProfile.address.state, viewingProfile.address.pin_code,
                    ].filter(Boolean).join(', ') || (
                      <span className="text-slate-400 italic">Address not provided</span>
                    )}
                  </ProfileBlock>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <ProfileBlock label="Education">{viewingProfile.education?.name || '—'}</ProfileBlock>
                  <ProfileBlock label="Experience">{viewingProfile.experience?.name || '—'}</ProfileBlock>
                </div>

                <ProfileBlock label="Farming Methods">
                  <ChipRow items={viewingProfile.farming_methods} />
                </ProfileBlock>
                <ProfileBlock label="Cultivation Types">
                  <ChipRow items={viewingProfile.cultivation_types} />
                </ProfileBlock>

                <ProfileBlock label="Working for an Organisation">
                  {viewingProfile.is_employed_by_organization ? (
                    <>
                      Yes
                      {viewingProfile.organisation_type?.name && (
                        <span className="text-slate-500"> · {viewingProfile.organisation_type.name}</span>
                      )}
                    </>
                  ) : (
                    <>
                      No
                      {viewingProfile.non_employed_kind && (
                        <span className="text-slate-500">
                          {' · '}{viewingProfile.non_employed_kind === 'RETIRED' ? 'Retired from service' : 'Experienced farmer'}
                        </span>
                      )}
                    </>
                  )}
                </ProfileBlock>

                <ProfileBlock label="Domain Expertise">
                  <ChipRow items={viewingProfile.expertise_domains} />
                </ProfileBlock>
                <ProfileBlock label="Crop Groups">
                  <ChipRow items={viewingProfile.crop_groups} />
                </ProfileBlock>
                <ProfileBlock label="Languages Conversant">
                  <ChipRow items={viewingProfile.languages} muted />
                </ProfileBlock>
                <ProfileBlock label="Preferred States">
                  {viewingProfile.support_areas.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {viewingProfile.support_areas.map((a, i) => (
                        <li key={i}>{a.state_name || a.state_cosh_id}</li>
                      ))}
                    </ul>
                  )}
                </ProfileBlock>

                <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs text-slate-500">
                  <div><span className="uppercase tracking-wide font-semibold">Role:</span> {viewingProfile.role}</div>
                  <div><span className="uppercase tracking-wide font-semibold">Status:</span> {viewingProfile.status}</div>
                  {viewingProfile.round_robin_sequence != null && (
                    <div><span className="uppercase tracking-wide font-semibold">Round-robin:</span> #{viewingProfile.round_robin_sequence}</div>
                  )}
                  {viewingProfile.is_promoter_pundit && (
                    <div><span className="uppercase tracking-wide font-semibold text-purple-700">Promoter-Pundit</span></div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <div className="text-slate-700">{children}</div>
    </div>
  )
}

function ChipRow({ items, muted = false }: { items: { cosh_id: string; name: string | null }[]; muted?: boolean }) {
  if (items.length === 0) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(it => (
        <span key={it.cosh_id}
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${muted ? 'bg-slate-100 text-slate-700' : 'bg-indigo-50 text-indigo-700'}`}>
          {it.name || it.cosh_id}
        </span>
      ))}
    </div>
  )
}
