'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { PracticeFormModal, type ExistingPractice } from '@/components/advisory-authoring/PracticeFormModal'
import { RelationsSection } from '@/components/advisory-authoring/RelationsSection'
import { CQsSection } from '@/components/advisory-authoring/CQsSection'
import { practiceShortLabel } from '@/lib/practice-label'

// Standard Q&A — advisory body editor (UCAT pipe-3, spec §14.9).
// Phase 4 of CA-portal parity (2026-05-17) brought this in line
// with the CA-CCA / CA-PG / CA-SP editors: shared PracticeFormModal,
// click-to-expand element detail, Edit Timeline modal with Status.

interface PracticeElement {
  id?: string
  element_type: string
  label?: string
  cosh_ref: string | null
  value: string | null
  unit_cosh_id: string | null
  display_value: string | null
  display_order: number
}
interface Practice {
  id: string; timeline_id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null; l2_type: string | null
  display_order: number; is_special_input: boolean
  is_brand_locked?: boolean
  frequency_days: number | null
  relation_id?: string | null
  elements: PracticeElement[]
}
interface Timeline {
  id: string; standard_response_id: string; parent_kind: string
  name: string; from_type: string; from_value: number; to_value: number
  status?: 'ACTIVE' | 'INACTIVE'
  practices: Practice[]
}
type SRStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

interface SR {
  id: string; question_text: string; crop_cosh_id: string | null
  status: SRStatus
}

const SR_STATUS_CHIP: Record<SRStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-amber-50 text-amber-700',
}

const L0_COLOUR: Record<string, string> = {
  INPUT: 'bg-blue-100 text-blue-700',
  NON_INPUT: 'bg-purple-100 text-purple-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700',
  MEDIA: 'bg-pink-100 text-pink-700',
}

const emptyTLForm = {
  name: '',
  from_value: '0',
  to_value: '7',
}

// Module-level constant so the array identity is stable across
// renders — the modal's reset effect uses this as a dep key.
const QA_AGNOSTIC_HIDDEN_L0: string[] = ['INPUT']

export default function StandardResponseDetailPage() {
  const params = useParams<{ srId: string }>()
  const srId = params?.srId
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [sr, setSr] = useState<SR | null>(null)
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [practiceMap, setPracticeMap] = useState<Record<string, Practice[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedPractice, setExpandedPractice] = useState<string | null>(null)

  const [showAddTL, setShowAddTL] = useState(false)
  const [tlForm, setTlForm] = useState(emptyTLForm)
  const [savingTL, setSavingTL] = useState(false)

  // Edit timeline (Phase 4 of CA-portal parity, 2026-05-17). QA
  // Reference Type is fixed to DAYS_AFTER_RESPONSE — locked.
  const [showEditTL, setShowEditTL] = useState<Timeline | null>(null)
  const [editingTL, setEditingTL] = useState(false)
  const [editTLError, setEditTLError] = useState('')
  const [editTLForm, setEditTLForm] = useState({
    name: '', from_value: '0', to_value: '7', status: 'ACTIVE',
  })

  // Practice authoring goes through <PracticeFormModal>; mode flips
  // by editingPractice.
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  // Relations mirror — feeds CQsSection (Batch N2).
  const [relationsByTimeline, setRelationsByTimeline] = useState<Record<string, unknown[]>>({})

  // Crop friendly name — fetched once for crop_cosh_id so the UI
  // shows "Tomato" instead of a raw Cosh UUID.
  const [cropName, setCropName] = useState<string>('')
  const [editingPractice, setEditingPractice] = useState<{ timelineId: string; practice: Practice } | null>(null)

  // Edit details modal — question text + active/inactive toggle.
  // Toggle is disabled while DRAFT (Inactive only makes sense after
  // publish; DRAFTs are already Pundit-invisible). Replaces the older
  // pencil-style inline edit (Batch H).
  const [showEditSR, setShowEditSR] = useState(false)
  const [editSRForm, setEditSRForm] = useState({ question_text: '', is_active: true })
  const [savingSR, setSavingSR] = useState(false)
  const [editSRError, setEditSRError] = useState('')

  async function load() {
    if (!clientId || !srId) return
    setLoading(true); setError('')
    try {
      const [allRes, tlsRes] = await Promise.all([
        api.get<SR[]>(`/client/${clientId}/standard-responses`),
        api.get<Timeline[]>(`/client/${clientId}/standard-responses/${srId}/timelines`),
      ])
      const found = (allRes.data as SR[]).find(s => s.id === srId)
      if (!found) { setError('Entry not found'); return }
      setSr(found)
      const sorted = tlsRes.data.slice().sort((a, b) => a.from_value - b.from_value)
      setTimelines(sorted)
      const seed: Record<string, Practice[]> = {}
      for (const tl of sorted) {
        if (tl.practices) seed[tl.id] = tl.practices
      }
      setPracticeMap(seed)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to load.'))
    } finally { setLoading(false) }
  }

  // Per-timeline practices with elements + server-resolved labels.
  // Polymorphic endpoint serves any pipe (CCA / PG / SP / QA).
  const loadPractices = async (tlId: string) => {
    if (!clientId) return
    try {
      const { data } = await api.get<Practice[]>(
        `/client/${clientId}/timelines/${tlId}/practices`,
      )
      setPracticeMap(m => ({ ...m, [tlId]: data.sort((a, b) => a.display_order - b.display_order) }))
    } catch { /* leave existing entry alone */ }
  }

  useEffect(() => { load() }, [clientId, srId])

  // Resolve crop_cosh_id → friendly name. Runs after `load` has
  // populated `sr`. No-op for crop-agnostic responses.
  useEffect(() => {
    if (!clientId || !sr?.crop_cosh_id) { setCropName(''); return }
    api.get<{ crop_cosh_id: string; crop_name_en?: string | null }[]>(
      `/client/${clientId}/crops`,
    ).then(r => {
      const match = r.data.find(c => c.crop_cosh_id === sr.crop_cosh_id)
      if (match?.crop_name_en) setCropName(match.crop_name_en)
    }).catch(() => { /* fallback handled in UI */ })
  }, [clientId, sr?.crop_cosh_id])

  async function addTimeline(e: FormEvent) {
    e.preventDefault()
    if (!tlForm.name.trim()) return
    setSavingTL(true)
    try {
      await api.post(`/client/${clientId}/standard-responses/${srId}/timelines`, {
        name: tlForm.name.trim(),
        from_type: 'DAYS_AFTER_RESPONSE',  // backend default; explicit for clarity
        from_value: parseInt(tlForm.from_value || '0'),
        to_value: parseInt(tlForm.to_value || '0'),
      })
      setShowAddTL(false)
      setTlForm(emptyTLForm)
      load()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to add timeline.'))
    } finally { setSavingTL(false) }
  }

  async function deleteTimeline(tl: Timeline) {
    if (!confirm(`Delete timeline "${tl.name}" and all its practices?`)) return
    try {
      await api.delete(`/client/${clientId}/standard-responses/${srId}/timelines/${tl.id}`)
      load()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete.'))
    }
  }

  async function deletePractice(tlId: string, practiceId: string) {
    if (!confirm('Delete this practice?')) return
    try {
      await api.delete(
        `/client/${clientId}/standard-responses/${srId}/timelines/${tlId}/practices/${practiceId}`,
      )
      await loadPractices(tlId)
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete.'))
    }
  }

  function openEditTimeline(tl: Timeline) {
    setEditTLForm({
      name: tl.name,
      from_value: String(tl.from_value),
      to_value: String(tl.to_value),
      status: tl.status || 'ACTIVE',
    })
    setEditTLError('')
    setShowEditTL(tl)
  }

  async function handleEditTimeline(e: FormEvent) {
    e.preventDefault()
    if (!showEditTL) return
    setEditTLError('')
    const fromVal = parseInt(editTLForm.from_value, 10)
    const toVal = parseInt(editTLForm.to_value, 10)
    if (Number.isNaN(fromVal) || Number.isNaN(toVal)) {
      setEditTLError('FROM and TO must be whole numbers.'); return
    }
    if (fromVal > toVal) {
      setEditTLError('FROM must be ≤ TO (the window cannot run backwards).'); return
    }
    setEditingTL(true)
    try {
      const { data } = await api.put<Timeline>(
        `/client/${clientId}/standard-responses/${srId}/timelines/${showEditTL.id}`,
        {
          name: editTLForm.name,
          from_value: fromVal,
          to_value: toVal,
          status: editTLForm.status,
        },
      )
      setTimelines(tls => tls.map(t => t.id === data.id ? { ...t, ...data, practices: t.practices } : t))
      setShowEditTL(null)
    } catch (err: unknown) {
      setEditTLError(extractErrorMessage(err, 'Failed to save timeline.'))
    } finally { setEditingTL(false) }
  }

  function openEditSR() {
    if (!sr) return
    setEditSRForm({
      question_text: sr.question_text,
      is_active: sr.status !== 'INACTIVE',
    })
    setEditSRError('')
    setShowEditSR(true)
  }

  async function handleEditSR(e: FormEvent) {
    e.preventDefault()
    if (!sr || !clientId) return
    const next = editSRForm.question_text.trim()
    if (!next) { setEditSRError('Question text is required.'); return }
    setSavingSR(true); setEditSRError('')
    try {
      let updated = sr
      if (next !== sr.question_text) {
        // Backend PUT wipes-and-sets both fields, so preserve crop.
        const { data } = await api.put<SR>(
          `/client/${clientId}/standard-responses/${srId}`,
          { question_text: next, crop_cosh_id: sr.crop_cosh_id },
        )
        updated = data
      }
      // Toggle the lifecycle flag — only meaningful once published.
      // The endpoints refuse out-of-state calls so the disabled-toggle
      // UI gate is doubled by a backend guard.
      if (sr.status === 'ACTIVE' && !editSRForm.is_active) {
        const { data } = await api.post<SR>(
          `/client/${clientId}/standard-responses/${srId}/deactivate`,
        )
        updated = { ...updated, status: data.status }
      } else if (sr.status === 'INACTIVE' && editSRForm.is_active) {
        const { data } = await api.post<SR>(
          `/client/${clientId}/standard-responses/${srId}/activate`,
        )
        updated = { ...updated, status: data.status }
      }
      setSr(updated)
      setShowEditSR(false)
    } catch (err: unknown) {
      setEditSRError(extractErrorMessage(err, 'Failed to save changes.'))
    } finally { setSavingSR(false) }
  }

  if (loading) {
    return <div className="py-20 text-center text-slate-400">Loading…</div>
  }
  if (error || !sr) {
    return (
      <div className="max-w-5xl mx-auto py-12 text-center">
        <p className="text-red-600 text-sm">{error || 'Not found'}</p>
        <Link href="/standard-responses" className="text-sm text-slate-500 hover:underline mt-3 inline-block">
          ← Back to library
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <Link href="/standard-responses" className="text-xs text-slate-400 hover:text-slate-600">
            ← Back to library
          </Link>
          <Link href={`/standard-responses/${srId}/preview`}
            className="text-sm font-medium px-3 py-1.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            👁 {sr.status === 'DRAFT' ? 'Preview and Publish' : 'Preview'}
          </Link>
        </div>
        <div className="flex items-start gap-3 flex-wrap mt-2">
          <h1 className="text-xl font-bold text-slate-900 flex-1">{sr.question_text}</h1>
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${SR_STATUS_CHIP[sr.status] || SR_STATUS_CHIP.DRAFT}`}>
            {sr.status?.toLowerCase() || 'draft'}
          </span>
          {sr.crop_cosh_id ? (
            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
              {cropName || '(loading crop…)'}
            </span>
          ) : (
            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
              Common to all crops
            </span>
          )}
          <button type="button" onClick={openEditSR}
            className="text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Edit details
          </button>
        </div>
        <p className="text-slate-500 text-sm mt-2">
          When a FarmPundit picks this question, the timelines below merge into the farmer's advisory
          (anchored at "days after response"), with full Practice and purchase support — same as a CHA recommendation.
        </p>
      </div>

      {/* Timelines */}
      <div className="space-y-3">
        {timelines.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-slate-200">
            <p className="text-slate-500 text-sm">No timelines yet. Add the first treatment window to start the advisory.</p>
          </div>
        ) : (
          timelines.map(tl => (
            <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <button onClick={() => {
                  const next = expanded === tl.id ? null : tl.id
                  setExpanded(next)
                  if (next === tl.id) loadPractices(tl.id)
                }}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                <div className="text-left">
                  <p className="font-semibold text-slate-800">
                    {tl.name}
                    {tl.status === 'INACTIVE' && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Inactive</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    Day {tl.from_value} → {tl.to_value} after response · {(practiceMap[tl.id] || tl.practices).length} practice{(practiceMap[tl.id] || tl.practices).length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={e => { e.stopPropagation(); openEditTimeline(tl) }}
                    className="text-slate-300 hover:text-blue-500 p-1.5"
                    title="Edit timeline">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteTimeline(tl) }}
                    className="text-slate-300 hover:text-red-400 p-1.5"
                    title="Delete timeline">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <span className="text-slate-400 text-sm ml-1">
                    {expanded === tl.id ? '▾' : '▸'}
                  </span>
                </div>
              </button>

              {expanded === tl.id && (
                <div className="px-5 pb-4 pt-1 border-t border-slate-50 space-y-2">
                  {!practiceMap[tl.id] ? (
                    <p className="text-xs text-slate-400 py-3">Loading practices…</p>
                  ) : practiceMap[tl.id].length === 0 ? (
                    <p className="text-xs text-slate-400 py-3">No practices yet.</p>
                  ) : (
                    practiceMap[tl.id].map(p => {
                      const isPExpanded = expandedPractice === p.id
                      const hasElements = (p.elements?.length || 0) > 0
                      return (
                        <div key={p.id} className="border-b border-slate-50 last:border-0">
                          <div
                            className="flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded"
                            onClick={() => setExpandedPractice(isPExpanded ? null : p.id)}>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${L0_COLOUR[p.l0_type] || 'bg-slate-100'}`}>{p.l0_type}</span>
                            <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">
                              {p.l2_type ? practiceShortLabel(p) : <span className="text-slate-400 italic">No sub-type</span>}
                            </span>
                            {p.is_special_input && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">special</span>}
                            {p.is_brand_locked && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full" title="Locked brand">🔒 locked</span>}
                            {p.frequency_days != null && <span className="text-[10px] text-slate-500 px-1.5 py-0.5 bg-slate-50 rounded-full">every {p.frequency_days}d</span>}
                            <span className="text-[11px] text-slate-400">
                              {hasElements ? `${p.elements!.length} element${p.elements!.length === 1 ? '' : 's'}` : 'no elements'}
                            </span>
                            <button onClick={e => {
                              e.stopPropagation()
                              setEditingPractice({ timelineId: tl.id, practice: p })
                              setShowAddPractice(tl.id)
                            }}
                              className="text-slate-300 hover:text-blue-500 p-1" title="Edit practice">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button onClick={e => { e.stopPropagation(); deletePractice(tl.id, p.id) }}
                              className="text-slate-300 hover:text-red-400 p-1" title="Delete practice">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                            <svg className={`w-3.5 h-3.5 text-slate-300 transition-transform ${isPExpanded ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                          {isPExpanded && (
                            <div className="ml-2 pl-3 border-l-2 border-slate-100 py-2 space-y-1 mb-2">
                              {hasElements ? p.elements!.map(el => (
                                <div key={el.element_type} className="flex items-baseline gap-2 text-xs">
                                  <span className="text-slate-500 min-w-[140px] shrink-0">{el.label || el.element_type}:</span>
                                  <span className="text-slate-800 font-medium min-w-0">
                                    {el.display_value || el.value || <span className="text-slate-300 italic">—</span>}
                                  </span>
                                </div>
                              )) : (
                                <p className="text-xs text-slate-400 italic">No elements on this Practice.</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                  <button
                    onClick={() => { setEditingPractice(null); setShowAddPractice(tl.id) }}
                    className="text-xs font-medium mt-2"
                    style={{ color: colour }}>
                    + Add Practice
                  </button>

                  {/* Relations + CQs are crop-specific by nature
                      (rules reference crop attributes). Hide them on
                      "Common to all crops" SRs — same scope rule as
                      INPUT practices below. */}
                  {sr.crop_cosh_id && (
                    <>
                      <RelationsSection
                        timelineId={tl.id}
                        timelineName={tl.name}
                        practices={(practiceMap[tl.id] || []).map(p => ({
                          id: p.id,
                          l0_type: p.l0_type,
                          l1_type: p.l1_type,
                          l2_type: p.l2_type,
                          is_special_input: p.is_special_input,
                          elements: p.elements?.map(e => ({
                            element_type: e.element_type,
                            value: e.value,
                            display_value: e.display_value,
                          })),
                        }))}
                        pipe={{
                          pipe: 'QA_CLIENT',
                          clientId: clientId || '',
                          parentId: srId || '',
                        }}
                        onRelationsChange={(tid, rels) =>
                          setRelationsByTimeline(m => ({ ...m, [tid]: rels }))
                        }
                      />
                      <CQsSection
                        timelineId={tl.id}
                        timelineName={tl.name}
                        practices={(practiceMap[tl.id] || []).map(p => ({
                          id: p.id,
                          l0_type: p.l0_type,
                          l1_type: p.l1_type,
                          l2_type: p.l2_type,
                          is_special_input: p.is_special_input,
                          relation_id: p.relation_id ?? null,
                          elements: p.elements?.map(e => ({
                            element_type: e.element_type,
                            value: e.value,
                            display_value: e.display_value,
                          })),
                        }))}
                        relations={(relationsByTimeline[tl.id] || []) as never}
                        pipe={{
                          pipe: 'QA_CLIENT',
                          clientId: clientId || '',
                          parentId: srId || '',
                        }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        <button onClick={() => { setShowAddTL(true); setTlForm(emptyTLForm) }}
          className="w-full text-white font-semibold py-3 rounded-2xl text-sm shadow-sm"
          style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
          + Add Timeline
        </button>
      </div>

      {/* Add Timeline Modal */}
      {showAddTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                A treatment window measured in days after the FarmPundit's response is delivered to the farmer.
              </p>
            </div>
            <form onSubmit={addTimeline} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input value={tlForm.name}
                  onChange={e => setTlForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="e.g. Immediate (Day 0–3)"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From day</label>
                  <input type="number" min="0" value={tlForm.from_value}
                    onChange={e => setTlForm(f => ({ ...f, from_value: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To day</label>
                  <input type="number" min="0" value={tlForm.to_value}
                    onChange={e => setTlForm(f => ({ ...f, to_value: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Day 0 is the day the response is delivered. Set "From day" to 0 for immediate-action windows.
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddTL(false); setTlForm(emptyTLForm) }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm">Cancel</button>
                <button type="submit" disabled={savingTL}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {savingTL ? 'Adding…' : 'Add Timeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Practice — shared modal (Phase 4 of CA-portal
          parity, 2026-05-17). cropCoshId comes from the SR row;
          empty when the question is crop-agnostic. */}
      <PracticeFormModal
        open={!!showAddPractice}
        mode={editingPractice ? 'edit' : 'create'}
        timelineId={showAddPractice || ''}
        cropCoshId={sr?.crop_cosh_id || ''}
        existingPractice={editingPractice?.practice as ExistingPractice | undefined}
        contextSubtitle={(() => {
          if (!showAddPractice) return undefined
          const tl = timelines.find(t => t.id === showAddPractice)
          if (!tl) return undefined
          return `${tl.name} · Day ${tl.from_value} → ${tl.to_value} after response`
        })()}
        timelineWindow={(() => {
          if (!showAddPractice) return undefined
          const tl = timelines.find(t => t.id === showAddPractice)
          if (!tl) return undefined
          return { from_value: tl.from_value, to_value: tl.to_value }
        })()}
        pipe={{ pipe: 'QA_CLIENT', clientId: clientId || '', parentId: srId || '' }}
        hiddenL0Types={sr?.crop_cosh_id ? undefined : QA_AGNOSTIC_HIDDEN_L0}
        usedCommonNames={(() => {
          if (!showAddPractice) return new Set<string>()
          const peers = practiceMap[showAddPractice] || []
          const out = new Set<string>()
          for (const p of peers) {
            if (p.l1_type !== 'PESTICIDE' && p.l1_type !== 'FERTILIZER') continue
            const cn = (p.elements || []).find(e => e.element_type === 'COMMON_NAME')?.cosh_ref
            if (cn) out.add(cn)
          }
          return out
        })()}
        onClose={() => {
          setShowAddPractice(null)
          setEditingPractice(null)
        }}
        onSaved={() => {
          const tlId = showAddPractice
          if (tlId) loadPractices(tlId)
        }}
      />

      {/* Edit Standard Response modal — question text + active/inactive */}
      {showEditSR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit details</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Crop: <span className="font-medium text-slate-700">{sr.crop_cosh_id ? (cropName || sr.crop_cosh_id) : 'Common to all crops'}</span>
                <span className="ml-1 text-xs text-slate-400">(locked)</span>
              </p>
            </div>
            <form onSubmit={handleEditSR} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Question</label>
                <textarea value={editSRForm.question_text}
                  onChange={e => setEditSRForm(f => ({ ...f, question_text: e.target.value }))}
                  required rows={3}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Visibility</label>
                <div className="flex gap-2">
                  {([
                    { v: true, label: 'Active' },
                    { v: false, label: 'Inactive' },
                  ] as const).map(opt => {
                    const selected = editSRForm.is_active === opt.v
                    const draft = sr.status === 'DRAFT'
                    return (
                      <button key={String(opt.v)} type="button"
                        disabled={draft}
                        onClick={() => setEditSRForm(f => ({ ...f, is_active: opt.v }))}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium border ${
                          selected
                            ? (opt.v
                                ? 'bg-green-50 border-green-300 text-green-700'
                                : 'bg-amber-50 border-amber-300 text-amber-700')
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        } ${draft ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {sr.status === 'DRAFT'
                    ? 'Publish this question first (from Preview and Publish) to control visibility.'
                    : 'Inactive hides the question from FarmPundits without losing the authored advisory.'}
                </p>
              </div>
              {editSRError && <p className="text-sm text-red-600">{editSRError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowEditSR(false); setEditSRError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingSR || !editSRForm.question_text.trim()}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {savingSR ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Timeline modal */}
      {showEditTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Reference Type: <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">Days After Response</span>
                <span className="ml-2 text-xs text-slate-400">(locked — QA timelines anchor on response delivery)</span>
              </p>
            </div>
            <form onSubmit={handleEditTimeline} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input value={editTLForm.name}
                  onChange={e => setEditTLForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From (Day)</label>
                  <input type="number" min="0" value={editTLForm.from_value}
                    onChange={e => setEditTLForm(f => ({ ...f, from_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To (Day)</label>
                  <input type="number" min="0" value={editTLForm.to_value}
                    onChange={e => setEditTLForm(f => ({ ...f, to_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <div className="flex gap-2">
                  {(['ACTIVE', 'INACTIVE'] as const).map(s => (
                    <button key={s} type="button"
                      onClick={() => setEditTLForm(f => ({ ...f, status: s }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border ${
                        editTLForm.status === s
                          ? (s === 'ACTIVE'
                              ? 'bg-green-50 border-green-300 text-green-700'
                              : 'bg-slate-100 border-slate-300 text-slate-700')
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Inactive timelines stay visible on this page with a badge but are excluded from the farmer&apos;s advisory when a Pundit picks this SR.
                </p>
              </div>
              {editTLError && <p className="text-sm text-red-600">{editTLError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowEditTL(null); setEditTLError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={editingTL}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {editingTL ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
