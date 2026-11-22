'use client'

// Campaign composer wizard — 5 steps: Basics → Audience → Content →
// Preview → Send. Milestone 1 ships Announcement end-to-end; the
// Survey Builder step appears only for SURVEY campaigns and is a
// placeholder until Milestone 2.
//
// The draft is auto-created on first Save (end of Basics) so the
// composer can save-as-you-go via PATCH from then on.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

type CampaignType = 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
type RecipientRole = 'FARMER' | 'DEALER' | 'FACILITATOR'
type SubStatus = 'ALL' | 'CURRENTLY_ACTIVE' | 'WAITLISTED' | 'PAST' | 'NEVER_SUBSCRIBED'

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

const SUB_STATUS_LABEL: Record<SubStatus, string> = {
  ALL: 'All subscription statuses',
  CURRENTLY_ACTIVE: 'Currently Active',
  WAITLISTED: 'Waitlisted (pre-approval)',
  PAST: 'Past (completed)',
  NEVER_SUBSCRIBED: 'Never Subscribed',
}

const STEPS = ['Basics', 'Audience', 'Content', 'Preview', 'Send'] as const

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

  // Step 5 — Send
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  })

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
      const payload = {
        name: name.trim(),
        campaign_type: campaignType,
        recipient_role: recipientRole,
        description: description || null,
        title: title.trim(),
        body,
        language_code: languageCode,
        audience_filters: filters,
      }
      if (!draftId) {
        // POST — create
        // Backend requires name+campaign_type+recipient_role+title+body
        // minimum. Provide placeholders when still in Basics so the
        // draft can be created early.
        payload.title = payload.title || payload.name || 'Untitled campaign'
        payload.body = payload.body || ' '
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
  }, [clientId, draftId, name, campaignType, recipientRole, description, title, body, languageCode, filters])

  const nextDisabled = useMemo(() => {
    if (step === 0) return !name.trim()
    if (step === 1) return (audiencePreview?.matched ?? 0) <= 0
    if (step === 2) return !title.trim() || !body.trim()
    return false
  }, [step, name, title, body, audiencePreview])

  async function onNext() {
    if (nextDisabled) return
    const id = await saveDraft()
    if (!id) return
    setStep(s => Math.min(STEPS.length - 1, s + 1))
  }
  function onBack() { setStep(s => Math.max(0, s - 1)) }

  async function onSend() {
    if (!clientId || !draftId) return
    setSaving(true); setError('')
    try {
      const expires = new Date(`${expiresAt}T23:59:59`).toISOString()
      const { data } = await api.post(
        `/client/${clientId}/messaging/campaigns/${draftId}/send`,
        { expires_at: expires },
      )
      // Route to detail page
      router.push(`/campaigns/${draftId}`)
      return data
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
    } catch {
      // ignore — route back anyway
    }
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
      <div className="flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => {
          const active = i === step
          const done = i < step
          return (
            <div key={label} className="flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold ${
                active ? 'bg-blue-600 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}>{done ? '✓' : i + 1}</span>
              <span className={`${active ? 'text-slate-900 font-medium' : done ? 'text-slate-600' : 'text-slate-400'}`}>{label}</span>
              {i < STEPS.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* ── Step 1: Basics ───────────────────────────────────────── */}
      {step === 0 && (
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
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-500">Type</span>
            <select
              value={campaignType}
              onChange={e => setCampaignType(e.target.value as CampaignType)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="ANNOUNCEMENT">Announcement (no response collected)</option>
              <option value="INTEREST_CAPTURE" disabled>Interest Capture (coming soon)</option>
              <option value="FEEDBACK" disabled>Feedback (coming soon)</option>
              <option value="SURVEY" disabled>Survey (coming soon)</option>
            </select>
          </label>
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

      {/* ── Step 2: Audience ──────────────────────────────────────── */}
      {step === 1 && (
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
                options={filterOptions.states}
                allLabel="All states"
              />
              <FilterSelect
                label="District" value={filters.district_cosh_id || ''}
                onChange={v => setFilters(f => ({ ...f, district_cosh_id: v || undefined }))}
                options={filterOptions.districts}
                allLabel="All districts"
              />
              {filterOptions.crops && (
                <FilterSelect
                  label="Crop" value={filters.crop_cosh_id || ''}
                  onChange={v => setFilters(f => ({ ...f, crop_cosh_id: v || undefined }))}
                  options={filterOptions.crops}
                  allLabel="All crops"
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
                  options={filterOptions.promoters}
                  allLabel="All promoters"
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

      {/* ── Step 3: Content ───────────────────────────────────────── */}
      {step === 2 && (
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
        </section>
      )}

      {/* ── Step 4: Preview ───────────────────────────────────────── */}
      {step === 3 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <h2 className="text-lg font-semibold text-slate-900">Preview</h2>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">Recipient will see</p>
            <p className="text-sm font-semibold text-slate-800 mt-2">{title || '(no title)'}</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap mt-2">{body || '(no body)'}</p>
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

      {/* ── Step 5: Send ──────────────────────────────────────────── */}
      {step === 4 && (
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
          {step < STEPS.length - 1 && (
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
