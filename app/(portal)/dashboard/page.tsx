'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Package {
  id: string; name: string; crop_cosh_id: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'; version: number; created_at: string
}
interface PoolBalance { balance: number }
interface Alert { id: string }

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
  const [alertCount, setAlertCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      api.get<Package[]>(`/client/${clientId}/packages`),
      api.get<PoolBalance>(`/client/${clientId}/subscription-pool/balance`),
      api.get<Alert[]>(`/client/${clientId}/alerts`).catch(() => ({ data: [] })),
    ]).then(([pkgRes, poolRes, alertRes]) => {
      setPackages(pkgRes.data.slice(0, 6))
      setBalance(poolRes.data.balance)
      setAlertCount(Array.isArray(alertRes.data) ? alertRes.data.length : 0)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [clientId])

  const stats = [
    { label: 'Total Packages',    value: packages.length,                                   href: '/advisory' },
    { label: 'Active Packages',   value: packages.filter(p => p.status === 'ACTIVE').length, href: '/advisory' },
    { label: 'Subscription Pool', value: balance === null ? '…' : balance,                   href: '/subscription' },
    { label: 'Recent Alerts',     value: alertCount === null ? '…' : alertCount,             href: '/alerts' },
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Link key={s.label} href={s.href}
            className="bg-white rounded-xl p-5 shadow-sm border border-stone-200 hover:shadow-md transition-shadow overflow-hidden relative"
            style={{ borderLeftWidth: 3, borderLeftColor: accent }}>
            <p className="text-3xl font-bold text-stone-800">{loading ? '…' : s.value}</p>
            <p className="text-stone-500 text-xs mt-1">{s.label}</p>
          </Link>
        ))}
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
                  <th className="text-left px-5 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wider hidden sm:table-cell">Crop ID</th>
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
                    <td className="px-5 py-3 text-stone-500 hidden sm:table-cell font-mono text-xs">{pkg.crop_cosh_id}</td>
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
