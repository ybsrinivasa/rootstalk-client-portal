'use client'

// Batch 39P-c (2026-05-16) — shared Conditional Questions section for
// the UCAT "Practices" shape. Mounts under each Timeline expansion to
// list CQs and host the Add/Edit modal. Pipe-agnostic: CCA Global +
// CHA-PG Global (and future SP/QA Global) mount the same component
// with their pipe context.
//
// Each CQ is gated to a Practice (Path B) or a Relation (Path A) via
// YES / NO attachments. Backend endpoints:
//   POST  base/timelines/{tlId}/conditional-questions
//   GET   base/timelines/{tlId}/conditional-questions
//   PUT   /advisory/global/conditional-questions/{cqId}   (pipe-agnostic)
//   DEL   /advisory/global/conditional-questions/{cqId}   (pipe-agnostic)
//   POST  /advisory/global/practices/{pId}/conditionals    (pipe-agnostic)
//   POST  /advisory/global/relations/{rId}/conditionals    (pipe-agnostic)
// All URLs are built by `lib/advisory-pipe.ts::cqEndpoints(ctx)`.
//
// Lifted verbatim from CCA's inline implementation (Batches 39E + 39G)
// — only the URL plumbing and prop shape changed.

import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { cqEndpoints, type PipeContext } from '@/lib/advisory-pipe'
import {
  practiceLabel, type RelationsPractice, type RelationOut,
} from './RelationsSection'

// ── Public types ───────────────────────────────────────────────────────

export interface CQAttachment {
  kind: 'practice' | 'relation'
  id: string
}

export interface CQOut {
  id: string
  timeline_id: string
  question_text: string
  display_order: number
  yes: CQAttachment | null
  no: CQAttachment | null
}

// ── Component ──────────────────────────────────────────────────────────

interface Props {
  timelineId: string
  timelineName?: string
  practices: RelationsPractice[]
  relations: RelationOut[]
  pipe: PipeContext
  /** Optional mirror callback. Fires whenever the CQ list is reloaded
   *  (after open / create / update / delete). Parents like the CCA
   *  Global page use this to keep a `cqsByTimeline` map for downstream
   *  features (publish gates, dangling-CQ checks). */
  onCQsChange?: (timelineId: string, cqs: CQOut[]) => void
}

export function CQsSection({
  timelineId, timelineName, practices, relations, pipe, onCQsChange,
}: Props) {
  const endpoints = cqEndpoints(pipe)

  const [cqs, setCqs] = useState<CQOut[] | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CQOut | null>(null)
  const [cqForm, setCqForm] = useState<{
    question_text: string
    yes_attachment: string  // "kind:id" | ""
    no_attachment: string
  }>({ question_text: '', yes_attachment: '', no_attachment: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── Load + persist callback to parent mirror ─────────────────────────

  async function loadCQs() {
    try {
      const { data } = await api.get<CQOut[]>(endpoints.list(timelineId))
      setCqs(data)
      onCQsChange?.(timelineId, data)
    } catch {
      setCqs([])
      onCQsChange?.(timelineId, [])
    }
  }

  useEffect(() => { loadCQs() }, [timelineId])

  // ── Helpers ──────────────────────────────────────────────────────────

  // Practices already inside ANY Relation on this Timeline can only be
  // CQ-bound via their Relation (Path A); hide them from the
  // per-Practice picker to avoid double-attachment.
  function practiceIdsInAnyRelation(): Set<string> {
    const out = new Set<string>()
    for (const r of relations) {
      for (const part of r.parts) for (const opt of part) for (const pid of opt) {
        out.add(pid)
      }
    }
    return out
  }

  // Practices + Relations already bound to ANY CQ on this Timeline.
  // Disabled in both pickers (the backend's assert_*_can_be_linked
  // rules would reject anyway). When editing, this CQ's own bindings
  // are excluded so the SE can rebind to the same entity.
  function attachmentsAlreadyBoundOnTimeline(excludeCqId?: string): Set<string> {
    const out = new Set<string>()
    for (const cq of (cqs || [])) {
      if (excludeCqId && cq.id === excludeCqId) continue
      for (const side of [cq.yes, cq.no]) {
        if (side) out.add(`${side.kind}:${side.id}`)
      }
    }
    return out
  }

  function labelForAttachment(att: CQAttachment | null): string {
    if (!att) return '—'
    if (att.kind === 'practice') {
      const p = practices.find(x => x.id === att.id)
      return p ? practiceLabel(p) : att.id.slice(0, 8)
    }
    const r = relations.find(x => x.id === att.id)
    return r?.expression || `Relation ${att.id.slice(0, 8)}`
  }

  // ── Modal actions ────────────────────────────────────────────────────

  function openAdd() {
    setModalOpen(true)
    setEditing(null)
    setCqForm({ question_text: '', yes_attachment: '', no_attachment: '' })
    setError('')
  }

  function openEdit(cq: CQOut) {
    setModalOpen(true)
    setEditing(cq)
    setCqForm({
      question_text: cq.question_text,
      yes_attachment: cq.yes ? `${cq.yes.kind}:${cq.yes.id}` : '',
      no_attachment:  cq.no  ? `${cq.no.kind}:${cq.no.id}`   : '',
    })
    setError('')
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    setError('')
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!cqForm.question_text.trim()) {
      setError('Question text is required.')
      return
    }
    if (!cqForm.yes_attachment && !cqForm.no_attachment) {
      setError('Attach at least one Practice or Relation to YES or NO.')
      return
    }
    setSaving(true); setError('')
    try {
      const toAttachment = (s: string): { kind: string; id: string } | null => {
        if (!s) return null
        const [kind, attId] = s.split(':')
        return { kind, id: attId }
      }
      if (editing) {
        // Atomic PUT — text + bindings.
        await api.put(endpoints.update(editing.id), {
          question_text: cqForm.question_text.trim(),
          yes: toAttachment(cqForm.yes_attachment),
          no:  toAttachment(cqForm.no_attachment),
        })
      } else {
        // POST the CQ, then bind each side via the link endpoints.
        const cqResp = await api.post<{ id: string }>(endpoints.create(timelineId), {
          question_text: cqForm.question_text.trim(),
          display_order: (cqs?.length || 0),
        })
        const cqId = cqResp.data.id
        const bind = async (attachment: string, answer: 'YES' | 'NO') => {
          if (!attachment) return
          const [kind, attId] = attachment.split(':')
          if (kind === 'relation') {
            await api.post(endpoints.bindRelation(attId), {
              practice_id: 'ignored', question_id: cqId, answer,
            })
          } else if (kind === 'practice') {
            await api.post(endpoints.bindPractice(attId), {
              practice_id: attId, question_id: cqId, answer,
            })
          }
        }
        await bind(cqForm.yes_attachment, 'YES')
        await bind(cqForm.no_attachment, 'NO')
      }
      await loadCQs()
      closeModal()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to save Conditional Question.'))
    } finally { setSaving(false) }
  }

  async function handleDelete(cqId: string) {
    if (!confirm('Delete this Conditional Question? The Practices/Relations stay; only the gating goes.')) return
    try {
      await api.delete(endpoints.delete(cqId))
      await loadCQs()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete Conditional Question.'))
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  const alreadyBound = attachmentsAlreadyBoundOnTimeline(editing?.id)
  const pidsInAnyRelation = practiceIdsInAnyRelation()

  type Opt = {
    value: string; label: string;
    kind: 'practice' | 'relation';
    disabled: boolean; reason?: string;
  }

  function buildOpts(otherPick: string): Opt[] {
    const out: Opt[] = []
    for (const p of practices) {
      if (pidsInAnyRelation.has(p.id)) continue
      const value = `practice:${p.id}`
      const inOtherCQ = alreadyBound.has(value)
      const inThisSide = otherPick === value
      out.push({
        value, label: practiceLabel(p), kind: 'practice',
        disabled: inOtherCQ || inThisSide,
        reason: inOtherCQ ? 'bound to another CQ' : inThisSide ? 'picked on the other side' : undefined,
      })
    }
    for (const r of relations) {
      const value = `relation:${r.id}`
      const inOtherCQ = alreadyBound.has(value)
      const inThisSide = otherPick === value
      out.push({
        value, label: r.expression || `Relation ${r.id.slice(0, 8)}`, kind: 'relation',
        disabled: inOtherCQ || inThisSide,
        reason: inOtherCQ ? 'bound to another CQ' : inThisSide ? 'picked on the other side' : undefined,
      })
    }
    return out
  }

  const yesOpts = buildOpts(cqForm.no_attachment)
  const noOpts  = buildOpts(cqForm.yes_attachment)

  return (
    <>
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Conditional Questions</h4>
          <button onClick={openAdd}
            className="text-xs font-medium text-blue-600 hover:underline">
            + Add Conditional Question
          </button>
        </div>
        {!cqs || cqs.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No Conditional Questions on this Timeline yet.</p>
        ) : (
          <div className="space-y-2">
            {cqs.map(cq => (
              <div key={cq.id} className="bg-purple-50/30 border border-purple-100 rounded-lg px-3 py-2">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded font-semibold shrink-0">IF</span>
                  <p className="text-xs font-medium text-slate-800 flex-1 min-w-0 break-words">{cq.question_text}</p>
                  <button onClick={() => openEdit(cq)}
                    className="text-slate-300 hover:text-blue-500 shrink-0"
                    title="Edit Conditional Question">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={() => handleDelete(cq.id)}
                    className="text-slate-300 hover:text-red-500 shrink-0"
                    title="Delete Conditional Question">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="mt-1.5 ml-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
                  <div className="flex items-start gap-2 text-[11px]">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${cq.yes ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'}`}>YES</span>
                    <span className={`min-w-0 break-words ${cq.yes ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                      {cq.yes ? `${cq.yes.kind === 'practice' ? 'Practice' : 'Relation'}: ${labelForAttachment(cq.yes)}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-[11px]">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${cq.no ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-400'}`}>NO</span>
                    <span className={`min-w-0 break-words ${cq.no ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                      {cq.no ? `${cq.no.kind === 'practice' ? 'Practice' : 'Relation'}: ${labelForAttachment(cq.no)}` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                {editing ? 'Edit Conditional Question' : 'Add Conditional Question'}
              </h2>
              {timelineName && (
                <p className="text-xs text-slate-500 mt-1">
                  Timeline: <span className="font-medium text-slate-700">{timelineName}</span>
                </p>
              )}
              <p className="text-xs text-slate-500 mt-2">
                The farmer answers YES or NO. Attach a Practice or Relation to either side —
                the attached entity only fires when the farmer's answer matches.
              </p>
            </div>
            <form onSubmit={handleSave} className="overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Question</label>
                <textarea
                  value={cqForm.question_text}
                  onChange={e => setCqForm(f => ({ ...f, question_text: e.target.value }))}
                  rows={2}
                  placeholder="e.g. Has it rained in the last 2 days?"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(['yes', 'no'] as const).map(side => {
                  const opts = side === 'yes' ? yesOpts : noOpts
                  const value = side === 'yes' ? cqForm.yes_attachment : cqForm.no_attachment
                  const setValue = (v: string) => setCqForm(f => side === 'yes'
                    ? { ...f, yes_attachment: v } : { ...f, no_attachment: v })
                  return (
                    <div key={side}>
                      <label className={`inline-block text-[10px] uppercase tracking-wider font-semibold rounded px-2 py-0.5 mb-2 ${
                        side === 'yes' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {side.toUpperCase()} — when farmer answers {side.toUpperCase()}
                      </label>
                      <select value={value}
                        onChange={e => setValue(e.target.value)}
                        className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 ${
                          side === 'yes' ? 'border-emerald-200 focus:ring-emerald-500' : 'border-rose-200 focus:ring-rose-500'
                        }`}>
                        <option value="">— nothing attached —</option>
                        {opts.length === 0 ? (
                          <option disabled>No eligible Practice or Relation yet</option>
                        ) : opts.map(o => (
                          <option key={o.value} value={o.value} disabled={o.disabled}>
                            {o.kind === 'practice' ? 'Practice: ' : 'Relation: '}
                            {o.label}
                            {o.reason ? ` — ${o.reason}` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Pick a Practice (Path B) or a Relation (Path A). Empty side = nothing fires
                        when the answer is {side.toUpperCase()}.
                      </p>
                    </div>
                  )
                })}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit"
                  disabled={saving || !cqForm.question_text.trim() ||
                            (!cqForm.yes_attachment && !cqForm.no_attachment)}
                  className="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
                  {saving
                    ? 'Saving…'
                    : editing ? 'Save Changes' : 'Save Conditional Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
