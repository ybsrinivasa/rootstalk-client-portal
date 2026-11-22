'use client'

// Campaigns list — top-level view under the CAMPAIGNS nav section.
// Shows every campaign with status chip + headline counters + actions.
// Archived hidden by default per spec §3.10.

import { useCallback, useEffect, useState } from 'react'
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
  sent_at: string | null
  expires_at: string | null
  recipient_count: number | null
  pushed_count: number
  opened_count: number
  responded_count: number
  created_at: string
}

const STATUS_CHIP: Record<Campaign['status'], { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-700' },
  SCHEDULED: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-800' },
  ACTIVE:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700' },
  EXPIRED:   { label: 'Expired',   cls: 'bg-slate-100 text-slate-500' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-rose-100 text-rose-700' },
  ARCHIVED:  { label: 'Archived',  cls: 'bg-slate-100 text-slate-400' },
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

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function pct(n: number, d: number | null): string {
  if (!d || d <= 0) return '—'
  return `${Math.round((n / d) * 100)}%`
}

export default function CampaignsListPage() {
  const client = getClient()
  const clientId = client?.id
  const [showArchived, setShowArchived] = useState(false)
  const [rows, setRows] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!clientId) return
    setLoading(true); setError('')
    const qs = showArchived ? '?include_archived=true' : ''
    api.get<{ campaigns: Campaign[] }>(`/client/${clientId}/messaging/campaigns${qs}`)
      .then(({ data }) => setRows(data.campaigns))
      .catch(err => setError(extractErrorMessage(err, 'Could not load campaigns.')))
      .finally(() => setLoading(false))
  }, [clientId, showArchived])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500 mt-1">
            Broadcasts, surveys, feedback and interest-capture flows to your
            farmers, dealers and facilitators.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
        >
          + New Campaign
        </Link>
      </header>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="text-xs text-slate-400">{loading ? 'Loading…' : `${rows.length} total`}</span>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {!loading && rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <p className="text-slate-600">No campaigns yet.</p>
          <Link
            href="/campaigns/new"
            className="inline-block mt-3 text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Create your first campaign
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Name</th>
                <th className="text-left px-5 py-3 font-semibold">Type · Audience</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-left px-5 py-3 font-semibold">Sent</th>
                <th className="text-left px-5 py-3 font-semibold">Expires</th>
                <th className="text-left px-5 py-3 font-semibold">Recipients</th>
                <th className="text-left px-5 py-3 font-semibold">Opened</th>
                <th className="text-left px-5 py-3 font-semibold">Responded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(c => {
                const chip = STATUS_CHIP[c.status]
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-slate-900 hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[20rem]">{c.title}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {TYPE_LABEL[c.campaign_type]}
                      <br />
                      <span className="text-slate-400">to {ROLE_LABEL[c.recipient_role]}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${chip.cls}`}>
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(c.sent_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(c.expires_at)}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-700">{c.recipient_count ?? '—'}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-700">
                      {c.opened_count} <span className="text-slate-400">{pct(c.opened_count, c.recipient_count)}</span>
                    </td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-700">
                      {c.campaign_type === 'ANNOUNCEMENT' ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <>
                          {c.responded_count} <span className="text-slate-400">{pct(c.responded_count, c.recipient_count)}</span>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
