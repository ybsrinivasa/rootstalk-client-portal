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
    : null
  const alertHint = summary ? (() => {
    const b = summary.alerts.by_type
    const parts: string[] = []
    if (b.pending_start_dates) parts.push(`${b.pending_start_dates} start-date pending`)
    if (b.overdue_inputs)      parts.push(`${b.overdue_inputs} input due now`)
    if (b.missed_inputs)       parts.push(`${b.missed_inputs} input missed`)
    if (b.overdue_expert_queries) parts.push(`${b.overdue_expert_queries} query overdue`)
    if (b.no_active_subscription) parts.push(`${b.no_active_subscription} to re-engage`)
    return parts.join(' · ') || null
  })() : null
  const stats: Array<{ label: string; value: React.ReactNode; href: string; hint?: string | null; title?: string }> = [
    { label: 'Total Packages',    value: summary ? summary.packages.total : '…',           href: '/advisory' },
    { label: 'Active Packages',   value: summary ? summary.packages.active : '…',          href: '/advisory' },
    { label: 'Active Farmers',    value: summary ? summary.active_farmers : '…',           href: '/farmer-support',
      hint: 'Farmers with a current crop',
      title: 'Distinct farmers with at least one ACTIVE subscription that has a crop_start_date set.' },
    { label: 'Subscription Pool', value: poolValue,                                         href: '/subscription', hint: poolHint },
    { label: 'Open Alerts',       value: summary ? summary.alerts.total : '…',             href: '/farmer-support', hint: alertHint,
      title: 'Click to open Farmer Support for the drill-down.' },
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

      {/* Stats — 5 tiles. Grid collapses to 2 cols on mobile, 3 on
          tablet, 5 on desktop so each tile stays legible. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map(s => {
          const isUnlimitedPool = s.label === 'Subscription Pool' && unlimited
          const value = loading ? '…' : s.value
          const isString = typeof value === 'string'
          return (
            <Link key={s.label} href={s.href}
              title={s.title}
              className="bg-white rounded-xl p-5 shadow-sm border border-stone-200 hover:shadow-md transition-shadow overflow-hidden relative"
              style={{ borderLeftWidth: 3, borderLeftColor: accent }}>
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
