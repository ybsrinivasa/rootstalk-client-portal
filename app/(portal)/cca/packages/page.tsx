'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface CcaPackage {
  id: string
  name: string
  crop_cosh_id: string
  crop_name_en: string
  package_type: 'ANNUAL' | 'PERENNIAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  duration_days: number
  description: string | null
  timeline_count: number
  location_count: number
  updated_at: string | null
  created_at: string
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function PackagesContent() {
  const client = getClient()
  const clientId = client?.id
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''
  const statusFilter = params.get('status') || ''

  const [packages, setPackages] = useState<CcaPackage[]>([])
  const [cropName, setCropName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (cropFilter) qs.set('crop_cosh_id', cropFilter)
    if (statusFilter) qs.set('status', statusFilter)
    api.get<CcaPackage[]>(`/client/${clientId}/cca/packages?${qs.toString()}`)
      .then(r => {
        setPackages(r.data)
        if (cropFilter && r.data[0]) setCropName(r.data[0].crop_name_en)
      })
      .finally(() => setLoading(false))
  }, [clientId, cropFilter, statusFilter])

  // If chip is set but no rows, fetch the crop name from /cca/crops once
  // for the chip label (so a 0-package crop still shows the friendly name).
  useEffect(() => {
    if (!cropFilter || cropName || !clientId) return
    api.get<{ crop_cosh_id: string; name_en: string }[]>(`/client/${clientId}/cca/crops`)
      .then(r => {
        const c = r.data.find(x => x.crop_cosh_id === cropFilter)
        if (c) setCropName(c.name_en)
      }).catch(() => undefined)
  }, [clientId, cropFilter, cropName])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (cropFilter) {
      out.push({ key: 'crop', label: `Crop: ${cropName || cropFilter}` })
    }
    if (statusFilter) {
      out.push({ key: 'status', label: `Status: ${statusFilter}` })
    }
    return out
  }, [cropFilter, statusFilter, cropName])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Packages</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Package of Practices — one per (crop, season, region). Click a row to open the editor.
        </p>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📋</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No packages match the active filters.' : 'No packages yet.'}
          </p>
          {chips.length === 0 && (
            <p className="text-slate-400 text-sm mt-1">
              Pick a <Link href="/cca/crops" className="text-green-700 hover:underline">crop</Link> to start authoring its first PoP.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Crop</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Timelines</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Locations</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Last edited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {packages.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link href={`/advisory/${p.id}`} className="font-medium text-slate-800 hover:text-green-700">
                      {p.name}
                    </Link>
                    <span className="text-xs text-slate-400 ml-2">v{p.version}</span>
                    {p.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{p.description}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 text-xs">{p.crop_name_en}</td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs capitalize">
                    {p.package_type.toLowerCase()} · {p.duration_days}d
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600 hidden md:table-cell text-xs">
                    <Link
                      href={`/cca/timelines?crop=${encodeURIComponent(p.crop_cosh_id)}&package=${encodeURIComponent(p.id)}`}
                      className="hover:text-green-700">
                      {p.timeline_count}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden md:table-cell text-xs">{p.location_count}</td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden lg:table-cell text-xs">
                    {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function CcaPackagesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <PackagesContent />
    </Suspense>
  )
}
