'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Rec {
  id: string
  problem_group_cosh_id: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

interface Practice {
  id: string
  l0_type: string
  l1_type: string | null
  l2_type: string | null
  display_order: number
  is_special_input: boolean
}

interface Timeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  practices: Practice[]
}

interface Problem {
  cosh_id: string
  name_en: string
}

interface PublishReadiness {
  ready: boolean
  status: string
  version: number
  blocker_code?: string
  missing?: { code: string; message: string }[]
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}
const L0_COLOUR: Record<string, string> = {
  INPUT: 'bg-blue-100 text-blue-700',
  NON_INPUT: 'bg-purple-100 text-purple-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700',
  MEDIA: 'bg-pink-100 text-pink-700',
}

export default function RecDetailPage() {
  const { recId } = useParams<{ recId: string }>()
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [rec, setRec] = useState<Rec | null>(null)
  const [problemName, setProblemName] = useState('')
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Add timeline
  const [showAddTL, setShowAddTL] = useState(false)
  const [addingTL, setAddingTL] = useState(false)
  const [tlError, setTlError] = useState('')
  const [tlForm, setTlForm] = useState({ name: '', from_value: '0', to_value: '7' })

  // Add practice (per timeline)
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  const [addingPractice, setAddingPractice] = useState(false)
  const [practiceError, setPracticeError] = useState('')
  const [practiceForm, setPracticeForm] = useState({
    l0_type: 'INPUT', l1_type: '', l2_type: '',
    display_order: '0', is_special_input: false,
  })

  // Publish
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pubError, setPubError] = useState('')

  const loadRec = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<Rec>(`/client/${clientId}/pg-recommendations/${recId}`)
      setRec(data)
    } catch {
      router.replace('/cha/recommendations')
    }
  }
  const loadTimelines = async () => {
    if (!clientId || !recId) return
    const { data } = await api.get<Timeline[]>(
      `/client/${clientId}/pg-recommendations/${recId}/timelines`,
    )
    setTimelines(data.sort((a, b) => a.from_value - b.from_value))
  }
  const loadReadiness = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<PublishReadiness>(
        `/client/${clientId}/pg-recommendations/${recId}/publish-readiness`,
      )
      setReadiness(data)
    } catch {
      setReadiness(null)
    }
  }
  const loadProblemName = async () => {
    if (!clientId) return
    try {
      const { data } = await api.get<Problem[]>(`/client/${clientId}/cha/problems`)
      if (rec) {
        const match = data.find(p => p.cosh_id === rec.problem_group_cosh_id)
        if (match) setProblemName(match.name_en)
      }
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    loadRec()
    loadTimelines()
    loadReadiness()
  }, [clientId, recId])

  useEffect(() => { loadProblemName() }, [rec, clientId])

  async function handleAddTimeline(e: FormEvent) {
    e.preventDefault()
    setAddingTL(true); setTlError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/${recId}/timelines`, {
        name: tlForm.name,
        from_type: 'DAYS_AFTER_DETECTION',
        from_value: parseInt(tlForm.from_value, 10),
        to_value: parseInt(tlForm.to_value, 10),
      })
      setShowAddTL(false)
      setTlForm({ name: '', from_value: '0', to_value: '7' })
      await loadTimelines()
      loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setTlError(msg || 'Failed to add timeline.')
    } finally {
      setAddingTL(false)
    }
  }

  async function handleAddPractice(e: FormEvent) {
    e.preventDefault()
    if (!showAddPractice) return
    setAddingPractice(true); setPracticeError('')
    try {
      await api.post(
        `/client/${clientId}/pg-recommendations/${recId}/timelines/${showAddPractice}/practices`,
        {
          l0_type: practiceForm.l0_type,
          l1_type: practiceForm.l1_type || null,
          l2_type: practiceForm.l2_type || null,
          display_order: parseInt(practiceForm.display_order, 10),
          is_special_input: practiceForm.is_special_input,
          elements: [],
        },
      )
      setShowAddPractice(null)
      setPracticeForm({ l0_type: 'INPUT', l1_type: '', l2_type: '', display_order: '0', is_special_input: false })
      await loadTimelines()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setPracticeError(msg || 'Failed to add practice.')
    } finally {
      setAddingPractice(false)
    }
  }

  async function deleteTimeline(tl: Timeline) {
    if (!confirm(`Delete timeline "${tl.name}"? All practices in it will also be removed.`)) return
    await api.delete(`/client/${clientId}/pg-recommendations/${recId}/timelines/${tl.id}`)
    await loadTimelines()
    loadReadiness()
  }

  async function deletePractice(timelineId: string, practiceId: string) {
    if (!confirm('Delete this practice?')) return
    await api.delete(
      `/client/${clientId}/pg-recommendations/${recId}/timelines/${timelineId}/practices/${practiceId}`,
    )
    await loadTimelines()
  }

  async function handlePublish() {
    setPublishing(true); setPubError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/${recId}/publish`)
      setShowPublishConfirm(false)
      await loadRec()
      await loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setPubError(msg || 'Failed to publish.')
      await loadReadiness()
    } finally {
      setPublishing(false)
    }
  }

  if (!rec) return (
    <div className="max-w-4xl mx-auto pt-20 text-center text-slate-400">Loading recommendation…</div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <Link href="/cha/recommendations" className="mt-1 text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">
              {problemName || rec.problem_group_cosh_id}
            </h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[rec.status]}`}>
              {rec.status}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {rec.area_or_plant === 'AREA_WISE' ? 'Area-wise crops' :
             rec.area_or_plant === 'PLANT_WISE' ? 'Plant-wise crops' : '(no bundle set)'}
            {' · '}v{rec.version}
          </p>
        </div>
        {rec.status === 'DRAFT' && (
          <button onClick={() => setShowPublishConfirm(true)}
            disabled={publishing || !readiness?.ready}
            title={!readiness?.ready ? 'Resolve the items below first' : ''}
            className="shrink-0 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            {publishing ? 'Publishing…' : '✓ Publish'}
          </button>
        )}
      </div>

      {/* Pre-publish gate panel */}
      {rec.status === 'DRAFT' && readiness && (
        readiness.ready ? (
          <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-green-600 mt-0.5">✓</span>
            <div className="text-sm">
              <p className="font-medium text-green-800">Ready to publish</p>
              <p className="text-green-700 mt-0.5">
                Click <strong>Publish</strong> to make this recommendation v{rec.version + 1}.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-amber-600 mt-0.5">⚠</span>
              <div className="text-sm">
                <p className="font-medium text-amber-800">
                  {readiness.missing?.length === 1
                    ? '1 thing to fix before publishing'
                    : `${readiness.missing?.length || 0} things to fix before publishing`}
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 ml-7 text-sm text-amber-900">
              {(readiness.missing || []).map((m, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5 text-xs">●</span>
                  <span>{m.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {/* Timelines */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">
            Timelines <span className="text-slate-400 font-normal text-sm">({timelines.length})</span>
          </h2>
          <button onClick={() => setShowAddTL(true)}
            className="text-sm font-medium px-3 py-1.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            + Add Timeline
          </button>
        </div>

        {timelines.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
            <p className="text-slate-400 text-4xl mb-3">📅</p>
            <p className="text-slate-600 font-medium">No timelines yet</p>
            <p className="text-slate-400 text-sm mt-1">
              Add the first timeline (in days after problem detection) to start authoring practices.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {timelines.map(tl => (
              <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <button onClick={() => setExpanded(expanded === tl.id ? null : tl.id)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                  <div className="text-left">
                    <p className="font-medium text-slate-800">{tl.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">
                      {tl.from_value}–{tl.to_value} days after detection · {tl.practices.length} practice{tl.practices.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span onClick={e => { e.stopPropagation(); deleteTimeline(tl) }}
                      className="text-xs text-red-400 hover:text-red-600 cursor-pointer px-2 py-1">
                      Remove
                    </span>
                    <span className="text-slate-400 text-sm">
                      {expanded === tl.id ? '▾' : '▸'}
                    </span>
                  </div>
                </button>

                {expanded === tl.id && (
                  <div className="px-5 pb-4 pt-1 border-t border-slate-50 space-y-2">
                    {tl.practices.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3">No practices yet.</p>
                    ) : (
                      tl.practices.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${L0_COLOUR[p.l0_type] || 'bg-slate-100 text-slate-600'}`}>
                              {p.l0_type}
                            </span>
                            <span className="text-sm text-slate-700">
                              {p.l2_type || p.l1_type || '(unset)'}
                            </span>
                            {p.is_special_input && (
                              <span className="text-[10px] text-purple-600 italic">special-input</span>
                            )}
                          </div>
                          <button onClick={() => deletePractice(tl.id, p.id)}
                            className="text-xs text-red-400 hover:text-red-600">
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                    <button onClick={() => setShowAddPractice(tl.id)}
                      className="w-full mt-2 text-sm py-2 rounded-xl border border-dashed border-slate-200 text-slate-500 hover:bg-slate-50">
                      + Add Practice
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Timeline modal */}
      {showAddTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Pick a day-range after the farmer reports the problem.
              </p>
            </div>
            <form onSubmit={handleAddTimeline} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input value={tlForm.name}
                  onChange={e => setTlForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="e.g. Week 1 — initial response"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From (days after detection)</label>
                  <input type="number" min="0" value={tlForm.from_value}
                    onChange={e => setTlForm(f => ({ ...f, from_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To (days after detection)</label>
                  <input type="number" min="0" value={tlForm.to_value}
                    onChange={e => setTlForm(f => ({ ...f, to_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              {tlError && <p className="text-sm text-red-600">{tlError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowAddTL(false); setTlError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
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

      {/* Add Practice modal */}
      {showAddPractice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Practice</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Quick-create. Add elements (dosage, brand, application method) by editing the practice after it lands.
              </p>
            </div>
            <form onSubmit={handleAddPractice} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">L0 type</label>
                <select value={practiceForm.l0_type}
                  onChange={e => setPracticeForm(f => ({ ...f, l0_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                  <option value="INPUT">INPUT</option>
                  <option value="NON_INPUT">NON_INPUT</option>
                  <option value="INSTRUCTION">INSTRUCTION</option>
                  <option value="MEDIA">MEDIA</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">L1 type (optional)</label>
                <input value={practiceForm.l1_type}
                  onChange={e => setPracticeForm(f => ({ ...f, l1_type: e.target.value }))}
                  placeholder="e.g. PESTICIDE"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">L2 type (optional)</label>
                <input value={practiceForm.l2_type}
                  onChange={e => setPracticeForm(f => ({ ...f, l2_type: e.target.value }))}
                  placeholder="e.g. CHEMICAL_PESTICIDES"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={practiceForm.is_special_input}
                  onChange={e => setPracticeForm(f => ({ ...f, is_special_input: e.target.checked }))} />
                Special input
              </label>
              {practiceError && <p className="text-sm text-red-600">{practiceError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowAddPractice(null); setPracticeError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={addingPractice}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {addingPractice ? 'Adding…' : 'Add Practice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish confirmation modal */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                Publish {problemName || rec.problem_group_cosh_id}?
              </h2>
              <p className="text-slate-500 text-sm mt-1.5">
                {rec.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'} bundle
                {rec.version > 0 ? ` will become v${rec.version + 1}` : ''}.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <p><strong>Timelines:</strong> {timelines.length}</p>
                <p><strong>Practices:</strong> {timelines.reduce((s, t) => s + t.practices.length, 0)}</p>
              </div>
              {pubError && <p className="text-sm text-red-600">{pubError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => { setShowPublishConfirm(false); setPubError('') }}
                disabled={publishing}
                className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handlePublish} disabled={publishing}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {publishing ? 'Publishing…' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
