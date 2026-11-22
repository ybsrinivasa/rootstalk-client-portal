'use client'

// Campaign composer wizard — 6 steps:
//   Basics → Audience → Content → Survey Builder (conditional) → Preview → Send.
//
// Survey Builder is shown only for SURVEY (mandatory, ≥1 question)
// and FEEDBACK (optional follow-ups, up to 3 per spec §4.4.3).
// ANNOUNCEMENT and INTEREST_CAPTURE skip it entirely.
//
// Draft is auto-created on first save (end of Basics) so the composer
// can save-as-you-go via PATCH from then on.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

type CampaignType = 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
type RecipientRole = 'FARMER' | 'DEALER' | 'FACILITATOR'
type SubStatus = 'ALL' | 'CURRENTLY_ACTIVE' | 'WAITLISTED' | 'PAST' | 'NEVER_SUBSCRIBED'
type QuestionType =
  | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'YES_NO' | 'RATING_SCALE'
  | 'NUMBER' | 'SHORT_TEXT' | 'PARAGRAPH_TEXT' | 'DATE' | 'PHOTO_UPLOAD'

interface FilterOption { id: string; name: string }
interface FilterOptions {
  states: FilterOption[]
  districts: FilterOption[]
  crops: FilterOption[] | null
  promoters: FilterOption[] | null
  subscription_statuses: string[] | null
}

interface AudienceFilters {
  state_cosh_id?: string
  district_cosh_id?: string
  crop_cosh_id?: string
  subscription_status?: SubStatus
  promoter_user_id?: string
}

interface Question {
  id: string
  sort_order: number
  question_type: QuestionType
  label: string
  help_text: string | null
  is_mandatory: boolean
  choice_options: string[] | null
  number_unit: string | null
  rating_scale_type: string | null
}

const SUB_STATUS_LABEL: Record<SubStatus, string> = {
  ALL: 'All subscription statuses',
  CURRENTLY_ACTIVE: 'Currently Active',
  WAITLISTED: 'Waitlisted (pre-approval)',
  PAST: 'Past (completed)',
  NEVER_SUBSCRIBED: 'Never Subscribed',
}

const TYPE_LABEL: Record<CampaignType, string> = {
  ANNOUNCEMENT: 'Announcement',
  INTEREST_CAPTURE: 'Interest Capture',
  FEEDBACK: 'Feedback',
  SURVEY: 'Survey',
}

const TYPE_DESCRIPTION: Record<CampaignType, string> = {
  ANNOUNCEMENT: 'One-way message. No response collected.',
  INTEREST_CAPTURE: 'Recipient taps Yes / No / Maybe. Built-in — no extra questions.',
  FEEDBACK: '5-star rating is the main response. You can add up to 3 follow-up questions.',
  SURVEY: 'Multi-question form. Up to 20 questions, 9 question types.',
}

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Single choice (pick one)',
  MULTIPLE_CHOICE: 'Multiple choice (pick many)',
  YES_NO: 'Yes / No',
  RATING_SCALE: 'Rating scale (1–5 stars)',
  NUMBER: 'Number with unit',
  SHORT_TEXT: 'Short text',
  PARAGRAPH_TEXT: 'Paragraph text',
  DATE: 'Date',
  PHOTO_UPLOAD: 'Photo upload',
}

function typeNeedsSurveyBuilder(t: CampaignType): boolean {
  return t === 'SURVEY' || t === 'FEEDBACK'
}

export default function NewCampaignPage() {
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id

  const [step, setStep] = useState(0)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1 — Basics
  const [name, setName] = useState('')
  const [campaignType, setCampaignType] = useState<CampaignType>('ANNOUNCEMENT')
  const [recipientRole, setRecipientRole] = useState<RecipientRole>('FARMER')
  const [description, setDescription] = useState('')

  // Step 2 — Audience
  const [filters, setFilters] = useState<AudienceFilters>({})
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)
  const [audiencePreview, setAudiencePreview] = useState<{ matched: number; excluded_missing_district: number } | null>(null)

  // Step 3 — Content
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [languageCode, setLanguageCode] = useState('en')
  const [ratingScale, setRatingScale] = useState<'STAR_5'>('STAR_5')

  // Step 4 — Survey Builder (conditional)
  const [questions, setQuestions] = useState<Question[]>([])

  // Step 6 — Send
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })

  // Dynamic step list based on campaign_type
  const steps = useMemo(() => {
    const base = ['Basics', 'Audience', 'Content']
    if (typeNeedsSurveyBuilder(campaignType)) base.push('Survey Builder')
    base.push('Preview', 'Send')
    return base
  }, [campaignType])

  // ── Load cascading filter options whenever role changes ───────────
  useEffect(() => {
    if (!clientId) return
    setFilterOptions(null)
    api.get<FilterOptions>(
      `/client/${clientId}/messaging/filter-options?recipient_role=${recipientRole}`,
    )
      .then(({ data }) => setFilterOptions(data))
      .catch(() => setFilterOptions(null))
  }, [clientId, recipientRole])

  // ── Audience preview on Step 2 ────────────────────────────────────
  useEffect(() => {
    if (!clientId || step !== 1) return
    const normalised: AudienceFilters = {}
    for (const k of Object.keys(filters) as (keyof AudienceFilters)[]) {
      const v = filters[k]
      if (v !== undefined && v !== '') (normalised as Record<string, unknown>)[k] = v
    }
    api.post<{ matched: number; excluded_missing_district: number }>(
      `/client/${clientId}/messaging/audience-preview`,
      { recipient_role: recipientRole, audience_filters: normalised },
    )
      .then(({ data }) => setAudiencePreview(data))
      .catch(() => setAudiencePreview(null))
  }, [clientId, step, recipientRole, filters])

  // ── Save draft (create on first save, PATCH on subsequent) ────────
  const saveDraft = useCallback(async (): Promise<string | null> => {
    if (!clientId) return null
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        campaign_type: campaignType,
        recipient_role: recipientRole,
        description: description || null,
        title: title.trim(),
        body,
        language_code: languageCode,
        audience_filters: filters,
        rating_scale_type: campaignType === 'FEEDBACK' ? ratingScale : null,
      }
      if (!draftId) {
        payload.title = (payload.title as string) || (payload.name as string) || 'Untitled campaign'
        payload.body = (payload.body as string) || ' '
        const { data } = await api.post<{ campaign: { id: string } }>(
          `/client/${clientId}/messaging/campaigns`, payload,
        )
        setDraftId(data.campaign.id)
        return data.campaign.id
      } else {
        await api.patch(
          `/client/${clientId}/messaging/campaigns/${draftId}`, payload,
        )
        return draftId
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not save draft.'))
      return null
    } finally {
      setSaving(false)
    }
  }, [clientId, draftId, name, campaignType, recipientRole, description, title, body, languageCode, filters, ratingScale])

  // Reset questions when type flips away from a survey-needing type
  useEffect(() => {
    if (!typeNeedsSurveyBuilder(campaignType)) setQuestions([])
  }, [campaignType])

  // ── Question CRUD ─────────────────────────────────────────────────
  async function addQuestion(payload: Omit<Question, 'id' | 'sort_order'>) {
    if (!clientId || !draftId) return
    try {
      const { data } = await api.post<Question>(
        `/client/${clientId}/messaging/campaigns/${draftId}/questions`,
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
        `/client/${clientId}/messaging/campaigns/${draftId}/questions/${q.id}`,
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
      await api.delete(`/client/${clientId}/messaging/campaigns/${draftId}/questions/${id}`)
      setQuestions(qs => qs.filter(x => x.id !== id))
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not delete question.'))
    }
  }

  const stepLabel = steps[step]
  const nextDisabled = useMemo(() => {
    if (stepLabel === 'Basics') return !name.trim()
    if (stepLabel === 'Audience') return (audiencePreview?.matched ?? 0) <= 0
    if (stepLabel === 'Content') return !title.trim() || !body.trim()
    if (stepLabel === 'Survey Builder') {
      if (campaignType === 'SURVEY' && questions.length === 0) return true
      if (campaignType === 'FEEDBACK' && questions.length > 3) return true
    }
    return false
  }, [stepLabel, name, title, body, audiencePreview, campaignType, questions])

  async function onNext() {
    if (nextDisabled) return
    const id = await saveDraft()
    if (!id) return
    setStep(s => Math.min(steps.length - 1, s + 1))
  }
  function onBack() { setStep(s => Math.max(0, s - 1)) }

  async function onSend() {
    if (!clientId || !draftId) return
    setSaving(true); setError('')
    try {
      const expires = new Date(`${expiresAt}T23:59:59`).toISOString()
      await api.post(
        `/client/${clientId}/messaging/campaigns/${draftId}/send`,
        { expires_at: expires },
      )
      router.push(`/campaigns/${draftId}`)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not send campaign.'))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!clientId || !draftId) { router.push('/campaigns'); return }
    const ok = confirm('Discard this draft?')
    if (!ok) return
    try {
      await api.delete(`/client/${clientId}/messaging/campaigns/${draftId}`)
    } catch { /* ignore */ }
    router.push('/campaigns')
  }

  const roleLabel = { FARMER: 'Farmers', DEALER: 'Dealers', FACILITATOR: 'Facilitators' }[recipientRole]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">New Campaign</h1>
        <p className="text-sm text-slate-500 mt-1">
          Follow the steps. Your draft auto-saves as you go — close any
          time and pick up from Campaigns.
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
            <span className="text-xs uppercase tracking-wider text-slate-500">Campaign name</span>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Internal name — not shown to recipients"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
            />
          </label>
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-500">Type</span>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {(['ANNOUNCEMENT', 'INTEREST_CAPTURE', 'FEEDBACK', 'SURVEY'] as CampaignType[]).map(t => {
                const active = campaignType === t
                return (
                  <button
                    key={t} type="button"
                    onClick={() => setCampaignType(t)}
                    className={`text-left rounded-xl p-3 border-2 transition-colors ${
                      active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <p className="font-medium text-sm text-slate-900">{TYPE_LABEL[t]}</p>
                    <p className="text-xs text-slate-500 mt-1">{TYPE_DESCRIPTION[t]}</p>
                  </button>
                )
              })}
            </div>
          </div>
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Recipient role</span>
            <select
              value={recipientRole}
              onChange={e => setRecipientRole(e.target.value as RecipientRole)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="FARMER">Farmers</option>
              <option value="DEALER">Dealers</option>
              <option value="FACILITATOR">Facilitators</option>
            </select>
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

      {/* ── Step: Audience ───────────────────────────────────────── */}
      {stepLabel === 'Audience' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Audience</h2>
          <p className="text-sm text-slate-500">
            Narrow down which {roleLabel} should receive this campaign. All
            filters are combined with AND. Leave a filter blank to include all.
          </p>
          {!filterOptions ? (
            <p className="text-sm text-slate-400">Loading options…</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FilterSelect
                label="State" value={filters.state_cosh_id || ''}
                onChange={v => setFilters(f => ({ ...f, state_cosh_id: v || undefined }))}
                options={filterOptions.states} allLabel="All states"
              />
              <FilterSelect
                label="District" value={filters.district_cosh_id || ''}
                onChange={v => setFilters(f => ({ ...f, district_cosh_id: v || undefined }))}
                options={filterOptions.districts} allLabel="All districts"
              />
              {filterOptions.crops && (
                <FilterSelect
                  label="Crop" value={filters.crop_cosh_id || ''}
                  onChange={v => setFilters(f => ({ ...f, crop_cosh_id: v || undefined }))}
                  options={filterOptions.crops} allLabel="All crops"
                />
              )}
              {filterOptions.subscription_statuses && (
                <label className="block">
                  <span className="text-xs uppercase tracking-wider text-slate-500">Subscription status</span>
                  <select
                    value={filters.subscription_status || 'ALL'}
                    onChange={e => setFilters(f => ({ ...f, subscription_status: e.target.value as SubStatus }))}
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
                  >
                    {filterOptions.subscription_statuses.map(s => (
                      <option key={s} value={s}>{SUB_STATUS_LABEL[s as SubStatus] ?? s}</option>
                    ))}
                  </select>
                </label>
              )}
              {filterOptions.promoters && (
                <FilterSelect
                  label="Promoter" value={filters.promoter_user_id || ''}
                  onChange={v => setFilters(f => ({ ...f, promoter_user_id: v || undefined }))}
                  options={filterOptions.promoters} allLabel="All promoters"
                />
              )}
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">
              {audiencePreview === null
                ? 'Computing…'
                : `${audiencePreview.matched} ${roleLabel.toLowerCase()} match your audience.`}
            </p>
            {audiencePreview && audiencePreview.excluded_missing_district > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                {audiencePreview.excluded_missing_district} additional{' '}
                {roleLabel.toLowerCase()} have no district on file — they are
                included in this audience, but a future district-narrowed
                campaign would silently drop them.
              </p>
            )}
            {audiencePreview && audiencePreview.matched === 0 && (
              <p className="text-xs text-rose-600 mt-1">
                Adjust filters — campaigns cannot be sent with an empty audience.
              </p>
            )}
          </div>
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
          {campaignType === 'FEEDBACK' && (
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
        </section>
      )}

      {/* ── Step: Survey Builder (SURVEY or FEEDBACK follow-ups) ─── */}
      {stepLabel === 'Survey Builder' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {campaignType === 'FEEDBACK' ? 'Follow-up questions' : 'Survey questions'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {campaignType === 'FEEDBACK'
                ? 'The star rating is collected automatically. Add up to 3 optional follow-up questions.'
                : 'Add up to 20 questions. Recipients see them in the order shown here.'}
            </p>
          </div>
          <QuestionsEditor
            questions={questions}
            onAdd={addQuestion}
            onUpdate={updateQuestion}
            onDelete={deleteQuestion}
            maxCount={campaignType === 'FEEDBACK' ? 3 : 20}
          />
        </section>
      )}

      {/* ── Step: Preview ─────────────────────────────────────────── */}
      {stepLabel === 'Preview' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-slate-900">Preview</h2>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Recipient will see</p>
            <p className="text-sm font-semibold text-slate-800 mt-2">{title || '(no title)'}</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap mt-2">{body || '(no body)'}</p>

            {/* Per-type response preview */}
            {campaignType === 'INTEREST_CAPTURE' && (
              <div className="mt-4 flex gap-2">
                {(['Yes', 'No', 'Maybe'] as const).map(l => (
                  <div key={l} className="flex-1 border border-slate-300 rounded-lg px-4 py-3 text-center text-sm font-medium text-slate-600">
                    {l}
                  </div>
                ))}
              </div>
            )}
            {campaignType === 'FEEDBACK' && (
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
            {campaignType === 'SURVEY' && (
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
              <p className="text-xs uppercase tracking-wider text-slate-400">Audience</p>
              <p className="text-slate-800 mt-1">
                {audiencePreview?.matched ?? 0} {roleLabel.toLowerCase()}
              </p>
              {audiencePreview && audiencePreview.excluded_missing_district > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  + {audiencePreview.excluded_missing_district} with no district on file
                </p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Expires</p>
              <label className="mt-1 block">
                <input
                  type="date" value={expiresAt}
                  min={(() => {
                    const d = new Date(); d.setDate(d.getDate() + 1)
                    return d.toISOString().slice(0, 10)
                  })()}
                  onChange={e => setExpiresAt(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5"
                />
              </label>
              <p className="text-xs text-slate-400 mt-1">Minimum 1 day, maximum 180 days.</p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <strong>Once sent, this campaign cannot be edited.</strong>{' '}
            Review carefully. Recipients cannot un-receive. Responses are final — they cannot be edited or withdrawn.
          </div>
        </section>
      )}

      {/* ── Step: Send ────────────────────────────────────────────── */}
      {stepLabel === 'Send' && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-center">
          <h2 className="text-lg font-semibold text-slate-900">Ready to send</h2>
          <p className="text-sm text-slate-600">
            {audiencePreview?.matched ?? 0} {roleLabel.toLowerCase()} will receive this campaign immediately.
          </p>
          <button
            type="button" onClick={onSend} disabled={saving}
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Sending…' : 'Send now'}
          </button>
        </section>
      )}

      {/* ── Nav footer ────────────────────────────────────────────── */}
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

function FilterSelect({ label, value, onChange, options, allLabel }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: FilterOption[]
  allLabel: string
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
      >
        <option value="">{allLabel}</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  )
}

// ── Survey Builder ─────────────────────────────────────────────────

function QuestionsEditor({ questions, onAdd, onUpdate, onDelete, maxCount }: {
  questions: Question[]
  onAdd: (q: Omit<Question, 'id' | 'sort_order'>) => void
  onUpdate: (q: Question) => void
  onDelete: (id: string) => void
  maxCount: number
}) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)

  function startNew() {
    setEditing(null); setShowForm(true)
  }
  function startEdit(q: Question) {
    setEditing(q); setShowForm(true)
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {questions.map((q, i) => (
          <li key={q.id} className="border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {i + 1}. {q.label} {q.is_mandatory && <span className="text-rose-500 text-xs">(required)</span>}
              </p>
              {q.help_text && <p className="text-xs text-slate-500 mt-0.5">{q.help_text}</p>}
              <p className="text-xs text-slate-400 mt-1">{QUESTION_TYPE_LABEL[q.question_type]}</p>
              {q.choice_options && q.choice_options.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">Options: {q.choice_options.join(' · ')}</p>
              )}
              {q.number_unit && (
                <p className="text-xs text-slate-500 mt-1">Unit: {q.number_unit}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button" onClick={() => startEdit(q)}
                className="text-xs px-2 py-1 border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
              >Edit</button>
              <button
                type="button" onClick={() => onDelete(q.id)}
                className="text-xs px-2 py-1 border border-rose-200 rounded text-rose-600 hover:bg-rose-50"
              >Remove</button>
            </div>
          </li>
        ))}
      </ol>
      {questions.length >= maxCount ? (
        <p className="text-xs text-slate-500 italic">Maximum of {maxCount} question{maxCount === 1 ? '' : 's'} reached.</p>
      ) : (
        <button
          type="button" onClick={startNew}
          className="text-sm px-4 py-2 rounded-lg border-2 border-dashed border-slate-300 text-slate-600 hover:border-slate-400 w-full"
        >
          + Add question
        </button>
      )}
      {showForm && (
        <QuestionFormModal
          initial={editing}
          onCancel={() => setShowForm(false)}
          onSave={(payload) => {
            if (editing) {
              onUpdate({ ...editing, ...payload })
            } else {
              onAdd(payload)
            }
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function QuestionFormModal({ initial, onCancel, onSave }: {
  initial: Question | null
  onCancel: () => void
  onSave: (q: Omit<Question, 'id' | 'sort_order'>) => void
}) {
  const [qt, setQt] = useState<QuestionType>(initial?.question_type ?? 'SHORT_TEXT')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [helpText, setHelpText] = useState(initial?.help_text ?? '')
  const [mandatory, setMandatory] = useState(initial?.is_mandatory ?? false)
  const [choiceOptions, setChoiceOptions] = useState<string[]>(initial?.choice_options ?? ['', ''])
  const [numberUnit, setNumberUnit] = useState(initial?.number_unit ?? '')

  function updateOption(i: number, v: string) {
    setChoiceOptions(opts => opts.map((o, idx) => idx === i ? v : o))
  }
  function addOption() {
    if (choiceOptions.length < 10) setChoiceOptions(opts => [...opts, ''])
  }
  function removeOption(i: number) {
    if (choiceOptions.length > 2) setChoiceOptions(opts => opts.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    const needsChoices = qt === 'SINGLE_CHOICE' || qt === 'MULTIPLE_CHOICE'
    const cleaned = choiceOptions.map(o => o.trim()).filter(Boolean)
    if (needsChoices && cleaned.length < 2) {
      alert('Add at least 2 options.')
      return
    }
    if (qt === 'NUMBER' && !numberUnit.trim()) {
      alert('Enter a unit (e.g. quintals, kg, Rs.)')
      return
    }
    onSave({
      question_type: qt,
      label: label.trim() || '(untitled)',
      help_text: helpText.trim() || null,
      is_mandatory: mandatory,
      choice_options: needsChoices ? cleaned : null,
      number_unit: qt === 'NUMBER' ? numberUnit.trim() : null,
      rating_scale_type: qt === 'RATING_SCALE' ? 'STAR_5' : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-xl">
        <header className="p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">
            {initial ? 'Edit question' : 'New question'}
          </h3>
        </header>
        <div className="p-5 space-y-3">
          <label className="block text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Question type</span>
            <select
              value={qt} onChange={e => setQt(e.target.value as QuestionType)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              {Object.keys(QUESTION_TYPE_LABEL).map(k => (
                <option key={k} value={k}>{QUESTION_TYPE_LABEL[k as QuestionType]}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Question text</span>
            <input
              type="text" value={label} onChange={e => setLabel(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
              maxLength={500}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider">Help text (optional)</span>
            <input
              type="text" value={helpText} onChange={e => setHelpText(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2"
              maxLength={500}
            />
          </label>
          {(qt === 'SINGLE_CHOICE' || qt === 'MULTIPLE_CHOICE') && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider">Options (2–10)</p>
              <div className="space-y-2 mt-1">
                {choiceOptions.map((opt, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text" value={opt}
                      onChange={e => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    {choiceOptions.length > 2 && (
                      <button
                        type="button" onClick={() => removeOption(i)}
                        className="text-xs text-rose-500 hover:text-rose-700 px-2"
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
              {choiceOptions.length < 10 && (
                <button
                  type="button" onClick={addOption}
                  className="text-xs text-blue-600 hover:text-blue-800 mt-2"
                >+ Add option</button>
              )}
            </div>
          )}
          {qt === 'NUMBER' && (
            <label className="block text-sm">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Unit</span>
              <input
                type="text" value={numberUnit} onChange={e => setNumberUnit(e.target.value)}
                placeholder="e.g. quintals, kg, Rs."
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox" checked={mandatory}
              onChange={e => setMandatory(e.target.checked)}
            />
            <span>Recipient must answer this question to submit</span>
          </label>
        </div>
        <footer className="p-5 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button" onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
          >Cancel</button>
          <button
            type="button" onClick={handleSave}
            disabled={!label.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >Save</button>
        </footer>
      </div>
    </div>
  )
}
