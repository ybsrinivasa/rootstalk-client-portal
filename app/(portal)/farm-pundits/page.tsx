'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Pundit {
  id: string; pundit_id: string; name: string | null; phone: string | null
  role: string; status: string; is_promoter_pundit: boolean; round_robin_sequence: number | null; onboarded_at: string
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

export default function FarmPunditsPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'pundits' | 'search' | 'queries'>('pundits')
  const [pundits, setPundits] = useState<Pundit[]>([])
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [queries, setQueries] = useState<CompanyQuery[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState('')

  const [searchForm, setSearchForm] = useState({
    state_cosh_id: '',
    expertise_domain: '',
    language_code: '',
    education: '',
    phone: '',
  })

  const [inviteRole, setInviteRole] = useState<Record<string, string>>({})

  const load = async () => {
    if (!clientId) return
    const [p, q] = await Promise.all([
      api.get<Pundit[]>(`/client/${clientId}/pundits`).catch(() => ({ data: [] as Pundit[] })),
      api.get<CompanyQuery[]>(`/client/${clientId}/queries`).catch(() => ({ data: [] as CompanyQuery[] })),
    ])
    setPundits(p.data)
    setQueries(q.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId])

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    setSearching(true)
    try {
      const params = new URLSearchParams()
      Object.entries(searchForm).forEach(([k, v]) => { if (v) params.append(k, v) })
      const { data } = await api.get<SearchResult[]>(`/client/${clientId}/pundit-search?${params}`)
      setSearchResults(data)
    } finally { setSearching(false) }
  }

  async function invite(punditId: string) {
    setInviting(punditId); setInviteError('')
    try {
      await api.post(`/client/${clientId}/pundit-invitations`, {
        pundit_user_id: (searchResults.find(r => r.id === punditId) || { user_id: punditId })?.user_id || punditId,
        role: inviteRole[punditId] || 'PRIMARY',
      })
      setSearchResults(prev => prev.map(r => r.id === punditId ? { ...r, already_onboarded: true } : r))
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setInviteError(msg || 'Failed to invite.')
    } finally { setInviting(null) }
  }

  async function deactivate(cpId: string) {
    if (!confirm('Deactivate this FarmPundit? They will stop receiving new queries.')) return
    await api.put(`/client/${clientId}/pundits/${cpId}/deactivate`)
    load()
  }

  async function togglePromoterPundit(cpId: string, current: boolean) {
    await api.put(`/client/${clientId}/pundits/${cpId}/promoter-pundit`, { is_promoter_pundit: !current })
    load()
  }

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
          ['pundits', `My Experts (${pundits.length})`],
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
          {pundits.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No FarmPundits yet. Use the "Find Experts" tab to search and invite them.</p>
            </div>
          ) : (
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
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 leading-relaxed">
            <strong>Promoter-Pundit (PP)</strong> — A facilitator who is also a FarmPundit. Queries from farmers they personally assigned get routed to them directly (not via round-robin).
          </div>
        </div>
      ) : tab === 'search' ? (
        <div className="space-y-4">
          {/* Search filters */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">Search FarmPundits</h3>
            <form onSubmit={handleSearch} className="grid grid-cols-2 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">State (Cosh ID)</label>
                <input value={searchForm.state_cosh_id}
                  onChange={e => setSearchForm(f => ({ ...f, state_cosh_id: e.target.value }))}
                  placeholder="state_karnataka"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Expertise Domain</label>
                <select value={searchForm.expertise_domain}
                  onChange={e => setSearchForm(f => ({ ...f, expertise_domain: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                  <option value="">Any</option>
                  <option value="plant_protection">Plant Protection</option>
                  <option value="plant_nutrition">Plant Nutrition</option>
                  <option value="overall_agronomy">Overall Agronomy</option>
                  <option value="plant_propagation">Plant Propagation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Language</label>
                <select value={searchForm.language_code}
                  onChange={e => setSearchForm(f => ({ ...f, language_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                  <option value="">Any</option>
                  <option value="kn">Kannada</option>
                  <option value="te">Telugu</option>
                  <option value="ta">Tamil</option>
                  <option value="hi">Hindi</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Education</label>
                <select value={searchForm.education}
                  onChange={e => setSearchForm(f => ({ ...f, education: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
                  <option value="">Any</option>
                  <option value="DOCTORATE">Doctorate</option>
                  <option value="MASTERS">Masters</option>
                  <option value="BACCALAUREATE">Baccalaureate</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Phone Number</label>
                <input value={searchForm.phone}
                  onChange={e => setSearchForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="Search by phone"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none font-mono" />
              </div>
              <div className="col-span-2">
                <button type="submit" disabled={searching}
                  className="w-full text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {searching ? 'Searching…' : 'Search FarmPundits'}
                </button>
              </div>
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
                      <span className="text-xs text-green-600 font-medium shrink-0">✓ Onboarded</span>
                    ) : (
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <select value={inviteRole[r.id] || 'PRIMARY'}
                          onChange={e => setInviteRole(v => ({ ...v, [r.id]: e.target.value }))}
                          className="border border-slate-200 rounded-lg px-2 py-1 text-xs">
                          <option value="PRIMARY">Primary</option>
                          <option value="PANEL">Panel</option>
                        </select>
                        <button onClick={() => invite(r.id)} disabled={inviting === r.id}
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
