'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface SpTimeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  recommendation_id: string
  specific_problem_cosh_id: string
  specific_problem_name_en: string
  crop_cosh_id: string | null
  crop_name_en: string | null
  recommendation_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  practice_count: number
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function SpTimelinesContent() {
  const client = getClient()
  const clientId = client?.id
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''
  const recFilter = params.get('rec') || ''

  const [rows, setRows] = useState<SpTimeline[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (cropFilter) qs.set('crop_cosh_id', cropFilter)
    if (recFilter) qs.set('recommendation_id', recFilter)
    api.get<SpTimeline[]>(`/client/${clientId}/cha-sp/timelines?${qs.toString()}`)
      .then(r => setRows(r.data))
      .finally(() => setLoading(false))
  }, [clientId, cropFilter, recFilter])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (cropFilter) {
      const friendly = rows[0]?.crop_name_en || cropFilter
      out.push({ key: 'crop', label: `Crop: ${friendly}` })
    }
    if (recFilter) {
      const friendly = rows[0]?.specific_problem_name_en || recFilter
      out.push({ key: 'rec', label: `Problem: ${friendly}` })
    }
    return out
  }, [cropFilter, recFilter, rows])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Specific Problem · Timelines</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Every timeline across the company&apos;s SP recommendations. Days are counted from problem detection.
        </p>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📅</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No timelines match the active filters.' : 'No SP timelines yet.'}
          </p>
          {chips.length === 0 && (
            <p className="text-slate-400 text-sm mt-1">
              Start at <Link href="/cha/sp/crops" className="text-green-700 hover:underline">CHA · SP Crops</Link> → pick a crop → add a problem to the list.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Days after detection</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Specific Problem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Crop</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Practices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(t => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5 font-medium text-slate-800">{t.name}</td>
                  <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell text-xs font-mono">
                    {t.from_value}–{t.to_value}d
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 text-xs">{t.specific_problem_name_en}</td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs">
                    {t.crop_name_en || '—'}
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[t.recommendation_status]}`}>
                      {t.recommendation_status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs">
                    <Link
                      href={`/cha/sp/practices?rec=${encodeURIComponent(t.recommendation_id)}&timeline=${encodeURIComponent(t.id)}`}
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

export default function ChaSpTimelinesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <SpTimelinesContent />
    </Suspense>
  )
}
