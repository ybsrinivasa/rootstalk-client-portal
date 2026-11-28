'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Package {
  id: string; name: string; crop_cosh_id: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'; version: number; created_at: string
}
interface PoolBalance {
  balance: number
  unlimited?: boolean
  enterprise_to_date?: string | null
}
// 2026-11-28 — Dashboard summary endpoint added on the same day.
// Replaces the earlier pattern of calling /packages + a non-existent
// /alerts and computing tile counts in the browser (which had a
// nasty slice(0,6) bug — see git log for context).
interface DashboardSummary {
  packages: { total: number; active: number }
  active_farmers: number
  alerts: {
    total: number
    by_type: {
      pending_start_dates: number
      overdue_inputs: number
      missed_inputs: number
      overdue_expert_queries: number
      no_active_subscription: number
    }
  }
}

const STATUS_COLOUR = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-stone-100 text-stone-500',
}

const PAYMENT_MODEL_LABEL: Record<'COMPANY_PAYS' | 'FARMER_PAYS', { title: string; help: string }> = {
  COMPANY_PAYS: {
    title: 'Company Pays',
    help: 'Farmers cannot self-subscribe. Only company-designated promoters can assign packages.',
  },
  FARMER_PAYS: {
    title: 'Farmer Pays',
    help: 'Farmers self-subscribe and pay directly. Company can also assign via promoters.',
  },
}

export default function DashboardPage() {
  const client = getClient()
  const clientId = client?.id
  const clientName = client?.display_name
  const accent = client?.primary_colour || '#1A5C2A'
  const paymentModel = client?.payment_model
  const paymentLabel = paymentModel ? PAYMENT_MODEL_LABEL[paymentModel] : null

  const [packages, setPackages] = useState<Package[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  const [unlimited, setUnlimited] = useState(false)
  const [enterpriseToDate, setEnterpriseToDate] = useState<string | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  // Crop friendly-name lookup so the Recent Packages row shows
  // "Tomato" instead of the raw Cosh UUID.
  const [cropNameByCoshId, setCropNameByCoshId] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!clientId) return
    // Dashboard tiles are the UNION of summary + pool + packages-list
    // + crops. Non-advisory roles (CLIENT_RM / FIELD_MANAGER / etc.)
    // legitimately can't view /packages — the X-Tolerate-Forbidden
    // header opts out of the api.ts /access-denied redirect so the
    // local .catch() renders an empty tile instead.
    const tolerant = { headers: { 'X-Tolerate-Forbidden': '1' } }
    Promise.all([
      // 2026-11-28 — Server-side summary. Replaces the earlier
      // client-side slice(0,6).length miscount pattern.
      api.get<DashboardSummary>(`/client/${clientId}/dashboard-summary`, tolerant).catch(() => null),
      api.get<PoolBalance>(`/client/${clientId}/subscription-pool/balance`, tolerant).catch(() => ({ data: { balance: 0 } as PoolBalance })),
      // Full packages list (for the Recent Packages table ONLY — the
      // count tiles now read from summary, so the slice below is the
      // only consumer).
      api.get<Package[]>(`/client/${clientId}/packages`, tolerant).catch(() => ({ data: [] as Package[] })),
      api.get<{ crop_cosh_id: string; crop_name_en?: string | null }[]>(`/client/${clientId}/crops`).catch(() => ({ data: [] })),
    ]).then(([summaryRes, poolRes, pkgRes, cropRes]) => {
      if (summaryRes && 'data' in summaryRes) setSummary(summaryRes.data)
      setBalance(poolRes.data.balance)
      setUnlimited(!!poolRes.data.unlimited)
      setEnterpriseToDate(poolRes.data.enterprise_to_date ?? null)
      // Most-recent packages for the table. Backend returns ordered
      // by created_at asc; we want the latest 6 → slice from the
      // tail and reverse so newest is at top.
      const latest = pkgRes.data.slice(-6).reverse()
      setPackages(latest)
      const m: Record<string, string> = {}
      for (const c of cropRes.data) if (c.crop_name_en) m[c.crop_cosh_id] = c.crop_name_en
      setCropNameByCoshId(m)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [clientId])

  const poolValue: React.ReactNode = unlimited
    ? 'Unlimited'
    : balance === null
      ? '…'
      : balance
  const poolHint: string | null = unlimited && enterpriseToDate
    ? `Closes ${new Date(enterpriseToDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}`
    : (unlimited ? null : 'Capacity left on your licence')
  // 2026-11-28 — Two-row grid: top row is state-of-the-business
  // (counts that describe your client right now), bottom row is
  // what-needs-attention (alert counts, each click-through to the
  // Farmer Support drill-down). Deliberately not adding every alert
  // type — Missed Inputs accumulates over time and No-Active-
  // Subscription is proactive outreach, both less "today" signal
  // than the three picked here. Keeps dashboard-vs-Reports distinct.
  //
  // Icons are inline SVG (heroicons-style, stroke=1.5) — matches
  // the hand-written SVG convention used elsewhere in the CP. No
  // icon-library dependency. Each icon is a 20×20 element positioned
  // absolutely in the tile's top-right corner.
  const stats: Array<{ label: string; value: React.ReactNode; href: string; hint?: string | null; title?: string; icon: React.ReactNode }> = [
    {
      label: 'Total Packages', href: '/advisory',
      value: summary ? summary.packages.total : '…',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-9-5.25-9 5.25 9 5.25 9-5.25z M2.25 7.5v9l9 5.25 9-5.25v-9 M11.25 12.75v9" />
        </svg>
      ),
    },
    {
      label: 'Active Packages', href: '/advisory',
      value: summary ? summary.packages.active : '…',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75 M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Active Farmers', href: '/farmer-support',
      value: summary ? summary.active_farmers : '…',
      hint: 'Farmers with a current crop',
      title: 'Distinct farmers with at least one ACTIVE subscription that has a crop_start_date set.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label: 'Subscriptions Available', href: '/subscription',
      value: poolValue, hint: poolHint,
      title: 'Capacity left on your licence — how many more farmers you can take on without buying more subscription units.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
      ),
    },
    {
      label: 'Awaiting Start Date', href: '/farmer-support?alert=AWAITING_START_DATE',
      value: summary ? summary.alerts.by_type.pending_start_dates : '…',
      hint: 'Subscribed, crop not started yet',
      title: 'Farmers who have an ACTIVE subscription but no crop_start_date on file. Usually need a nudge from the promoter.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Overdue Inputs', href: '/farmer-support?alert=OVERDUE_INPUT',
      value: summary ? summary.alerts.by_type.overdue_inputs : '…',
      hint: 'Due today, no order placed',
      title: 'Farmers who have an INPUT practice due today for which no order has been placed yet.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      label: 'Open Expert Queries', href: '/farmer-support?alert=OVERDUE_EXPERT_QUERY',
      value: summary ? summary.alerts.by_type.overdue_expert_queries : '…',
      hint: 'Past the client SLA',
      title: 'Farmer questions that have passed your client-configured response SLA without a reply.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">
          Welcome,{' '}
          <span style={{ color: accent }}>{clientName}</span>
        </h1>
        <p className="text-stone-500 text-sm mt-1">Client Portal · RootsTalk</p>
        {paymentLabel && (
          <div className="mt-3 inline-flex items-start gap-2 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
            <span className="inline-block w-2 h-2 rounded-full mt-1.5" style={{ background: accent }} />
            <div>
              <p className="text-xs font-semibold text-stone-700 leading-tight">
                Payment Model: <span style={{ color: accent }}>{paymentLabel.title}</span>
              </p>
              <p className="text-xs text-stone-500 mt-0.5 leading-tight">{paymentLabel.help}</p>
            </div>
          </div>
        )}
      </div>

      {/* Stats — 7 tiles. Top 4 describe state-of-the-business,
          bottom 3 are actionable alert counts. Grid collapses:
          2 cols on mobile → 4 on sm → 4 on lg (natural row break
          after tile 4). Tiles 5-7 get a muted left-border colour
          so the "what needs attention" row reads distinct from the
          "where you are" row above it. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((s, idx) => {
          const isUnlimitedPool = s.label === 'Subscriptions Available' && unlimited
          const value = loading ? '…' : s.value
          const isString = typeof value === 'string'
          // Tiles 5-7 (the alert row) use an amber accent to signal
          // "attention needed" vs the top row's neutral accent.
          const isAttention = idx >= 4
          const borderLeftColor = isAttention ? '#D97706' : accent
          // Top-right icon tint matches the left-border accent so the
          // tile reads as a single visual unit. Slightly stronger than
          // a watermark — big enough and dark enough to catch the eye
          // but still clearly subordinate to the number.
          // (2026-11-28 bump: was stone-300 / amber-300 @ 20px — too
          // timid per user feedback; moved two shades darker + 24px.)
          const iconClass = isAttention ? 'text-amber-500' : 'text-stone-500'
          return (
            <Link key={s.label} href={s.href}
              title={s.title}
              className="bg-white rounded-xl p-5 shadow-sm border border-stone-200 hover:shadow-md transition-shadow overflow-hidden relative"
              style={{ borderLeftWidth: 3, borderLeftColor }}>
              <div className={`absolute top-4 right-4 w-6 h-6 ${iconClass}`} aria-hidden="true">
                {s.icon}
              </div>
              <p className={`font-bold text-stone-800 ${isUnlimitedPool && isString ? 'text-2xl' : 'text-3xl'}`}>{value}</p>
              <p className="text-stone-500 text-xs mt-1">{s.label}</p>
              {s.hint && (
                <p className="text-stone-400 text-xs mt-0.5 line-clamp-2">{s.hint}</p>
              )}
            </Link>
          )
        })}
      </div>

      {/* Recent packages */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-stone-800">Recent Packages</h2>
          <Link href="/advisory" className="text-sm hover:underline" style={{ color: accent }}>View all →</Link>
        </div>
        {loading ? (
          <div className="bg-white rounded-xl p-8 text-center text-stone-400 border border-stone-200">Loading…</div>
        ) : packages.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-dashed border-stone-200">
            <p className="text-stone-500 text-sm">No packages yet.</p>
            <Link href="/advisory" className="inline-block mt-3 text-sm font-medium hover:underline" style={{ color: accent }}>
              Create your first package →
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">Package</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider hidden sm:table-cell">Crop</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {packages.map(pkg => (
                  <tr key={pkg.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/advisory/${pkg.id}`} className="font-medium text-stone-800 hover:underline" style={{ color: undefined }}>
                        {pkg.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-stone-500 hidden sm:table-cell text-xs">{cropNameByCoshId[pkg.crop_cosh_id] || '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[pkg.status]}`}>{pkg.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right text-stone-400 text-xs">v{pkg.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { href: '/advisory', title: 'Advisory Builder', desc: 'Create and publish Package of Practices for farmers',
            dot: accent },
          { href: '/setup', title: 'Setup', desc: 'Configure locations and crops for your territory',
            dot: '#6B7280' },
          { href: '/users', title: 'Users', desc: 'Manage Subject Experts, Field Managers and other portal users',
            dot: '#374151' },
        ].map(card => (
          <Link key={card.href} href={card.href}
            className="bg-white rounded-xl p-5 border border-stone-200 shadow-sm hover:shadow-md transition-shadow group">
            <span className="inline-block w-2 h-2 rounded-full mb-3" style={{ background: card.dot }} />
            <h3 className="font-semibold text-stone-800 group-hover:underline">{card.title}</h3>
            <p className="text-stone-500 text-xs mt-1 leading-relaxed">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
