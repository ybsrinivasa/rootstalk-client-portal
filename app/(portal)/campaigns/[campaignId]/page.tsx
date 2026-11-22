'use client'

// Campaign detail — delivery summary + status + content preview +
// per-question aggregates + individual-response drill-down + CSV
// export (CA-only).

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ExportCsvButton } from '@/components/reports/export-button'

interface Campaign {
  id: string
  name: string
  campaign_type: 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
  recipient_role: 'FARMER' | 'DEALER' | 'FACILITATOR'
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'ARCHIVED'
  title: string
  body: string
  rating_scale_type: string | null
  sent_at: string | null
  expires_at: string | null
  recipient_count: number | null
  pushed_count: number
  opened_count: number
  responded_count: number
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
  campaign: Campaign
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

const TYPE_LABEL: Record<Campaign['campaign_type'], string> = {
  ANNOUNCEMENT: 'Announcement',
  INTEREST_CAPTURE: 'Interest Capture',
  FEEDBACK: 'Feedback',
  SURVEY: 'Survey',
}
const ROLE_LABEL: Record<Campaign['recipient_role'], string> = {
  FARMER: 'Farmers',
  DEALER: 'Dealers',
  FACILITATOR: 'Facilitators',
}
const STATUS_CHIP: Record<Campaign['status'], { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-700' },
  SCHEDULED: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-800' },
  ACTIVE:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700' },
  EXPIRED:   { label: 'Expired',   cls: 'bg-slate-100 text-slate-500' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-rose-100 text-rose-700' },
  ARCHIVED:  { label: 'Archived',  cls: 'bg-slate-100 text-slate-400' },
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

export default function CampaignDetailPage() {
  const params = useParams()
  const router = useRouter()
  const campaignId = params?.campaignId as string | undefined
  const client = getClient()
  const clientId = client?.id

  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)

  const [responses, setResponses] = useState<ResponsesPayload | null>(null)
  const [respPage, setRespPage] = useState(1)
  const [respLoading, setRespLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadAnalytics = useCallback(() => {
    if (!clientId || !campaignId) return
    setLoading(true); setError('')
    api.get<AnalyticsPayload>(
      `/client/${clientId}/messaging/campaigns/${campaignId}/analytics`,
    )
      .then(({ data }) => setData(data))
      .catch(err => setError(extractErrorMessage(err, 'Could not load campaign.')))
      .finally(() => setLoading(false))
  }, [clientId, campaignId])

  const loadResponses = useCallback(() => {
    if (!clientId || !campaignId) return
    setRespLoading(true)
    api.get<ResponsesPayload>(
      `/client/${clientId}/messaging/campaigns/${campaignId}/responses?page=${respPage}&page_size=${PAGE_SIZE}`,
    )
      .then(({ data }) => setResponses(data))
      .catch(() => { /* silent */ })
      .finally(() => setRespLoading(false))
  }, [clientId, campaignId, respPage])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])
  useEffect(() => {
    // Only fetch responses for types that collect them.
    if (!data) return
    if (data.campaign.campaign_type === 'ANNOUNCEMENT') return
    loadResponses()
  }, [data, loadResponses])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onCancel() {
    if (!clientId || !campaignId) return
    const ok = confirm('Cancel this scheduled campaign? It will not be sent.')
    if (!ok) return
    setActing(true)
    try {
      await api.post(`/client/${clientId}/messaging/campaigns/${campaignId}/cancel`)
      loadAnalytics()
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not cancel.'))
    } finally { setActing(false) }
  }

  async function onArchive() {
    if (!clientId || !campaignId) return
    const ok = confirm('Archive this campaign? Analytics stay visible; it is removed from the default list.')
    if (!ok) return
    setActing(true)
    try {
      await api.post(`/client/${clientId}/messaging/campaigns/${campaignId}/archive`)
      router.push('/campaigns')
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not archive.'))
    } finally { setActing(false) }
  }

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-sm text-slate-500">Loading…</div>
  if (error) return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/campaigns" className="text-sm text-slate-500 hover:text-slate-900">← Campaigns</Link>
      <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">{error}</div>
    </div>
  )
  if (!data) return null

  const c = data.campaign
  const chip = STATUS_CHIP[c.status]
  const total = data.delivery.recipient_count
  const hasResponses = c.campaign_type !== 'ANNOUNCEMENT'
  const respTotal = responses?.total ?? 0
  const respPages = respTotal > 0 ? Math.max(1, Math.ceil(respTotal / PAGE_SIZE)) : 1

  const exportHref = clientId
    ? `/client/${clientId}/messaging/campaigns/${campaignId}/export.csv`
    : ''

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <Link href="/campaigns" className="text-sm text-slate-500 hover:text-slate-900">← Campaigns</Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{c.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {TYPE_LABEL[c.campaign_type]} · to {ROLE_LABEL[c.recipient_role]} ·
            Sent {fmtDateTime(c.sent_at)} · Expires {fmtDateTime(c.expires_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${chip.cls}`}>{chip.label}</span>
          {hasResponses && respTotal > 0 && (
            <ExportCsvButton
              href={exportHref}
              fallbackFilename={`${c.name.slice(0, 30).replace(/\s+/g, '-')}.csv`}
            />
          )}
          {c.status === 'SCHEDULED' && (
            <button
              onClick={onCancel} disabled={acting}
              className="text-xs px-3 py-1.5 border border-rose-200 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >Cancel</button>
          )}
          {(c.status === 'EXPIRED' || c.status === 'CANCELLED') && (
            <button
              onClick={onArchive} disabled={acting}
              className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >Archive</button>
          )}
        </div>
      </header>

      {/* Delivery summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Recipients" value={total} />
        <StatCard label="Pushed" value={data.delivery.pushed} caption={pct(data.delivery.pushed, total)} />
        <StatCard label="Opened" value={data.delivery.opened} caption={pct(data.delivery.opened, total)} />
        <StatCard
          label="Responded"
          value={c.campaign_type === 'ANNOUNCEMENT' ? '—' : data.delivery.responded}
          caption={c.campaign_type === 'ANNOUNCEMENT' ? 'not collected' : pct(data.delivery.responded, total)}
        />
      </section>

      {/* Content preview */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Message content</p>
        <h2 className="text-lg font-semibold text-slate-900">{c.title}</h2>
        <p className="text-sm text-slate-700 whitespace-pre-wrap mt-3">{c.body}</p>
      </section>

      {/* Interest capture tally */}
      {data.interest_capture && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Interest Capture</p>
          <div className="grid grid-cols-3 gap-4">
            {(['YES', 'NO', 'MAYBE'] as const).map(k => {
              const n = data.interest_capture![k] ?? 0
              const totalCount = Object.values(data.interest_capture!).reduce((a, b) => a + b, 0)
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

      {/* Feedback histogram (bars) */}
      {data.feedback_rating_histogram && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Feedback ratings</p>
          {(() => {
            const h = data.feedback_rating_histogram!
            const scale = c.rating_scale_type === 'NPS_10' ? 10 : 5
            const total = Object.values(h).reduce((a, b) => a + b, 0)
            let sum = 0, count = 0
            for (const [k, v] of Object.entries(h)) {
              const n = Number(k); if (Number.isFinite(n) && n > 0) { sum += n * v; count += v }
            }
            const avg = count > 0 ? sum / count : 0
            const max = Math.max(1, ...Object.values(h))
            return (
              <div>
                <p className="text-2xl font-bold text-slate-900">{avg.toFixed(1)} <span className="text-base text-slate-400 font-normal">of {scale}</span></p>
                <p className="text-xs text-slate-500">{total} response{total === 1 ? '' : 's'}</p>
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
                        <span className="w-16 text-right tabular-nums text-slate-700">{n} <span className="text-slate-400">· {pct(n, total)}</span></span>
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
      {data.questions.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Question responses</p>
          <div className="space-y-5">
            {data.questions.map(q => (
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

      {/* Individual responses drill-down */}
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
                  if (c.campaign_type === 'INTEREST_CAPTURE' && r.interest_answer) return r.interest_answer
                  if (c.campaign_type === 'FEEDBACK' && r.rating !== null) return `${r.rating}★`
                  if (r.answers.length > 0) return r.answers.map(a => `${a.question_label.slice(0, 20)}: ${a.display_value.slice(0, 40)}`).join(' · ').slice(0, 120)
                  return '—'
                })()
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
                      <span className="ml-auto text-xs text-slate-600 truncate max-w-[22rem]">{summary}</span>
                    </button>
                    {isOpen && (
                      <div className="mt-2 ml-32 pl-4 border-l-2 border-slate-100 text-xs text-slate-700 space-y-1">
                        {c.campaign_type === 'INTEREST_CAPTURE' && r.interest_answer && (
                          <p><span className="text-slate-500">Interest:</span> <strong>{r.interest_answer}</strong></p>
                        )}
                        {c.campaign_type === 'FEEDBACK' && r.rating !== null && (
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
