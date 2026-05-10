'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface ChaTimeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  recommendation_id: string
  problem_group_cosh_id: string
  problem_group_name_en: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  recommendation_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  practice_count: number
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function ChaTimelinesContent() {
  const client = getClient()
  const clientId = client?.id
  const params = useSearchParams()
  const pgFilter = params.get('pg') || ''
  const recFilter = params.get('rec') || ''
  const apFilter = params.get('ap') || ''

  const [rows, setRows] = useState<ChaTimeline[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (pgFilter) qs.set('problem_group_cosh_id', pgFilter)
    if (recFilter) qs.set('recommendation_id', recFilter)
    if (apFilter) qs.set('area_or_plant', apFilter)
    api.get<ChaTimeline[]>(`/client/${clientId}/cha/timelines?${qs.toString()}`)
      .then(r => setRows(r.data))
      .finally(() => setLoading(false))
  }, [clientId, pgFilter, recFilter, apFilter])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (pgFilter) {
      const friendly = rows[0]?.problem_group_name_en || pgFilter
      out.push({ key: 'pg', label: `Problem: ${friendly}` })
    }
    if (recFilter) {
      const r = rows[0]
      const friendly = r ?
        `${r.problem_group_name_en} · ${r.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}` :
        recFilter
      out.push({ key: 'rec', label: `Recommendation: ${friendly}` })
    }
    if (apFilter) {
      out.push({ key: 'ap', label: `Bundle: ${apFilter === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}` })
    }
    return out
  }, [pgFilter, recFilter, apFilter, rows])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Timelines</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Every timeline across the company&apos;s CHA recommendations. Days are counted from problem detection.
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Days after detection</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Problem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Bundle</th>
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
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cha/recommendations?pg=${encodeURIComponent(t.problem_group_cosh_id)}`}
                      className="text-slate-600 text-xs hover:text-green-700">
                      {t.problem_group_name_en}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs">
                    {t.area_or_plant === 'AREA_WISE' ? 'Area-wise' :
                     t.area_or_plant === 'PLANT_WISE' ? 'Plant-wise' : '—'}
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[t.recommendation_status]}`}>
                      {t.recommendation_status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs">
                    <Link
                      href={`/cha/practices?pg=${encodeURIComponent(t.problem_group_cosh_id)}&rec=${encodeURIComponent(t.recommendation_id)}&timeline=${encodeURIComponent(t.id)}`}
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

export default function ChaTimelinesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <ChaTimelinesContent />
    </Suspense>
  )
}
