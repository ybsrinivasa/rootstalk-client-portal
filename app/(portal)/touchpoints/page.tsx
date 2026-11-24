'use client'

// Touchpoints list — top-level view under the CAMPAIGNS nav group.
// Unlike Campaigns, Touchpoints don't ship on a date — they fire on
// subscription milestones (Beginning / End of a Timeline). The list
// surfaces each Touchpoint's assignment count + lifetime fire count
// so a CA / RM can see at a glance which triggers are live and which
// are still drafts.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

interface Touchpoint {
  id: string
  name: string
  content_type: 'ANNOUNCEMENT' | 'INTEREST_CAPTURE' | 'FEEDBACK' | 'SURVEY'
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'
  title: string
  per_firing_expiry_days: number
  activated_at: string | null
  assignment_count: number
  total_fires: number
  created_at: string
}

const STATUS_CHIP: Record<Touchpoint['status'], { label: string; cls: string }> = {
  DRAFT:    { label: 'Draft',    cls: 'bg-slate-100 text-slate-700' },
  ACTIVE:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700' },
  PAUSED:   { label: 'Paused',   cls: 'bg-amber-100 text-amber-800' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-400' },
}

const TYPE_LABEL: Record<Touchpoint['content_type'], string> = {
  ANNOUNCEMENT: 'Announcement',
  INTEREST_CAPTURE: 'Interest Capture',
  FEEDBACK: 'Feedback',
  SURVEY: 'Survey',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TouchpointsListPage() {
  const client = getClient()
  const clientId = client?.id
  const [showArchived, setShowArchived] = useState(false)
  const [rows, setRows] = useState<Touchpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!clientId) return
    setLoading(true); setError('')
    const qs = showArchived ? '?include_archived=true' : ''
    api.get<{ touchpoints: Touchpoint[] }>(`/client/${clientId}/touchpoints${qs}`)
      .then(({ data }) => setRows(data.touchpoints))
      .catch(err => setError(extractErrorMessage(err, 'Could not load touchpoints.')))
      .finally(() => setLoading(false))
  }, [clientId, showArchived])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Touchpoints</h1>
          <p className="text-sm text-slate-500 mt-1">
            Messages, surveys and feedback that fire automatically when a
            farmer reaches a milestone in your Package of Practices (the
            beginning or end of a specific Timeline).
          </p>
        </div>
        <Link
          href="/touchpoints/new"
          className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
        >
          + New Touchpoint
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
          <p className="text-slate-600">No touchpoints yet.</p>
          <Link
            href="/touchpoints/new"
            className="inline-block mt-3 text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
          >
            Create your first touchpoint
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Name</th>
                <th className="text-left px-5 py-3 font-semibold">Type</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-left px-5 py-3 font-semibold">Activated</th>
                <th className="text-left px-5 py-3 font-semibold">Triggers</th>
                <th className="text-left px-5 py-3 font-semibold">Total fires</th>
                <th className="text-left px-5 py-3 font-semibold">Expires in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(t => {
                const chip = STATUS_CHIP[t.status]
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/touchpoints/${t.id}`} className="font-medium text-slate-900 hover:underline">
                        {t.name}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[20rem]">{t.title}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-600">
                      {TYPE_LABEL[t.content_type]}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${chip.cls}`}>
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmtDate(t.activated_at)}</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-700">
                      {t.assignment_count}
                    </td>
                    <td className="px-5 py-3 text-xs tabular-nums text-slate-700">
                      {t.total_fires}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {t.per_firing_expiry_days} {t.per_firing_expiry_days === 1 ? 'day' : 'days'} / firing
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
