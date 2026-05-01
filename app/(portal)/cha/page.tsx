'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface PGRec {
  id: string; problem_group_cosh_id: string; application_type: string
  status: string; version: number; parent_id: string | null; created_at: string
}
interface SPRec {
  id: string; specific_problem_cosh_id: string; application_type: string
  status: string; version: number; created_at: string
}
interface GlobalPG {
  id: string; problem_group_cosh_id: string; application_type: string; status: string; version: number
}
interface PGTimeline { id: string; name: string; from_type: string; from_value: number; to_value: number; practices: PGPractice[] }
interface PGPractice { id: string; l0_type: string; l1_type: string | null; l2_type: string | null; is_special_input: boolean }

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}
const L0_COLOUR: Record<string, string> = {
  INPUT: 'bg-blue-100 text-blue-700', NON_INPUT: 'bg-purple-100 text-purple-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700', MEDIA: 'bg-pink-100 text-pink-700',
}
const APP_TYPES = ['SPRAY', 'DRENCH', 'SOIL', 'FOLIAR', 'SEED_TREATMENT', 'FERTIGATION', 'BASAL']

export default function CHAPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'pg' | 'sp'>('pg')
  const [pgRecs, setPgRecs] = useState<PGRec[]>([])
  const [spRecs, setSpRecs] = useState<SPRec[]>([])
  const [loading, setLoading] = useState(true)

  // Global library import
  const [showImport, setShowImport] = useState(false)
  const [globalPGs, setGlobalPGs] = useState<GlobalPG[]>([])
  const [loadingGlobal, setLoadingGlobal] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importError, setImportError] = useState('')

  // SP create
  const [showCreateSP, setShowCreateSP] = useState(false)
  const [creatingSP, setCreatingSP] = useState(false)
  const [spError, setSpError] = useState('')
  const [spForm, setSpForm] = useState({ specific_problem_cosh_id: '', application_type: 'SPRAY' })

  // PG detail
  const [expandedPG, setExpandedPG] = useState<string | null>(null)
  const [pgTimelines, setPgTimelines] = useState<Record<string, PGTimeline[]>>({})
  const [publishingPG, setPublishingPG] = useState<string | null>(null)

  // SP detail
  const [expandedSP, setExpandedSP] = useState<string | null>(null)
  const [spTimelines, setSpTimelines] = useState<Record<string, PGTimeline[]>>({})
  const [publishingSP, setPublishingSP] = useState<string | null>(null)

  // TL add forms
  const [showAddTL, setShowAddTL] = useState<{ type: 'pg' | 'sp'; id: string } | null>(null)
  const [addingTL, setAddingTL] = useState(false)
  const [tlForm, setTlForm] = useState({ name: '', from_type: 'DAYS_AFTER_DETECTION', from_value: '0', to_value: '7' })
  const [tlError, setTlError] = useState('')

  const load = async () => {
    if (!clientId) return
    const [pg, sp] = await Promise.all([
      api.get<PGRec[]>(`/client/${clientId}/pg-recommendations`).catch(() => ({ data: [] as PGRec[] })),
      api.get<SPRec[]>(`/client/${clientId}/sp-recommendations`).catch(() => ({ data: [] as SPRec[] })),
    ])
    setPgRecs(pg.data)
    setSpRecs(sp.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId])

  const openImport = async () => {
    setShowImport(true); setLoadingGlobal(true); setImportError('')
    try {
      const { data } = await api.get<GlobalPG[]>('/advisory/global/pg-recommendations')
      setGlobalPGs(data.filter(g => g.status === 'ACTIVE'))
    } catch { setGlobalPGs([]) }
    finally { setLoadingGlobal(false) }
  }

  const doImport = async (globalId: string) => {
    setImporting(globalId); setImportError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/import/${globalId}`)
      setShowImport(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setImportError(msg || 'Failed to import.')
    } finally { setImporting(null) }
  }

  const loadPGTimelines = async (pgId: string) => {
    const { data } = await api.get<PGTimeline[]>(`/client/${clientId}/pg-recommendations/${pgId}/timelines`)
      .catch(() => ({ data: [] as PGTimeline[] }))
    setPgTimelines(m => ({ ...m, [pgId]: data }))
  }

  const loadSPTimelines = async (spId: string) => {
    const { data } = await api.get<PGTimeline[]>(`/client/${clientId}/sp-recommendations/${spId}/timelines`)
      .catch(() => ({ data: [] as PGTimeline[] }))
    setSpTimelines(m => ({ ...m, [spId]: data }))
  }

  const togglePG = (id: string) => {
    if (expandedPG === id) { setExpandedPG(null); return }
    setExpandedPG(id)
    if (!pgTimelines[id]) loadPGTimelines(id)
  }

  const toggleSP = (id: string) => {
    if (expandedSP === id) { setExpandedSP(null); return }
    setExpandedSP(id)
    if (!spTimelines[id]) loadSPTimelines(id)
  }

  const publishPG = async (pgId: string) => {
    setPublishingPG(pgId)
    try {
      const { data } = await api.post<PGRec>(`/client/${clientId}/pg-recommendations/${pgId}/publish`)
      setPgRecs(recs => recs.map(r => r.id === pgId ? { ...r, status: data.status, version: data.version } : r))
    } finally { setPublishingPG(null) }
  }

  const publishSP = async (spId: string) => {
    setPublishingSP(spId)
    try {
      const { data } = await api.post<SPRec>(`/client/${clientId}/sp-recommendations/${spId}/publish`)
      setSpRecs(recs => recs.map(r => r.id === spId ? { ...r, status: data.status, version: data.version } : r))
    } finally { setPublishingSP(null) }
  }

  async function createSP(e: FormEvent) {
    e.preventDefault()
    setCreatingSP(true); setSpError('')
    try {
      await api.post(`/client/${clientId}/sp-recommendations`, spForm)
      setShowCreateSP(false)
      setSpForm({ specific_problem_cosh_id: '', application_type: 'SPRAY' })
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSpError(msg || 'Failed.')
    } finally { setCreatingSP(false) }
  }

  async function handleAddTL(e: FormEvent) {
    e.preventDefault()
    if (!showAddTL) return
    setAddingTL(true); setTlError('')
    try {
      if (showAddTL.type === 'pg') {
        await api.post(`/client/${clientId}/pg-recommendations/${showAddTL.id}/timelines`, {
          name: tlForm.name, from_type: tlForm.from_type,
          from_value: parseInt(tlForm.from_value), to_value: parseInt(tlForm.to_value),
        })
        loadPGTimelines(showAddTL.id)
      } else {
        await api.post(`/client/${clientId}/sp-recommendations/${showAddTL.id}/timelines`, {
          name: tlForm.name, from_type: tlForm.from_type,
          from_value: parseInt(tlForm.from_value), to_value: parseInt(tlForm.to_value),
        })
        loadSPTimelines(showAddTL.id)
      }
      setShowAddTL(null)
      setTlForm({ name: '', from_type: 'DAYS_AFTER_DETECTION', from_value: '0', to_value: '7' })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setTlError(msg || 'Failed.')
    } finally { setAddingTL(false) }
  }

  const importedIds = new Set(pgRecs.map(p => p.parent_id).filter(Boolean))

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Crop Health Advisory</h1>
          <p className="text-slate-500 text-sm mt-0.5">Treatment recommendations for Problem Groups (PG) and Specific Problems (SP)</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['pg', 'sp'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium uppercase transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'pg' ? 'Problem Group' : 'Specific Problem'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'pg' ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={openImport}
              className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              ↓ Import from Global Library
            </button>
          </div>
          {pgRecs.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No PG recommendations yet. Import standard protocols from the global library, then customise them.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pgRecs.map(pg => (
                <div key={pg.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50" onClick={() => togglePG(pg.id)}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono font-medium text-slate-800 text-sm">{pg.problem_group_cosh_id}</p>
                        {pg.parent_id && <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">imported</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{pg.application_type} · v{pg.version}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[pg.status] || 'bg-slate-100 text-slate-500'}`}>{pg.status}</span>
                    {pg.status === 'DRAFT' && (
                      <button onClick={e => { e.stopPropagation(); publishPG(pg.id) }}
                        disabled={publishingPG === pg.id}
                        className="text-xs font-semibold text-white px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: colour }}>
                        {publishingPG === pg.id ? '…' : 'Publish'}
                      </button>
                    )}
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${expandedPG === pg.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {expandedPG === pg.id && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                      {!pgTimelines[pg.id] ? <p className="text-xs text-slate-400">Loading…</p>
                       : pgTimelines[pg.id].length === 0 ? <p className="text-xs text-slate-400">No timelines. Add treatment windows below.</p>
                       : pgTimelines[pg.id].map(tl => (
                        <div key={tl.id} className="rounded-xl border border-slate-100 p-4">
                          <p className="font-medium text-sm text-slate-800">{tl.name}</p>
                          <p className="text-xs text-slate-400">{tl.from_type} · Day {tl.from_value} → {tl.to_value}</p>
                          {tl.practices && tl.practices.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {tl.practices.map(p => (
                                <div key={p.id} className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${L0_COLOUR[p.l0_type] || 'bg-slate-100'}`}>{p.l0_type}</span>
                                  <span className="text-xs text-slate-600">{[p.l1_type, p.l2_type].filter(Boolean).join(' › ') || '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={() => { setShowAddTL({ type: 'pg', id: pg.id }); setTlError('') }}
                        className="text-xs font-medium" style={{ color: colour }}>
                        + Add Treatment Timeline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCreateSP(true)}
              className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              + New SP Protocol
            </button>
          </div>
          {spRecs.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No Specific Problem protocols yet. Create treatment recommendations for specific diseases, pests or deficiencies.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {spRecs.map(sp => (
                <div key={sp.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50" onClick={() => toggleSP(sp.id)}>
                    <div className="flex-1">
                      <p className="font-mono font-medium text-slate-800 text-sm">{sp.specific_problem_cosh_id}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{sp.application_type} · v{sp.version}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[sp.status] || 'bg-slate-100 text-slate-500'}`}>{sp.status}</span>
                    {sp.status === 'DRAFT' && (
                      <button onClick={e => { e.stopPropagation(); publishSP(sp.id) }}
                        disabled={publishingSP === sp.id}
                        className="text-xs font-semibold text-white px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: colour }}>
                        {publishingSP === sp.id ? '…' : 'Publish'}
                      </button>
                    )}
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${expandedSP === sp.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {expandedSP === sp.id && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                      {!spTimelines[sp.id] ? <p className="text-xs text-slate-400">Loading…</p>
                       : spTimelines[sp.id].length === 0 ? <p className="text-xs text-slate-400">No timelines yet.</p>
                       : spTimelines[sp.id].map(tl => (
                        <div key={tl.id} className="rounded-xl border border-slate-100 p-4">
                          <p className="font-medium text-sm text-slate-800">{tl.name}</p>
                          <p className="text-xs text-slate-400">{tl.from_type} · Day {tl.from_value} → {tl.to_value}</p>
                        </div>
                      ))}
                      <button onClick={() => { setShowAddTL({ type: 'sp', id: sp.id }); setTlError('') }}
                        className="text-xs font-medium" style={{ color: colour }}>
                        + Add Treatment Timeline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import from Global Library Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Import from Global PG Library</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Import standard treatment protocols from RootsTalk's global library. You'll get an independent copy to customise.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingGlobal ? (
                <p className="text-center text-slate-400 text-sm py-8">Loading global library…</p>
              ) : globalPGs.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8">No active global PG protocols yet. Ask your RootsTalk admin to publish some.</p>
              ) : (
                globalPGs.map(g => {
                  const alreadyImported = importedIds.has(g.id)
                  return (
                    <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                      <div className="flex-1">
                        <p className="font-mono text-sm text-slate-800">{g.problem_group_cosh_id}</p>
                        <p className="text-xs text-slate-400">{g.application_type} · v{g.version}</p>
                      </div>
                      {alreadyImported ? (
                        <span className="text-xs text-green-600 font-medium">✓ Imported</span>
                      ) : (
                        <button onClick={() => doImport(g.id)}
                          disabled={importing === g.id}
                          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ background: colour }}>
                          {importing === g.id ? 'Importing…' : 'Import'}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
              {importError && <p className="text-sm text-red-600 px-2">{importError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setShowImport(false)}
                className="w-full border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create SP Modal */}
      {showCreateSP && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">New Specific Problem Protocol</h2>
              <p className="text-slate-500 text-sm mt-0.5">Treatment for a specific disease, pest or nutrient deficiency in your territory</p>
            </div>
            <form onSubmit={createSP} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Specific Problem Cosh ID</label>
                <input value={spForm.specific_problem_cosh_id}
                  onChange={e => setSpForm(f => ({ ...f, specific_problem_cosh_id: e.target.value }))}
                  required placeholder="e.g. sp_blast_rice_kharif_telangana"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Application Type</label>
                <select value={spForm.application_type}
                  onChange={e => setSpForm(f => ({ ...f, application_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {APP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {spError && <p className="text-sm text-red-600">{spError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreateSP(false); setSpError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={creatingSP}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {creatingSP ? 'Creating…' : 'Create Protocol'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add TL Modal */}
      {showAddTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Treatment Timeline</h2>
            </div>
            <form onSubmit={handleAddTL} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input value={tlForm.name} onChange={e => setTlForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="e.g. Immediate Treatment (Day 0–3)"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Reference</label>
                <select value={tlForm.from_type} onChange={e => setTlForm(f => ({ ...f, from_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="DAYS_AFTER_DETECTION">Days After Detection</option>
                  <option value="DAYS_BEFORE_DETECTION">Days Before Detection</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From (day)</label>
                  <input type="number" value={tlForm.from_value} onChange={e => setTlForm(f => ({ ...f, from_value: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To (day)</label>
                  <input type="number" value={tlForm.to_value} onChange={e => setTlForm(f => ({ ...f, to_value: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
              </div>
              {tlError && <p className="text-sm text-red-600">{tlError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddTL(null); setTlError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm">Cancel</button>
                <button type="submit" disabled={addingTL}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {addingTL ? 'Adding…' : 'Add Timeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
