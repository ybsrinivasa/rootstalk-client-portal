'use client'

// Client Reports — Subscriptions drill (Phase 1, vertical slice).
//
// The only backend metric wired today is ACTIVE
// (GET /client/{cid}/reports/subscriptions?metric=ACTIVE). Renders
// the number in client.primary_colour so managers see "their own"
// number, not a generic chart palette.
//
// NEW, TOTAL, and every dimension drill land as backend fills in
// queries.py; add tabs / cards to this page then. Keep the current
// page honest: nothing on screen we can't back with real data.

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

interface SubsActiveResponse {
  subscriptions: number
  farmers: number
}

export default function SubscriptionsReportPage() {
  const client = getClient()
  const clientId = client?.id
  const accent = client?.primary_colour || '#1A5C2A'

  const [data, setData] = useState<SubsActiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    setLoading(true); setError('')
    api
      .get<SubsActiveResponse>(
        `/client/${clientId}/reports/subscriptions?metric=ACTIVE`,
      )
      .then(({ data }) => setData(data))
      .catch((err) =>
        setError(
          extractErrorMessage(err, 'Could not load subscriptions report.'),
        ),
      )
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Reports
        </p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">
          Subscriptions
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          A snapshot of your subscription base. Training-session subscriptions
          and cleaned-up entries are excluded automatically.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
        <p className="text-sm font-medium text-slate-500">Active Subscriptions</p>
        {loading ? (
          <p className="mt-3 text-4xl font-bold text-slate-300">…</p>
        ) : data ? (
          <>
            <p
              className="mt-3 text-5xl font-bold tabular-nums"
              style={{ color: accent }}
            >
              {data.subscriptions.toLocaleString()}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {data.farmers.toLocaleString()}{' '}
              {data.farmers === 1 ? 'farmer' : 'farmers'}
            </p>
          </>
        ) : null}
      </div>

      <p className="text-xs text-slate-400">
        More metrics — New and Total subscriptions, trends over time, drills
        by crop, district, and package — arrive in the next few builds.
      </p>
    </div>
  )
}
