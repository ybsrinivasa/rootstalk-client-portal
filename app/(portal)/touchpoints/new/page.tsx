'use client'

// Touchpoint composer wizard — 5 steps:
//   Basics → Triggers → Content → Survey Builder (conditional) → Review+Activate
//
// Different from the Campaign composer in two ways:
// (1) No audience filter — touchpoints fire on subscription milestones.
//     The second step picks Crop → Package → Timeline → Beginning/End
//     and the farmer audience is derived automatically from whoever
//     reaches that milestone (now or in the future).
// (2) No absolute expires_at — expiry is a per-firing duration
//     (per_firing_expiry_days, 1-180). Each fired recipient gets that
//     many days from THEIR firing time.
//
// Draft auto-saves on each Next. Also supports ?draftId=X to resume
// editing an existing DRAFT or PAUSED touchpoint.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import {
  QuestionsEditor,
  QUESTION_TYPE_LABEL,
  type Question,
} from '@/components/campaigns/QuestionsEditor'

type ContentType = 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
type FireAt = 'BEGINNING' | 'END'

interface Crop { cosh_id: string; name: string }
interface Pkg { id: string; name: string }
interface TimelineOption { id: string; name: string }

interface Assignment {
  id: string
  package_id: string
  package_name: string
  timeline_id: string
  timeline_name: string
  crop_cosh_id: string
  crop_name: string
  fire_at: FireAt
  status: 'ACTIVE' | 'PAUSED'
}

interface Attachment {
  id: string
  kind: 'IMAGE' | 'VIDEO' | 'PDF'
  url: string
  original_filename: string
  mime_type: string
  size_bytes: number
  sort_order: number
}

const TYPE_LABEL: Record<ContentType, string> = {
  ANNOUNCEMENT: 'Announcement',
  INTEREST_CAPTURE: 'Interest Capture',
  FEEDBACK: 'Feedback',
  SURVEY: 'Survey',
}

const TYPE_DESCRIPTION: Record<ContentType, string> = {
  ANNOUNCEMENT: 'One-way message. No response collected.',
  INTEREST_CAPTURE: 'Recipient taps Yes / No / Maybe. Built-in — no extra questions.',
  FEEDBACK: '5-star rating is the main response. You can add up to 3 follow-up questions.',
  SURVEY: 'Multi-question form. Up to 20 questions, 9 question types.',
}

function typeNeedsSurveyBuilder(t: ContentType): boolean {
  return t === 'SURVEY' || t === 'FEEDBACK'
}

export default function NewTouchpointPage() {
  const router = useRouter()
  const search = useSearchParams()
  const resumeDraftId = search?.get('draftId') || null
  const client = getClient()
  const clientId = client?.id

  const [step, setStep] = useState(0)
  const [draftId, setDraftId] = useState<string | null>(resumeDraftId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1 — Basics
  const [name, setName] = useState('')
  const [contentType, setContentType] = useState<ContentType>('ANNOUNCEMENT')
  const [description, setDescription] = useState('')
  const [perFiringExpiryDays, setPerFiringExpiryDays] = useState(7)

  // Step 2 — Triggers (assignments)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [showAddAssignment, setShowAddAssignment] = useState(false)

  // Step 3 — Content
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [languageCode, setLanguageCode] = useState('en')
  const [ratingScale, setRatingScale] = useState<'STAR_5'>('STAR_5')

  // Step 4 — Survey Builder
  const [questions, setQuestions] = useState<Question[]>([])

  const steps = useMemo(() => {
    const base = ['Basics', 'Triggers', 'Content']
    if (typeNeedsSurveyBuilder(contentType)) base.push('Survey Builder')
    base.push('Review')
    return base
  }, [contentType])

  // Load existing draft if resuming
  useEffect(() => {
    if (!resumeDraftId || !clientId) return
    api.get<{
      touchpoint: {
        id: string; name: string; content_type: ContentType; description: string | null
        title: string; body: string; language_code: string
        rating_scale_type: string | null
        per_firing_expiry_days: number
      }
      assignments: Assignment[]
      questions: Question[]
    }>(`/client/${clientId}/touchpoints/${resumeDraftId}`)
      .then(({ data }) => {
        const t = data.touchpoint
        setName(t.name || '')
        setContentType(t.content_type)
        setDescription(t.description || '')
        setTitle(t.title || '')
        setBody(t.body || '')
        setLanguageCode(t.language_code || 'en')
        setPerFiringExpiryDays(t.per_firing_expiry_days || 7)
        if (t.rating_scale_type === 'STAR_5') setRatingScale('STAR_5')
        setAssignments(data.assignments)
        setQuestions(data.questions)
      })
      .catch(err => setError(extractErrorMessage(err, 'Could not load draft.')))
  }, [resumeDraftId, clientId])

  // Save draft (create on first save, PATCH on subsequent)
  const saveDraft = useCallback(async (): Promise<string | null> => {
    if (!clientId) return null
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        content_type: contentType,
        description: description || null,
        title: title.trim(),
        body,
        language_code: languageCode,
        rating_scale_type: contentType === 'FEEDBACK' ? ratingScale : null,
        per_firing_expiry_days: perFiringExpiryDays,
      }
      if (!draftId) {
        const { data } = await api.post<{ touchpoint: { id: string } }>(
          `/client/${clientId}/touchpoints`, payload,
        )
        setDraftId(data.touchpoint.id)
        return data.touchpoint.id
      } else {
        await api.patch(
          `/client/${clientId}/touchpoints/${draftId}`, payload,
        )
        return draftId
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save draft.'))
      return null
    } finally {
      setSaving(false)
    }
  }, [clientId, draftId, name, contentType, description, title, body, languageCode, ratingScale, perFiringExpiryDays])

  useEffect(() => {
    if (!typeNeedsSurveyBuilder(contentType)) setQuestions([])
  }, [contentType])

  // Question CRUD
  async function addQuestion(payload: Omit<Question, 'id' | 'sort_order'>) {
    if (!clientId || !draftId) return
    try {
      const { data } = await api.post<Question>(
        `/client/${clientId}/touchpoints/${draftId}/questions`,
        payload,
      )
      setQuestions(qs => [...qs, data])
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not add question.'))
    }
  }
  async function updateQuestion(q: Question) {
    if (!clientId || !draftId) return
    try {
      const { data } = await api.patch<Question>(
        `/client/${clientId}/touchpoints/${draftId}/questions/${q.id}`,
        q,
      )
      setQuestions(qs => qs.map(x => x.id === q.id ? data : x))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not update question.'))
    }
  }
  async function deleteQuestion(id: string) {
    if (!clientId || !draftId) return
    const ok = confirm('Remove this question?')
    if (!ok) return
    try {
      await api.delete(`/client/${clientId}/touchpoints/${draftId}/questions/${id}`)
      setQuestions(qs => qs.filter(x => x.id !== id))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not delete question.'))
    }
  }

  // Assignment CRUD
  async function addAssignment(a: { package_id: string; timeline_id: string; fire_at: FireAt }) {
    if (!clientId || !draftId) {
      setError('Save the draft first — go back to Basics and tap Next.')
      return
    }
    try {
      const { data } = await api.post<Assignment>(
        `/client/${clientId}/touchpoints/${draftId}/assignments`,
        a,
      )
      setAssignments(asgs => [...asgs, data])
      setShowAddAssignment(false)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not add trigger.'))
    }
  }
  async function removeAssignment(id: string) {
    if (!clientId || !draftId) return
    const ok = confirm('Remove this trigger?')
    if (!ok) return
    try {
      await api.delete(`/client/${clientId}/touchpoints/${draftId}/assignments/${id}`)
      setAssignments(asgs => asgs.filter(x => x.id !== id))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not remove trigger.'))
    }
  }

  const stepLabel = steps[step]
  const nextDisabled = useMemo(() => {
    if (stepLabel === 'Basics') return !name.trim()
    if (stepLabel === 'Triggers') return assignments.length === 0
    if (stepLabel === 'Content') return !title.trim() || !body.trim()
    if (stepLabel === 'Survey Builder') {
      if (contentType === 'SURVEY' && questions.length === 0) return true
      if (contentType === 'FEEDBACK' && questions.length > 3) return true
    }
    return false
  }, [stepLabel, name, title, body, assignments, contentType, questions])

  async function onNext() {
    if (nextDisabled) return
    const id = await saveDraft()
    if (!id) return
    setStep(s => Math.min(steps.length - 1, s + 1))
  }
  function onBack() { setStep(s => Math.max(0, s - 1)) }

  async function onActivate() {
    if (!clientId || !draftId) return
    setSaving(true); setError('')
    try {
      await api.post(`/client/${clientId}/touchpoints/${draftId}/activate`)
      router.push(`/touchpoints/${draftId}`)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not activate touchpoint.'))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!clientId || !draftId) { router.push('/touchpoints'); return }
    const ok = confirm('Discard this draft?')
    if (!ok) return
    try {
      await api.delete(`/client/${clientId}/touchpoints/${draftId}`)
    } catch { /* ignore */ }
    router.push('/touchpoints')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          {resumeDraftId ? 'Edit Touchpoint' : 'New Touchpoint'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Follow the steps. Your draft auto-saves as you go — close any
          time and pick up from Touchpoints.
        </p>
      </header>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        {steps.map((label, i) => {
          const active = i === step
          const done = i < step
          return (
            <div key={label} className="flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold ${
                active ? 'bg-blue-600 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}>{done ? '✓' : i + 1}</span>
              <span className={`${active ? 'text-slate-900 font-medium' : done ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
              {i < steps.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* ── Step: Basics ─────────────────────────────────────────── */}
      {stepLabel === 'Basics' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Basics</h2>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Touchpoint name</span>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Internal name — not shown to recipients"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </label>
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-500">Type</span>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {(['ANNOUNCEMENT', 'INTEREST_CAPTURE', 'FEEDBACK', 'SURVEY'] as ContentType[]).map(t => {
                const active = contentType === t
                return (
                  <button
                    key={t} type="button"
                    onClick={() => setContentType(t)}
                    disabled={!!resumeDraftId}
                    className={`text-left rounded-xl p-3 border-2 transition-colors ${
                      active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-white'
                    } ${resumeDraftId ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    <p className="font-medium text-sm text-slate-900">{TYPE_LABEL[t]}</p>
                    <p className="text-xs text-slate-500 mt-1">{TYPE_DESCRIPTION[t]}</p>
                  </button>
                )
              })}
            </div>
            {resumeDraftId && (
              <p className="text-xs text-slate-400 mt-2 italic">
                Content type can&apos;t be changed after the draft is created.
              </p>
            )}
          </div>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Expires after each firing (days)</span>
            <input
              type="number" min={1} max={180}
              value={perFiringExpiryDays}
              onChange={e => setPerFiringExpiryDays(Math.max(1, Math.min(180, Number(e.target.value) || 7)))}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
            />
            <p className="text-xs text-slate-400 mt-1">
              Each time this touchpoint fires, that recipient has this many days to respond before it expires from their inbox. 1–180 days.
            </p>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Internal note (optional)</span>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 resize-none"
            />
          </label>
        </section>
      )}

      {/* ── Step: Triggers ───────────────────────────────────────── */}
      {stepLabel === 'Triggers' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Triggers</h2>
            <p className="text-sm text-slate-500 mt-1">
              Pick the agronomic milestones that should trigger this
              touchpoint. You can combine multiple
              Crop · Package · Timeline · Beginning/End rows — any one
              of them firing sends the message.
            </p>
          </div>
          {assignments.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {assignments.map(a => (
                <div key={a.id} className="py-3 px-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {a.crop_name || a.crop_cosh_id} · {a.package_name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.fire_at === 'BEGINNING' ? 'Beginning' : 'End'} of {a.timeline_name}
                    </p>
                  </div>
                  <button
                    type="button" onClick={() => removeAssignment(a.id)}
                    className="text-xs px-2 py-1 border border-rose-200 rounded text-rose-600 hover:bg-rose-50"
                  >Remove</button>
                </div>
              ))}
            </div>
          )}
          {showAddAssignment ? (
            <AddAssignmentForm
              clientId={clientId || ''}
              onCancel={() => setShowAddAssignment(false)}
              onSave={addAssignment}
            />
          ) : (
            <button
              type="button"
              onClick={async () => {
                if (!draftId) {
                  const id = await saveDraft()
                  if (!id) return
                }
                setShowAddAssignment(true)
              }}
              className="text-sm px-4 py-2 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 hover:border-slate-400 w-full"
            >
              + Add trigger
            </button>
          )}
          {assignments.length === 0 && (
            <p className="text-xs text-slate-500 italic">
              Add at least one trigger before continuing.
            </p>
          )}
        </section>
      )}

      {/* ── Step: Content ─────────────────────────────────────────── */}
      {stepLabel === 'Content' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Content</h2>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Message title</span>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Shown in the recipient's inbox header"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Message body</span>
            <textarea
              value={body} onChange={e => setBody(e.target.value)}
              rows={10} maxLength={2000}
              placeholder="The main message. Up to 2000 characters."
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 resize-y"
            />
            <p className="text-xs text-slate-400 mt-1">{body.length} / 2000 characters</p>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Composed in language</span>
            <select
              value={languageCode} onChange={e => setLanguageCode(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="kn">Kannada</option>
              <option value="te">Telugu</option>
              <option value="ta">Tamil</option>
              <option value="mr">Marathi</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              You are responsible for composing in the language your audience reads — the system does not auto-translate.
            </p>
          </label>
          {contentType === 'FEEDBACK' && (
            <label className="block">
              <span className="text-xs uppercase tracking-wider text-slate-500">Rating scale</span>
              <select
                value={ratingScale}
                onChange={e => setRatingScale(e.target.value as 'STAR_5')}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
              >
                <option value="STAR_5">5-star rating</option>
              </select>
            </label>
          )}

          <TouchpointAttachmentsPanel
            draftId={draftId}
            clientId={clientId || ''}
            onError={setError}
          />
        </section>
      )}

      {/* ── Step: Survey Builder ─────────────────────────────────── */}
      {stepLabel === 'Survey Builder' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {contentType === 'FEEDBACK' ? 'Follow-up questions' : 'Survey questions'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {contentType === 'FEEDBACK'
                ? 'The star rating is collected automatically. Add up to 3 optional follow-up questions.'
                : 'Add up to 20 questions. Recipients see them in the order shown here.'}
            </p>
          </div>
          <QuestionsEditor
            questions={questions}
            onAdd={addQuestion}
            onUpdate={updateQuestion}
            onDelete={deleteQuestion}
            maxCount={contentType === 'FEEDBACK' ? 3 : 20}
          />
        </section>
      )}

      {/* ── Step: Review ─────────────────────────────────────────── */}
      {stepLabel === 'Review' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-slate-900">Review &amp; activate</h2>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Recipient will see</p>
            <p className="text-sm font-semibold text-slate-800 mt-2">{title || '(no title)'}</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap mt-2">{body || '(no body)'}</p>

            {contentType === 'INTEREST_CAPTURE' && (
              <div className="mt-4 flex gap-2">
                {(['Yes', 'No', 'Maybe'] as const).map(l => (
                  <div key={l} className="flex-1 border border-slate-300 rounded-lg px-4 py-3 text-center text-sm font-medium text-slate-600">
                    {l}
                  </div>
                ))}
              </div>
            )}
            {contentType === 'FEEDBACK' && (
              <div className="mt-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Rating</p>
                <div className="flex gap-1 text-3xl text-slate-300">★ ★ ★ ★ ★</div>
                {questions.length > 0 && (
                  <>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mt-4 mb-2">+ {questions.length} follow-up question{questions.length === 1 ? '' : 's'}</p>
                    <ul className="space-y-1.5">
                      {questions.map(q => (
                        <li key={q.id} className="text-xs text-slate-600">
                          · {q.label} <span className="text-slate-400">({QUESTION_TYPE_LABEL[q.question_type]})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {contentType === 'SURVEY' && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-500 uppercase tracking-wider">Survey questions ({questions.length})</p>
                {questions.map((q, i) => (
                  <div key={q.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <p className="text-sm font-medium text-slate-800">
                      {i + 1}. {q.label} {q.is_mandatory && <span className="text-rose-500">*</span>}
                    </p>
                    {q.help_text && <p className="text-xs text-slate-500 mt-1">{q.help_text}</p>}
                    <p className="text-xs text-slate-400 mt-1">{QUESTION_TYPE_LABEL[q.question_type]}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Triggers</p>
              <p className="text-slate-800 mt-1">
                {assignments.length} milestone{assignments.length === 1 ? '' : 's'}
              </p>
              <ul className="text-xs text-slate-500 mt-1 space-y-0.5">
                {assignments.map(a => (
                  <li key={a.id}>
                    · {a.crop_name || a.crop_cosh_id} · {a.package_name} · {a.fire_at === 'BEGINNING' ? 'Beginning' : 'End'} of {a.timeline_name}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Expires per firing</p>
              <p className="text-slate-800 mt-1">
                {perFiringExpiryDays} {perFiringExpiryDays === 1 ? 'day' : 'days'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Each fired recipient has this long to respond before the message expires from their inbox.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <strong>Activating will start firing on new milestones.</strong>{' '}
            Farmers who already passed any of these milestones before you activate will NOT receive it — touchpoints are not retroactive. Once a recipient opens the message, the content locks and can no longer be edited.
          </div>

          <div className="pt-2 text-center">
            <button
              type="button" onClick={onActivate} disabled={saving}
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Activating…' : 'Activate touchpoint'}
            </button>
          </div>
        </section>
      )}

      {/* Nav footer */}
      <div className="flex items-center justify-between">
        <button
          type="button" onClick={onDelete}
          className="text-xs text-slate-500 hover:text-rose-600"
        >
          Discard draft
        </button>
        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button" onClick={onBack} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            >
              ← Back
            </button>
          )}
          {step < steps.length - 1 && (
            <button
              type="button" onClick={onNext} disabled={saving || nextDisabled}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Next →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Assignment form — Crop → Package → Timeline → Beginning/End ─────

function AddAssignmentForm({ clientId, onCancel, onSave }: {
  clientId: string
  onCancel: () => void
  onSave: (a: { package_id: string; timeline_id: string; fire_at: FireAt }) => void
}) {
  const [crops, setCrops] = useState<Crop[] | null>(null)
  const [packages, setPackages] = useState<Pkg[] | null>(null)
  const [timelines, setTimelines] = useState<TimelineOption[] | null>(null)
  const [cropCoshId, setCropCoshId] = useState('')
  const [packageId, setPackageId] = useState('')
  const [timelineId, setTimelineId] = useState('')
  const [fireAt, setFireAt] = useState<FireAt>('BEGINNING')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    api.get<{ crops: Crop[] }>(`/client/${clientId}/touchpoints/crops`)
      .then(({ data }) => setCrops(data.crops))
      .catch(err => setLocalError(extractErrorMessage(err, 'Could not load crops.')))
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => {
    if (!cropCoshId) { setPackages(null); setPackageId(''); return }
    setLoading(true); setPackageId('')
    api.get<{ packages: Pkg[] }>(
      `/client/${clientId}/touchpoints/packages?crop_cosh_id=${encodeURIComponent(cropCoshId)}`,
    )
      .then(({ data }) => setPackages(data.packages))
      .catch(err => setLocalError(extractErrorMessage(err, 'Could not load packages.')))
      .finally(() => setLoading(false))
  }, [clientId, cropCoshId])

  useEffect(() => {
    if (!packageId) { setTimelines(null); setTimelineId(''); return }
    setLoading(true); setTimelineId('')
    api.get<{ timelines: TimelineOption[] }>(
      `/client/${clientId}/touchpoints/timelines?package_id=${encodeURIComponent(packageId)}`,
    )
      .then(({ data }) => setTimelines(data.timelines))
      .catch(err => setLocalError(extractErrorMessage(err, 'Could not load timelines.')))
      .finally(() => setLoading(false))
  }, [clientId, packageId])

  function handleSave() {
    if (!packageId || !timelineId) {
      setLocalError('Pick a package and timeline.')
      return
    }
    onSave({ package_id: packageId, timeline_id: timelineId, fire_at: fireAt })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <p className="text-xs uppercase tracking-wider text-slate-600 font-semibold">Add trigger</p>
      {localError && (
        <p className="text-xs text-rose-600">{localError}</p>
      )}
      <label className="block text-sm">
        <span className="text-xs text-slate-500 uppercase tracking-wider">1. Crop</span>
        <select
          value={cropCoshId} onChange={e => setCropCoshId(e.target.value)}
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">Pick a crop…</option>
          {crops?.map(c => (
            <option key={c.cosh_id} value={c.cosh_id}>{c.name}</option>
          ))}
        </select>
        {crops && crops.length === 0 && (
          <p className="text-xs text-rose-600 mt-1">
            No crops with active packages. Set up a Package first in CCA · Crops.
          </p>
        )}
      </label>
      <label className="block text-sm">
        <span className="text-xs text-slate-500 uppercase tracking-wider">2. Package</span>
        <select
          value={packageId} onChange={e => setPackageId(e.target.value)}
          disabled={!cropCoshId}
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:opacity-50"
        >
          <option value="">{cropCoshId ? 'Pick a package…' : 'Select a crop first'}</option>
          {packages?.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-xs text-slate-500 uppercase tracking-wider">3. Timeline</span>
        <select
          value={timelineId} onChange={e => setTimelineId(e.target.value)}
          disabled={!packageId}
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:opacity-50"
        >
          <option value="">{packageId ? 'Pick a timeline…' : 'Select a package first'}</option>
          {timelines?.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <div className="block text-sm">
        <span className="text-xs text-slate-500 uppercase tracking-wider">4. When should it fire</span>
        <div className="mt-1 flex gap-2">
          {(['BEGINNING', 'END'] as FireAt[]).map(opt => {
            const active = fireAt === opt
            return (
              <button
                key={opt} type="button"
                onClick={() => setFireAt(opt)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium border-2 ${
                  active ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700 hover:border-slate-300'
                }`}
              >
                {opt === 'BEGINNING' ? 'Beginning of Timeline' : 'End of Timeline'}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button" onClick={onCancel}
          className="px-3 py-1.5 text-xs rounded-lg text-slate-600 hover:bg-slate-100"
        >Cancel</button>
        <button
          type="button" onClick={handleSave}
          disabled={!packageId || !timelineId || loading}
          className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
        >Add trigger</button>
      </div>
    </div>
  )
}

// ── Attachments panel (same shape as the Campaigns one; separate
// endpoints for touchpoints so the two don't cross-pollinate). ─────

function TouchpointAttachmentsPanel({ draftId, clientId, onError }: {
  draftId: string | null
  clientId: string
  onError: (msg: string) => void
}) {
  const [items, setItems] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!draftId || !clientId) return
    setLoading(true)
    api.get<{ attachments: Attachment[] }>(
      `/client/${clientId}/touchpoints/${draftId}/attachments`,
    )
      .then(({ data }) => setItems(data.attachments))
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false))
  }, [draftId, clientId])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!draftId) {
      onError('Save the draft first — click Next and come back.')
      e.target.value = ''
      return
    }
    if (items.length >= 3) {
      onError('Maximum 3 attachments per touchpoint.')
      e.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      onError('File is larger than 10 MB. Compress or pick a smaller file.')
      e.target.value = ''
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<Attachment>(
        `/client/${clientId}/touchpoints/${draftId}/attachments`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      setItems(prev => [...prev, data])
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message
      onError(msg || 'Upload failed.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function onRemove(id: string) {
    if (!draftId || !clientId) return
    const ok = confirm('Remove this attachment?')
    if (!ok) return
    try {
      await api.delete(`/client/${clientId}/touchpoints/${draftId}/attachments/${id}`)
      setItems(prev => prev.filter(a => a.id !== id))
    } catch {
      onError('Could not remove attachment.')
    }
  }

  const atCap = items.length >= 3

  return (
    <div className="border-t border-slate-100 pt-4 space-y-3">
      <div>
        <span className="text-xs uppercase tracking-wider text-slate-500">Attachments</span>
        <p className="text-xs text-slate-400 mt-1">
          Up to 3 files — images (JPEG/PNG/WebP/GIF), video (MP4/WebM/MOV),
          or PDF. Each file at most 10 MB.
        </p>
        <p className="text-xs text-amber-700 mt-1">
          Recipients can view and save attachments on their device — do not
          include confidential material.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : items.length > 0 ? (
        <ul className="space-y-2">
          {items.map(a => (
            <li key={a.id} className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-xl shrink-0" aria-hidden>
                {a.kind === 'IMAGE' ? '🖼️' : a.kind === 'VIDEO' ? '🎞️' : '📄'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 truncate">{a.original_filename}</p>
                <p className="text-xs text-slate-400">
                  {a.kind} · {Math.round(a.size_bytes / 1024)} KB
                </p>
              </div>
              <button
                type="button" onClick={() => onRemove(a.id)}
                className="text-xs text-rose-600 hover:text-rose-800"
              >Remove</button>
            </li>
          ))}
        </ul>
      ) : null}

      {!atCap && (
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="file" onChange={onPick}
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf"
            disabled={uploading}
            className="hidden"
          />
          <span className="px-3 py-1.5 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-slate-400">
            {uploading ? 'Uploading…' : '+ Add attachment'}
          </span>
        </label>
      )}
    </div>
  )
}
