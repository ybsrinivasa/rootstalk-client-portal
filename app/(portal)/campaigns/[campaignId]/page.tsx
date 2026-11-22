'use client'

// Campaign detail — delivery summary + status + content preview +
// per-question aggregates. Phase 2C-M1 ships the summary; the
// individual-response drill-down and CSV export come in Phase 2D.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

interface Campaign {
  id: string
  name: string
  campaign_type: 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
  recipient_role: 'FARMER' | 'DEALER' | 'FACILITATOR'
  status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'ARCHIVED'
  title: string
  body: string
  sent_at: string | null
  expires_at: string | null
  recipient_count: number | null
  pushed_count: number
  opened_count: number
  responded_count: number
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
  questions: unknown[]
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

  const load = useCallback(() => {
    if (!clientId || !campaignId) return
    setLoading(true); setError('')
    api.get<AnalyticsPayload>(
      `/client/${clientId}/messaging/campaigns/${campaignId}/analytics`,
    )
      .then(({ data }) => setData(data))
      .catch(err => setError(extractErrorMessage(err, 'Could not load campaign.')))
      .finally(() => setLoading(false))
  }, [clientId, campaignId])

  useEffect(() => { load() }, [load])

  async function onCancel() {
    if (!clientId || !campaignId) return
    const ok = confirm('Cancel this scheduled campaign? It will not be sent.')
    if (!ok) return
    setActing(true)
    try {
      await api.post(`/client/${clientId}/messaging/campaigns/${campaignId}/cancel`)
      load()
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <Link href="/campaigns" className="text-sm text-slate-500 hover:text-slate-900">← Campaigns</Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{c.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {TYPE_LABEL[c.campaign_type]} · to {ROLE_LABEL[c.recipient_role]} ·
            Sent {fmtDateTime(c.sent_at)} · Expires {fmtDateTime(c.expires_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${chip.cls}`}>{chip.label}</span>
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
            {(['YES', 'NO', 'MAYBE'] as const).map(k => (
              <div key={k}>
                <p className="text-xs text-slate-500">{k}</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {data.interest_capture![k] ?? 0}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Feedback histogram */}
      {data.feedback_rating_histogram && (
        <section className="bg-white border border-slate-200 rounded-2xl p-6">
          <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">Feedback ratings</p>
          <pre className="text-xs text-slate-700 overflow-x-auto">
            {JSON.stringify(data.feedback_rating_histogram, null, 2)}
          </pre>
        </section>
      )}

      <p className="text-xs text-slate-400 italic">
        Individual response drill-down and CSV export ship in a later update.
      </p>
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
