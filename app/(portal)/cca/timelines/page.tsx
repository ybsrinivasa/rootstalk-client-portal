'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface CcaTimeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  display_order: number
  package_id: string
  package_name: string
  package_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  crop_cosh_id: string
  crop_name_en: string
  practice_count: number
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function formatRange(t: CcaTimeline): string {
  const unit =
    t.from_type === 'DAS' ? 'DAS' :
    t.from_type === 'DBS' ? 'DBS' :
    t.from_type === 'CALENDAR' ? 'day-of-year' :
    t.from_type
  return `${t.from_value}–${t.to_value} ${unit}`
}

function TimelinesContent() {
  const client = getClient()
  const clientId = client?.id
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''
  const packageFilter = params.get('package') || ''

  const [rows, setRows] = useState<CcaTimeline[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (cropFilter) qs.set('crop_cosh_id', cropFilter)
    if (packageFilter) qs.set('package_id', packageFilter)
    api.get<CcaTimeline[]>(`/client/${clientId}/cca/timelines?${qs.toString()}`)
      .then(r => setRows(r.data))
      .finally(() => setLoading(false))
  }, [clientId, cropFilter, packageFilter])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (cropFilter) {
      const friendly = rows[0]?.crop_name_en || cropFilter
      out.push({ key: 'crop', label: `Crop: ${friendly}` })
    }
    if (packageFilter) {
      const friendly = rows[0]?.package_name || packageFilter
      out.push({ key: 'package', label: `Package: ${friendly}` })
    }
    return out
  }, [cropFilter, packageFilter, rows])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Timelines</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Every timeline across the company&apos;s packages. Click a row to jump to the editor for that package.
        </p>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📅</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No timelines match the active filters.' : 'No timelines yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Range</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Package</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Crop</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Pkg Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Practices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(t => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link href={`/advisory/${t.package_id}`} className="font-medium text-slate-800 hover:text-green-700">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell text-xs font-mono">
                    {formatRange(t)}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cca/packages?crop=${encodeURIComponent(t.crop_cosh_id)}`}
                      className="text-slate-600 text-xs hover:text-green-700">
                      {t.package_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs">{t.crop_name_en}</td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[t.package_status]}`}>
                      {t.package_status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs">
                    <Link
                      href={`/cca/practices?crop=${encodeURIComponent(t.crop_cosh_id)}&package=${encodeURIComponent(t.package_id)}&timeline=${encodeURIComponent(t.id)}`}
                      className="text-slate-600 hover:text-green-700">
                      {t.practice_count}
                    </Link>
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

export default function CcaTimelinesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <TimelinesContent />
    </Suspense>
  )
}
