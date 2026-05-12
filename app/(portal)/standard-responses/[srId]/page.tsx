'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

// Standard Q&A — advisory body editor (UCAT pipe-3, spec §14.9).
// Forks the structure of /cha and /advisory/[packageId]: a list of
// Timelines with nested Practices, expandable per timeline. Add/
// Delete supported at both the Timeline and Practice levels.
//
// Element-level authoring (the leaf field-set on a Practice — e.g.
// pesticide name, dose, frequency) is NOT in this editor yet.
// Neither CCA nor CHA expose element editing in the CA portal
// today — elements come from Cosh imports there. Q&A matches that
// V1 ceiling. Element authoring is a cross-cutting V1.1 feature
// that affects all three pipes uniformly.

interface ElementOut {
  id: string; element_type: string; cosh_ref: string | null
  value: string | null; unit_cosh_id: string | null
  display_order: number
}
interface PracticeOut {
  id: string; timeline_id: string
  l0_type: string; l1_type: string | null; l2_type: string | null
  display_order: number; is_special_input: boolean
  frequency_days: number | null
  elements: ElementOut[]
}
interface TimelineOut {
  id: string; standard_response_id: string; parent_kind: string
  name: string; from_type: string; from_value: number; to_value: number
  practices: PracticeOut[]
}
interface SR {
  id: string; question_text: string; crop_cosh_id: string | null
}

const L0_OPTIONS = ['INPUT', 'NON_INPUT', 'INSTRUCTION', 'MEDIA']
const L0_COLOUR: Record<string, string> = {
  INPUT: 'bg-emerald-100 text-emerald-700',
  NON_INPUT: 'bg-blue-100 text-blue-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700',
  MEDIA: 'bg-purple-100 text-purple-700',
}

const emptyTLForm = {
  name: '',
  from_value: '0',
  to_value: '7',
}
const emptyPracticeForm = {
  l0_type: 'INPUT',
  l1_type: '',
  l2_type: '',
  display_order: '0',
  is_special_input: false,
  frequency_days: '',
}

export default function StandardResponseDetailPage() {
  const params = useParams<{ srId: string }>()
  const srId = params?.srId
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [sr, setSr] = useState<SR | null>(null)
  const [timelines, setTimelines] = useState<TimelineOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showAddTL, setShowAddTL] = useState(false)
  const [tlForm, setTlForm] = useState(emptyTLForm)
  const [savingTL, setSavingTL] = useState(false)

  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  const [practiceForm, setPracticeForm] = useState(emptyPracticeForm)
  const [savingPractice, setSavingPractice] = useState(false)

  async function load() {
    if (!clientId || !srId) return
    setLoading(true); setError('')
    try {
      // The list endpoint returns metadata only — pull the parent
      // entry separately so the header can render before the
      // timelines fetch.
      const [allRes, tlsRes] = await Promise.all([
        api.get<SR[]>(`/client/${clientId}/standard-responses`),
        api.get<TimelineOut[]>(`/client/${clientId}/standard-responses/${srId}/timelines`),
      ])
      const found = (allRes.data as SR[]).find(s => s.id === srId)
      if (!found) { setError('Entry not found'); return }
      setSr(found)
      setTimelines(tlsRes.data)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to load.'))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [clientId, srId])

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

  async function deleteTimeline(tl: TimelineOut) {
    if (!confirm(`Delete timeline "${tl.name}" and all its practices?`)) return
    try {
      await api.delete(`/client/${clientId}/standard-responses/${srId}/timelines/${tl.id}`)
      load()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete.'))
    }
  }

  async function addPractice(e: FormEvent) {
    e.preventDefault()
    if (!showAddPractice) return
    setSavingPractice(true)
    try {
      await api.post(
        `/client/${clientId}/standard-responses/${srId}/timelines/${showAddPractice}/practices`,
        {
          l0_type: practiceForm.l0_type,
          l1_type: practiceForm.l1_type.trim() || null,
          l2_type: practiceForm.l2_type.trim() || null,
          display_order: parseInt(practiceForm.display_order || '0'),
          is_special_input: practiceForm.is_special_input,
          frequency_days: practiceForm.frequency_days ? parseInt(practiceForm.frequency_days) : null,
          elements: [],
        },
      )
      setShowAddPractice(null)
      setPracticeForm(emptyPracticeForm)
      load()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to add practice.'))
    } finally { setSavingPractice(false) }
  }

  async function deletePractice(tl: TimelineOut, p: PracticeOut) {
    const label = [p.l1_type, p.l2_type].filter(Boolean).join(' › ') || p.l0_type
    if (!confirm(`Delete practice "${label}"?`)) return
    try {
      await api.delete(
        `/client/${clientId}/standard-responses/${srId}/timelines/${tl.id}/practices/${p.id}`,
      )
      load()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete.'))
    }
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
        <Link href="/standard-responses" className="text-xs text-slate-400 hover:text-slate-600">
          ← Back to library
        </Link>
        <div className="flex items-start gap-3 flex-wrap mt-2">
          <h1 className="text-xl font-bold text-slate-900 flex-1">{sr.question_text}</h1>
          {sr.crop_cosh_id ? (
            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-mono">
              {sr.crop_cosh_id}
            </span>
          ) : (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              Crop-agnostic
            </span>
          )}
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
              <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
                <div>
                  <p className="font-semibold text-slate-800">{tl.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {tl.from_type === 'DAYS_AFTER_RESPONSE' ? 'Days after response' : tl.from_type}
                    {' · '}
                    Day {tl.from_value} → {tl.to_value}
                  </p>
                </div>
                <button onClick={() => deleteTimeline(tl)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50">
                  Delete timeline
                </button>
              </div>
              <div className="px-5 py-4 space-y-2">
                {tl.practices.length === 0 ? (
                  <p className="text-xs text-slate-400">No practices yet.</p>
                ) : tl.practices.map(p => (
                  <div key={p.id} className="flex items-center gap-2 py-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${L0_COLOUR[p.l0_type] || 'bg-slate-100'}`}>
                      {p.l0_type}
                    </span>
                    <span className="text-sm text-slate-700 flex-1">
                      {[p.l1_type, p.l2_type].filter(Boolean).join(' › ') || '—'}
                      {p.is_special_input && (
                        <span className="ml-2 text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">special</span>
                      )}
                      {p.frequency_days && (
                        <span className="ml-2 text-xs text-slate-400">every {p.frequency_days}d</span>
                      )}
                    </span>
                    <button onClick={() => deletePractice(tl, p)}
                      className="text-xs text-red-400 hover:text-red-600">×</button>
                  </div>
                ))}
                <button
                  onClick={() => { setShowAddPractice(tl.id); setPracticeForm(emptyPracticeForm) }}
                  className="text-xs font-medium mt-2"
                  style={{ color: colour }}>
                  + Add Practice
                </button>
              </div>
            </div>
          ))
        )}

        <button onClick={() => { setShowAddTL(true); setTlForm(emptyTLForm) }}
          className="w-full text-white font-semibold py-3 rounded-2xl text-sm shadow-sm"
          style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
          + Add Timeline
        </button>
      </div>

      {/* Notes the SE will see — calls out what's not yet authored
          here so they don't think it's missing. */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600 leading-relaxed">
        <strong>Note:</strong> Element-level fields (specific pesticide / dose / unit) are not yet authored in the CA portal —
        same V1 ceiling as the CCA and CHA editors. When element authoring lands (V1.1 cross-cutting), Q&A entries pick it up automatically.
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

      {/* Add Practice Modal */}
      {showAddPractice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Practice</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                A single recommendation under this timeline. Element-level details are added later.
              </p>
            </div>
            <form onSubmit={addPractice} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Type</label>
                <select value={practiceForm.l0_type}
                  onChange={e => setPracticeForm(f => ({ ...f, l0_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none">
                  {L0_OPTIONS.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Category (L1)</label>
                  <input value={practiceForm.l1_type}
                    onChange={e => setPracticeForm(f => ({ ...f, l1_type: e.target.value }))}
                    placeholder="e.g. PESTICIDE"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Sub-category (L2)</label>
                  <input value={practiceForm.l2_type}
                    onChange={e => setPracticeForm(f => ({ ...f, l2_type: e.target.value }))}
                    placeholder="e.g. INSECTICIDE"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Display order</label>
                  <input type="number" min="0" value={practiceForm.display_order}
                    onChange={e => setPracticeForm(f => ({ ...f, display_order: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Frequency (days)</label>
                  <input type="number" min="0" value={practiceForm.frequency_days}
                    onChange={e => setPracticeForm(f => ({ ...f, frequency_days: e.target.value }))}
                    placeholder="optional"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={practiceForm.is_special_input}
                  onChange={e => setPracticeForm(f => ({ ...f, is_special_input: e.target.checked }))}
                  className="w-4 h-4" />
                Special input (CDI / restricted)
              </label>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddPractice(null); setPracticeForm(emptyPracticeForm) }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm">Cancel</button>
                <button type="submit" disabled={savingPractice}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {savingPractice ? 'Adding…' : 'Add Practice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
