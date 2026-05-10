'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface ChaRec {
  id: string
  problem_group_cosh_id: string
  problem_group_name_en: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  imported_from_global_at: string | null
  timeline_count: number
  created_at: string
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function ChaRecsContent() {
  const client = getClient()
  const clientId = client?.id
  const params = useSearchParams()
  const pgFilter = params.get('pg') || ''
  const apFilter = params.get('ap') || ''
  const statusFilter = params.get('status') || ''

  const [recs, setRecs] = useState<ChaRec[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (pgFilter) qs.set('problem_group_cosh_id', pgFilter)
    if (apFilter) qs.set('area_or_plant', apFilter)
    if (statusFilter) qs.set('status', statusFilter)
    api.get<ChaRec[]>(`/client/${clientId}/cha/recommendations?${qs.toString()}`)
      .then(r => setRecs(r.data))
      .finally(() => setLoading(false))
  }, [clientId, pgFilter, apFilter, statusFilter])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (pgFilter) {
      const friendly = recs[0]?.problem_group_name_en || pgFilter
      out.push({ key: 'pg', label: `Problem: ${friendly}` })
    }
    if (apFilter) {
      out.push({ key: 'ap', label: `Bundle: ${apFilter === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}` })
    }
    if (statusFilter) {
      out.push({ key: 'status', label: `Status: ${statusFilter}` })
    }
    return out
  }, [pgFilter, apFilter, statusFilter, recs])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Recommendations</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          One row per (Problem × bundle). Each is its own DRAFT/ACTIVE lifecycle.
        </p>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : recs.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📋</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No recommendations match the active filters.' : 'No recommendations yet.'}
          </p>
          {chips.length === 0 && (
            <p className="text-slate-400 text-sm mt-1">
              Pick a <Link href="/cha/problems" className="text-green-700 hover:underline">Problem</Link> to start authoring its first bundle.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Problem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bundle</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Source</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Timelines</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recs.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cha/timelines?pg=${encodeURIComponent(r.problem_group_cosh_id)}&rec=${encodeURIComponent(r.id)}`}
                      className="font-medium text-slate-800 hover:text-green-700">
                      {r.problem_group_name_en}
                    </Link>
                    <span className="text-xs text-slate-400 ml-2">v{r.version}</span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 text-xs">
                    {r.area_or_plant === 'AREA_WISE' ? 'Area-wise' :
                     r.area_or_plant === 'PLANT_WISE' ? 'Plant-wise' : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell text-xs">
                    {r.imported_from_global_at ? 'imported' : 'authored from scratch'}
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600 hidden md:table-cell text-xs">
                    <Link
                      href={`/cha/timelines?pg=${encodeURIComponent(r.problem_group_cosh_id)}&rec=${encodeURIComponent(r.id)}`}
                      className="hover:text-green-700">
                      {r.timeline_count}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden lg:table-cell text-xs">
                    {new Date(r.created_at).toLocaleDateString()}
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

export default function ChaRecsPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <ChaRecsContent />
    </Suspense>
  )
}
