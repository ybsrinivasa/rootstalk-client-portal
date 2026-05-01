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

const STATUS_COLOUR = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

export default function DashboardPage() {
  const clientId = getClient()?.id
  const clientName = getClient()?.display_name
  const [packages, setPackages] = useState<Package[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      api.get<Package[]>(`/client/${clientId}/packages`),
      api.get<PoolBalance>(`/client/${clientId}/subscription-pool/balance`),
    ]).then(([pkgRes, poolRes]) => {
      setPackages(pkgRes.data.slice(0, 6))
      setBalance(poolRes.data.balance)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [clientId])

  const stats = [
    { label: 'Total Packages', value: packages.length, href: '/advisory' },
    { label: 'Active Packages', value: packages.filter(p => p.status === 'ACTIVE').length, href: '/advisory' },
    { label: 'Draft Packages', value: packages.filter(p => p.status === 'DRAFT').length, href: '/advisory' },
    { label: 'Subscription Pool', value: balance === null ? '…' : balance, href: '/subscription' },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Welcome, {clientName}</h1>
        <p className="text-slate-500 text-sm mt-1">Client Portal · RootsTalk</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Link key={s.label} href={s.href}
            className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
            <p className="text-3xl font-bold text-slate-800">{loading ? '…' : s.value}</p>
            <p className="text-slate-500 text-xs mt-1">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Recent packages */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Recent Packages</h2>
          <Link href="/advisory" className="text-sm text-green-700 hover:underline">View all →</Link>
        </div>
        {loading ? (
          <div className="bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-100">Loading…</div>
        ) : packages.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-dashed border-slate-200">
            <p className="text-slate-500 text-sm">No packages yet.</p>
            <Link href="/advisory" className="inline-block mt-3 text-sm font-medium text-green-700 hover:underline">Create your first package →</Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Package</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Crop ID</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">v{''}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {packages.map(pkg => (
                  <tr key={pkg.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/advisory/${pkg.id}`} className="font-medium text-slate-800 hover:text-green-700">{pkg.name}</Link>
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden sm:table-cell font-mono text-xs">{pkg.crop_cosh_id}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[pkg.status]}`}>{pkg.status}</span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-400 text-xs">v{pkg.version}</td>
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
          { href: '/advisory', title: 'Advisory Builder', desc: 'Create and publish Package of Practices for farmers', emoji: '🌿' },
          { href: '/setup', title: 'Setup', desc: 'Configure locations and crops for your territory', emoji: '⚙' },
          { href: '/users', title: 'Users', desc: 'Manage Subject Experts, Field Managers and other portal users', emoji: '👥' },
        ].map(card => (
          <Link key={card.href} href={card.href}
            className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow group">
            <span className="text-2xl">{card.emoji}</span>
            <h3 className="font-semibold text-slate-800 mt-2 group-hover:text-green-700">{card.title}</h3>
            <p className="text-slate-500 text-xs mt-1 leading-relaxed">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
