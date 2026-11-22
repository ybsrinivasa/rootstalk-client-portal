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
        // 2026-11-22 — Backend only requires name + campaign_type +
        // recipient_role at CREATE. title + body stay optional through
        // Basics/Audience and get validated non-empty at SEND. No more
        // placeholder hacks.
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

          {/* Attachments — up to 3 files × 10 MB each. Composer must
              save the draft first so the attachment can hang off a
              real campaign_id; the panel prompts the CA to Next if
              no draft exists yet. */}
          <AttachmentsPanel
            draftId={draftId}
            clientId={clientId || ''}
            onError={setError}
          />
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

          <TestSendPanel
            draftId={draftId}
            clientId={clientId || ''}
            onError={setError}
          />
        </section>
      )}

      {/* ── Step: Send ────────────────────────────────────────────── */}
      {stepLabel === 'Send' && (
        <SendStep
          audienceCount={audiencePreview?.matched ?? 0}
          roleLabel={roleLabel}
          expiresAtYmd={expiresAt}
          setExpiresAtYmd={setExpiresAt}
          onSendNow={onSend}
          onScheduleSend={async (localIso: string) => {
            if (!clientId || !draftId) return
            setSaving(true); setError('')
            try {
              const sendAtIso = new Date(localIso).toISOString()
              // Expiry defaults to 7 days from send_at; align here so
              // backend doesn't re-default and surface a different value.
              const sendAtDate = new Date(sendAtIso)
              const expIso = new Date(`${expiresAt}T23:59:59`).toISOString()
              const body: Record<string, unknown> = { send_at: sendAtIso }
              // Only include expires_at if user picked a date > send_at + 1d
              const minExp = new Date(sendAtDate.getTime() + 24 * 3600 * 1000)
              if (new Date(expIso) >= minExp) {
                body.expires_at = expIso
              }
              await api.post(
                `/client/${clientId}/messaging/campaigns/${draftId}/send`,
                body,
              )
              router.push(`/campaigns/${draftId}`)
            } catch (err) {
              const detail = (err as { response?: { data?: { detail?: unknown } } })
                ?.response?.data?.detail
              const code = (detail as { code?: string })?.code
              const message = (detail as { message?: string })?.message
              setError(message || (code === 'send_at_too_far'
                ? 'Scheduled send must be within 180 days.'
                : 'Could not schedule.'))
            } finally {
              setSaving(false)
            }
          }}
          saving={saving}
        />
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

interface Attachment {
  id: string
  kind: 'IMAGE' | 'VIDEO' | 'PDF'
  url: string
  original_filename: string
  mime_type: string
  size_bytes: number
  sort_order: number
}

function AttachmentsPanel({ draftId, clientId, onError }: {
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
      `/client/${clientId}/messaging/campaigns/${draftId}/attachments`,
    )
      .then(({ data }) => setItems(data.attachments))
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false))
  }, [draftId, clientId])

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!draftId) {
      onError('Save the draft first — click Next to Audience and come back.')
      e.target.value = ''
      return
    }
    if (items.length >= 3) {
      onError('Maximum 3 attachments per campaign.')
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
        `/client/${clientId}/messaging/campaigns/${draftId}/attachments`,
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
      await api.delete(`/client/${clientId}/messaging/campaigns/${draftId}/attachments/${id}`)
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

function TestSendPanel({ draftId, clientId, onError }: {
  draftId: string | null
  clientId: string
  onError: (msg: string) => void
}) {
  const [phones, setPhones] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleSend() {
    if (!draftId || !clientId) {
      onError('Save the draft first (go Back and then Next).')
      return
    }
    const arr = phones.split(',').map(p => p.trim()).filter(Boolean)
    if (arr.length === 0) {
      onError('Enter at least one phone number.')
      return
    }
    if (arr.length > 5) {
      onError('Test-send accepts at most 5 phone numbers.')
      return
    }
    setSending(true); setResult(null)
    try {
      const { data } = await api.post<{ resolved_count: number; unresolved: string[] }>(
        `/client/${clientId}/messaging/campaigns/${draftId}/test-send`,
        { phones: arr },
      )
      let msg = `Test sent to ${data.resolved_count} recipient${data.resolved_count === 1 ? '' : 's'}.`
      if (data.unresolved?.length) {
        msg += ` Skipped (no matching account): ${data.unresolved.join(', ')}.`
      }
      setResult(msg)
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail
      const code = (detail as { code?: string })?.code
      const message = (detail as { message?: string })?.message
      onError(
        code === 'no_matching_phones'
          ? 'None of those phones match a RootsTalk account.'
          : message || 'Test send failed.'
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          Test send
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Send a preview to your own phone (and up to 4 others) before the real send.
          Test recipients see a <strong>TEST</strong> badge and are excluded from analytics.
        </p>
      </div>
      <input
        type="text"
        value={phones}
        onChange={e => setPhones(e.target.value)}
        placeholder="9876543210, 9123456789"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono bg-white"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !phones.trim()}
          className="text-xs px-3 py-1.5 border border-slate-300 rounded-lg bg-white text-slate-700 hover:border-slate-400 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send test'}
        </button>
        {result && (
          <span className="text-xs text-emerald-700">{result}</span>
        )}
      </div>
    </div>
  )
}

function SendStep({ audienceCount, roleLabel, expiresAtYmd, setExpiresAtYmd, onSendNow, onScheduleSend, saving }: {
  audienceCount: number
  roleLabel: string
  expiresAtYmd: string
  setExpiresAtYmd: (v: string) => void
  onSendNow: () => void
  onScheduleSend: (localIso: string) => void | Promise<void>
  saving: boolean
}) {
  const [mode, setMode] = useState<'now' | 'later'>('now')
  // Default scheduled send: tomorrow 07:00 local — "morning after"
  // is a common CA ask (compose in the evening, send at breakfast).
  const [schedDate, setSchedDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [schedTime, setSchedTime] = useState('07:00')

  const localIso = `${schedDate}T${schedTime}:00`
  const chosen = new Date(localIso)
  const now = new Date()
  const invalidLater = isNaN(chosen.getTime()) || chosen.getTime() <= now.getTime()

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Ready to send</h2>
      <p className="text-sm text-slate-600">
        {audienceCount} {roleLabel.toLowerCase()} will receive this campaign{mode === 'now' ? ' immediately.' : ' at the time you pick.'}
      </p>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setMode('now')}
          className={`px-4 py-1.5 text-xs font-medium rounded ${mode === 'now' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
        >Send now</button>
        <button
          type="button"
          onClick={() => setMode('later')}
          className={`px-4 py-1.5 text-xs font-medium rounded ${mode === 'later' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
        >Send later</button>
      </div>

      {mode === 'later' && (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">
            The campaign will stay in <strong>Scheduled</strong> state and go out
            automatically at the chosen time. Audience is computed at send time, not
            right now — new {roleLabel.toLowerCase()} who match your filters between now
            and then will be included.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-xs uppercase tracking-wider text-slate-500">Date</span>
              <input
                type="date" value={schedDate}
                min={(() => { const d = new Date(); return d.toISOString().slice(0, 10) })()}
                onChange={e => setSchedDate(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-xs uppercase tracking-wider text-slate-500">Time (local)</span>
              <input
                type="time" value={schedTime}
                onChange={e => setSchedTime(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-xs uppercase tracking-wider text-slate-500">Expires on</span>
            <input
              type="date" value={expiresAtYmd}
              onChange={e => setExpiresAtYmd(e.target.value)}
              min={schedDate}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">Must be at least 1 day after the send time.</p>
          </label>
          {invalidLater && (
            <p className="text-xs text-rose-600">Pick a date/time in the future.</p>
          )}
        </div>
      )}

      <div className="pt-2 text-center">
        {mode === 'now' ? (
          <button
            type="button" onClick={onSendNow} disabled={saving}
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Sending…' : 'Send now'}
          </button>
        ) : (
          <button
            type="button" onClick={() => onScheduleSend(localIso)} disabled={saving || invalidLater}
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Scheduling…' : `Schedule for ${chosen.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          </button>
        )}
      </div>
    </section>
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
