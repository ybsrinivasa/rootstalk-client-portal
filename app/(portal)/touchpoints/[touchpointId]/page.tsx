'use client'

// Touchpoint detail — status + lifecycle actions, content preview,
// trigger list, question list, delivery analytics, per-question
// aggregates, individual-response drill-down, and CSV export.
//
// The Touchpoint model has no is_test — every recipient row is a
// real firing, so analytics counts hit the full population.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ExportCsvButton } from '@/components/reports/export-button'

type ContentType = 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
type Status = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
type FireAt = 'BEGINNING' | 'END'
type AssignmentStatus = 'ACTIVE' | 'PAUSED'

interface Touchpoint {
  id: string
  name: string
  content_type: ContentType
  status: Status
  title: string
  body: string
  rating_scale_type: string | null
  per_firing_expiry_days: number
  activated_at: string | null
  paused_at: string | null
  archived_at: string | null
  content_locked_at: string | null
}

interface Assignment {
  id: string
  package_id: string
  package_name: string
  timeline_id: string
  timeline_name: string
  crop_cosh_id: string
  crop_name: string
  fire_at: FireAt
  status: AssignmentStatus
}

interface Question {
  id: string
  sort_order: number
  question_type: string
  label: string
  help_text: string | null
  is_mandatory: boolean
  choice_options: string[] | null
  number_unit: string | null
  rating_scale_type: string | null
}

interface Attachment {
  id: string
  kind: 'IMAGE' | 'VIDEO' | 'PDF'
  url: string | null
  original_filename: string
  mime_type: string
  size_bytes: number
  sort_order: number
}

interface DetailPayload {
  touchpoint: Touchpoint
  assignments: Assignment[]
  questions: Question[]
  attachments: Attachment[]
}

interface QuestionAgg {
  question_id: string
  label: string
  question_type: string
  response_count: number
  choice_tally?: Record<string, number>
  yes_no?: { YES: number; NO: number }
  stats?: { min: number; max: number; mean: number; count: number }
}

interface AnalyticsPayload {
  touchpoint: Touchpoint
  delivery: {
    recipient_count: number
    pushed: number
    opened: number
    responded: number
  }
  interest_capture: Record<string, number> | null
  feedback_rating_histogram: Record<string, number> | null
  questions: QuestionAgg[]
}

interface ResponseRow {
  response_id: string
  recipient_name: string
  recipient_phone_masked: string
  recipient_state: string
  recipient_district: string
  timeline_name: string
  fire_at: FireAt
  submitted_at: string | null
  interest_answer: string | null
  rating: number | null
  answers: {
    question_id: string
    question_label: string
    question_type: string
    display_value: string
  }[]
}

interface ResponsesPayload {
  rows: ResponseRow[]
  total: number
  page: number
  page_size: number
  questions: { id: string; label: string; question_type: string; sort_order: number }[]
}

const TYPE_LABEL: Record<ContentType, string> = {
  ANNOUNCEMENT: 'Announcement',
  INTEREST_CAPTURE: 'Interest Capture',
  FEEDBACK: 'Feedback',
  SURVEY: 'Survey',
}
const STATUS_CHIP: Record<Status, { label: string; cls: string }> = {
  DRAFT:    { label: 'Draft',    cls: 'bg-slate-100 text-slate-700' },
  ACTIVE:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700' },
  PAUSED:   { label: 'Paused',   cls: 'bg-amber-100 text-amber-800' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-400' },
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function pct(n: number, d: number | null | undefined): string {
  if (!d || d <= 0) return '—'
  return `${Math.round((n / d) * 100)}%`
}

const PAGE_SIZE = 50

export default function TouchpointDetailPage() {
  const params = useParams()
  const router = useRouter()
  const touchpointId = params?.touchpointId as string | undefined
  const client = getClient()
  const clientId = client?.id

  const [detail, setDetail] = useState<DetailPayload | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)

  const [responses, setResponses] = useState<ResponsesPayload | null>(null)
  const [respPage, setRespPage] = useState(1)
  const [respLoading, setRespLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(() => {
    if (!clientId || !touchpointId) return
    setLoading(true); setError('')
    Promise.all([
      api.get<DetailPayload>(`/client/${clientId}/touchpoints/${touchpointId}`),
      api.get<AnalyticsPayload>(`/client/${clientId}/touchpoints/${touchpointId}/analytics`),
    ])
      .then(([d, a]) => { setDetail(d.data); setAnalytics(a.data) })
      .catch(err => setError(extractErrorMessage(err, 'Could not load touchpoint.')))
      .finally(() => setLoading(false))
  }, [clientId, touchpointId])

  const loadResponses = useCallback(() => {
    if (!clientId || !touchpointId) return
    setRespLoading(true)
    api.get<ResponsesPayload>(
      `/client/${clientId}/touchpoints/${touchpointId}/responses?page=${respPage}&page_size=${PAGE_SIZE}`,
    )
      .then(({ data }) => setResponses(data))
      .catch(() => { /* silent */ })
      .finally(() => setRespLoading(false))
  }, [clientId, touchpointId, respPage])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!analytics) return
    if (analytics.touchpoint.content_type === 'ANNOUNCEMENT') return
    loadResponses()
  }, [analytics, loadResponses])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onActivate() {
    if (!clientId || !touchpointId) return
    setActing(true); setError('')
    try {
      await api.post(`/client/${clientId}/touchpoints/${touchpointId}/activate`)
      load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not activate.'))
    } finally { setActing(false) }
  }

  async function onPause() {
    if (!clientId || !touchpointId) return
    const ok = confirm('Pause this touchpoint? It will stop firing on all triggers until resumed.')
    if (!ok) return
    setActing(true); setError('')
    try {
      await api.post(`/client/${clientId}/touchpoints/${touchpointId}/pause`)
      load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not pause.'))
    } finally { setActing(false) }
  }

  async function onArchive() {
    if (!clientId || !touchpointId) return
    const ok = confirm('Archive this touchpoint? It will be hidden from the default list.')
    if (!ok) return
    setActing(true); setError('')
    try {
      await api.post(`/client/${clientId}/touchpoints/${touchpointId}/archive`)
      router.push('/touchpoints')
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not archive.'))
    } finally { setActing(false) }
  }

  async function onRemoveAssignment(aid: string) {
    if (!clientId || !touchpointId) return
    const ok = confirm('Remove this trigger? Already-fired recipients keep their messages.')
    if (!ok) return
    setActing(true); setError('')
    try {
      await api.delete(`/client/${clientId}/touchpoints/${touchpointId}/assignments/${aid}`)
      load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not remove trigger.'))
    } finally { setActing(false) }
  }

  async function onAssignmentToggle(a: Assignment) {
    if (!clientId || !touchpointId) return
    setActing(true); setError('')
    try {
      const verb = a.status === 'ACTIVE' ? 'pause' : 'resume'
      await api.post(`/client/${clientId}/touchpoints/${touchpointId}/assignments/${a.id}/${verb}`)
      load()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not update trigger.'))
    } finally { setActing(false) }
  }

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-sm text-slate-500">Loading…</div>
  if (error && !detail) return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/touchpoints" className="text-sm text-slate-500 hover:text-slate-900">← Touchpoints</Link>
      <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">{error}</div>
    </div>
  )
  if (!detail || !analytics) return null

  const t = detail.touchpoint
  const chip = STATUS_CHIP[t.status]
  const total = analytics.delivery.recipient_count
  const hasResponses = t.content_type !== 'ANNOUNCEMENT'
  const respTotal = responses?.total ?? 0
  const respPages = respTotal > 0 ? Math.max(1, Math.ceil(respTotal / PAGE_SIZE)) : 1

  const exportHref = clientId
    ? `/client/${clientId}/touchpoints/${touchpointId}/export.csv`
    : ''

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <Link href="/touchpoints" className="text-sm text-slate-500 hover:text-slate-900">← Touchpoints</Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {TYPE_LABEL[t.content_type]} · Expires {t.per_firing_expiry_days} {t.per_firing_expiry_days === 1 ? 'day' : 'days'} after firing
            {t.activated_at ? ` · Activated ${fmtDateTime(t.activated_at)}` : ''}
          </p>
          {t.content_locked_at && (
            <p className="text-xs text-amber-700 mt-1">
              Content locked at {fmtDateTime(t.content_locked_at)} — a recipient has opened it.
              Duplicate the touchpoint to change the text.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${chip.cls}`}>{chip.label}</span>
          {hasResponses && respTotal > 0 && (
            <ExportCsvButton
              href={exportHref}
              fallbackFilename={`${t.name.slice(0, 30).replace(/\s+/g, '-')}.csv`}
            />
          )}
          {(t.status === 'DRAFT' || t.status === 'PAUSED') && (
            <>
              <Link
                href={`/touchpoints/new?draftId=${t.id}`}
                className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                Edit
              </Link>
              <button
                onClick={onActivate} disabled={acting}
                className="text-xs px-3 py-1.5 border border-emerald-200 rounded-lg text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >Activate</button>
            </>
          )}
          {t.status === 'ACTIVE' && (
            <button
              onClick={onPause} disabled={acting}
              className="text-xs px-3 py-1.5 border border-amber-200 rounded-lg text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >Pause</button>
          )}
          {(t.status === 'DRAFT' || t.status === 'PAUSED') && (
            <button
              onClick={onArchive} disabled={acting}
              className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >Archive</button>
          )}
        </div>
      </header>

      {error && detail && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}

      {/* Delivery summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Fired" value={total} />
        <StatCard label="Pushed" value={analytics.delivery.pushed} caption={pct(analytics.delivery.pushed, total)} />
        <StatCard label="Opened" value={analytics.delivery.opened} caption={pct(analytics.delivery.opened, total)} />
        <StatCard
          label="Responded"
          value={t.content_type === 'ANNOUNCEMENT' ? '—' : analytics.delivery.responded}
          caption={t.content_type === 'ANNOUNCEMENT' ? 'not collected' : pct(analytics.delivery.responded, total)}
        />
      </section>

      {/* Content preview */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Message content</p>
        {t.title ? (
          <h2 className="text-lg font-semibold text-slate-900">{t.title}</h2>
        ) : (
          <p className="text-sm italic text-slate-400">No title yet</p>
        )}
        {t.body ? (
          <p className="text-sm text-slate-700 whitespace-pre-wrap mt-3">{t.body}</p>
        ) : (
          <p className="text-sm italic text-slate-400 mt-3">No body yet</p>
        )}
        {detail.attachments.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-slate-400">Attachments</p>
            {detail.attachments.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400">{a.kind}</span>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline truncate">{a.original_filename}</a>
                ) : (
                  <span className="text-slate-400">{a.original_filename}</span>
                )}
                <span className="text-slate-400">· {Math.round(a.size_bytes / 1024)} KB</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Triggers */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Triggers</p>
            <p className="text-sm text-slate-700 mt-1">
              When a farmer reaches any of these milestones, this touchpoint fires.
            </p>
          </div>
          <p className="text-xs text-slate-500">{detail.assignments.length} total</p>
        </div>
        {detail.assignments.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            No triggers yet. Add at least one Crop · Package · Timeline · Beginning/End combination before activating.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {detail.assignments.map(a => (
              <div key={a.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {a.crop_name || a.crop_cosh_id} · {a.package_name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {a.fire_at === 'BEGINNING' ? 'Beginning' : 'End'} of {a.timeline_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    a.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                  }`}>
                    {a.status === 'ACTIVE' ? 'Active' : 'Paused'}
                  </span>
                  <button
                    onClick={() => onAssignmentToggle(a)} disabled={acting}
                    className="text-xs px-2 py-1 border border-slate-200 rounded text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {a.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => onRemoveAssignment(a.id)} disabled={acting}
                    className="text-xs px-2 py-1 border border-rose-200 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Interest-capture tally */}
      {analytics.interest_capture && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Interest Capture</p>
          <div className="grid grid-cols-3 gap-4">
            {(['YES', 'NO', 'MAYBE'] as const).map(k => {
              const n = analytics.interest_capture![k] ?? 0
              const totalCount = Object.values(analytics.interest_capture!).reduce((a, b) => a + b, 0)
              return (
                <div key={k} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{k === 'YES' ? 'Yes' : k === 'NO' ? 'No' : 'Maybe'}</p>
                  <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">{n}</p>
                  <p className="text-xs text-slate-400 mt-1">{pct(n, totalCount)}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Feedback histogram */}
      {analytics.feedback_rating_histogram && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Feedback ratings</p>
          {(() => {
            const h = analytics.feedback_rating_histogram!
            const scale = t.rating_scale_type === 'NPS_10' ? 10 : 5
            const totalR = Object.values(h).reduce((a, b) => a + b, 0)
            let sum = 0, count = 0
            for (const [k, v] of Object.entries(h)) {
              const n = Number(k); if (Number.isFinite(n) && n > 0) { sum += n * v; count += v }
            }
            const avg = count > 0 ? sum / count : 0
            const max = Math.max(1, ...Object.values(h))
            return (
              <div>
                <p className="text-2xl font-bold text-slate-900">{avg.toFixed(1)} <span className="text-base text-slate-400 font-normal">of {scale}</span></p>
                <p className="text-xs text-slate-500">{totalR} response{totalR === 1 ? '' : 's'}</p>
                <div className="mt-4 space-y-2">
                  {Array.from({ length: scale }, (_, i) => scale - i).map(star => {
                    const n = h[String(star)] ?? 0
                    const width = max > 0 ? Math.round((n / max) * 100) : 0
                    return (
                      <div key={star} className="flex items-center gap-3 text-xs">
                        <span className="w-10 text-slate-600 tabular-nums">{star}★</span>
                        <div className="flex-1 bg-slate-100 rounded h-3 overflow-hidden">
                          <div className="h-full bg-amber-400" style={{ width: `${width}%` }} />
                        </div>
                        <span className="w-16 text-right tabular-nums text-slate-700">{n} <span className="text-slate-400">· {pct(n, totalR)}</span></span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </section>
      )}

      {/* Per-question aggregates */}
      {analytics.questions.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Question responses</p>
          <div className="space-y-5">
            {analytics.questions.map(q => (
              <div key={q.question_id} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-slate-800">{q.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{q.question_type} · {q.response_count} response{q.response_count === 1 ? '' : 's'}</p>
                {q.choice_tally && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(q.choice_tally).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="min-w-[8rem] text-slate-600">{k}</span>
                        <div className="flex-1 bg-slate-100 rounded h-2 overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${q.response_count > 0 ? Math.round((v / q.response_count) * 100) : 0}%` }} />
                        </div>
                        <span className="w-12 text-right tabular-nums text-slate-700">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                {q.yes_no && (
                  <div className="mt-2 flex gap-4 text-xs text-slate-700">
                    <span>Yes: <strong>{q.yes_no.YES}</strong></span>
                    <span>No: <strong>{q.yes_no.NO}</strong></span>
                  </div>
                )}
                {q.stats && (
                  <div className="mt-2 flex gap-4 text-xs text-slate-700">
                    <span>Mean: <strong>{q.stats.mean.toFixed(1)}</strong></span>
                    <span>Min: {q.stats.min}</span>
                    <span>Max: {q.stats.max}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Individual responses */}
      {hasResponses && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Individual responses</p>
              <p className="text-sm text-slate-700 mt-1">
                {respLoading ? 'Loading…' : respTotal === 0 ? 'No responses yet.' : `${respTotal} response${respTotal === 1 ? '' : 's'}`}
              </p>
            </div>
            {respTotal > PAGE_SIZE && (
              <div className="flex items-center gap-2">
                <button
                  disabled={respPage <= 1 || respLoading}
                  onClick={() => setRespPage(p => Math.max(1, p - 1))}
                  className="text-xs px-3 py-1.5 border border-slate-200 rounded-md disabled:opacity-40"
                >← Prev</button>
                <span className="text-xs text-slate-500 tabular-nums">Page {respPage} of {respPages}</span>
                <button
                  disabled={respPage >= respPages || respLoading}
                  onClick={() => setRespPage(p => Math.min(respPages, p + 1))}
                  className="text-xs px-3 py-1.5 border border-slate-200 rounded-md disabled:opacity-40"
                >Next →</button>
              </div>
            )}
          </div>
          {responses && responses.rows.length > 0 && (
            <div className="divide-y divide-slate-100">
              {responses.rows.map(r => {
                const isOpen = expanded.has(r.response_id)
                const summary = (() => {
                  if (t.content_type === 'INTEREST_CAPTURE' && r.interest_answer) return r.interest_answer
                  if (t.content_type === 'FEEDBACK' && r.rating !== null) return `${r.rating}★`
                  if (r.answers.length > 0) return r.answers.map(a => `${a.question_label.slice(0, 20)}: ${a.display_value.slice(0, 40)}`).join(' · ').slice(0, 120)
                  return '—'
                })()
                const triggerLabel = r.timeline_name
                  ? `${r.fire_at === 'BEGINNING' ? 'Beginning' : 'End'} of ${r.timeline_name}`
                  : ''
                return (
                  <div key={r.response_id} className="py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(r.response_id)}
                      className="w-full text-left flex flex-wrap items-baseline gap-x-4 gap-y-1 hover:bg-slate-50 -mx-2 px-2 py-1 rounded"
                    >
                      <span className="w-32 shrink-0 text-xs text-slate-400 tabular-nums">{fmtDateTime(r.submitted_at)}</span>
                      <span className="font-medium text-slate-800 text-sm min-w-[8rem]">{r.recipient_name || '—'}</span>
                      <span className="text-xs text-slate-500">{r.recipient_phone_masked}</span>
                      <span className="text-xs text-slate-500">· {r.recipient_district || '—'}</span>
                      {triggerLabel && (
                        <span className="text-xs text-slate-400">· {triggerLabel}</span>
                      )}
                      <span className="ml-auto text-xs text-slate-600 truncate max-w-[22rem]">{summary}</span>
                    </button>
                    {isOpen && (
                      <div className="mt-2 ml-32 pl-4 border-l-2 border-slate-100 text-xs text-slate-700 space-y-1">
                        {t.content_type === 'INTEREST_CAPTURE' && r.interest_answer && (
                          <p><span className="text-slate-500">Interest:</span> <strong>{r.interest_answer}</strong></p>
                        )}
                        {t.content_type === 'FEEDBACK' && r.rating !== null && (
                          <p><span className="text-slate-500">Rating:</span> <strong>{r.rating} stars</strong></p>
                        )}
                        {r.answers.map(a => (
                          <p key={a.question_id}>
                            <span className="text-slate-500">{a.question_label}:</span>{' '}
                            <strong>{a.display_value || '—'}</strong>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Questions reference */}
      {detail.questions.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">
            {t.content_type === 'FEEDBACK' ? 'Follow-up questions' : 'Survey questions'}
          </p>
          <ol className="space-y-3 text-sm">
            {detail.questions.map((q, i) => (
              <li key={q.id}>
                <p className="font-medium text-slate-800">
                  {i + 1}. {q.label}
                  {q.is_mandatory && <span className="text-rose-500 ml-1">*</span>}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {q.question_type}
                  {q.choice_options && ` · ${q.choice_options.length} options`}
                  {q.number_unit && ` · unit: ${q.number_unit}`}
                </p>
                {q.help_text && (
                  <p className="text-xs text-slate-500 italic mt-0.5">{q.help_text}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function StatCard({ label, value, caption }: {
  label: string
  value: number | string
  caption?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-3xl font-bold text-slate-900 tabular-nums mt-1">{value}</p>
      {caption && <p className="text-xs text-slate-400 mt-1">{caption}</p>}
    </div>
  )
}
