'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface ChaPractice {
  id: string
  l0_type: string
  l1_type: string | null
  l2_type: string | null
  is_special_input: boolean
  frequency_days: number | null
  brand_cosh_id: string | null
  dosage_summary: string | null
  timeline_id: string
  timeline_name: string
  recommendation_id: string
  problem_group_cosh_id: string
  problem_group_name_en: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  recommendation_status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
}

interface ChaPracticesResponse {
  items: ChaPractice[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 100

function ChaPracticesContent() {
  const client = getClient()
  const clientId = client?.id
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()

  const pgFilter = params.get('pg') || ''
  const recFilter = params.get('rec') || ''
  const timelineFilter = params.get('timeline') || ''
  const apFilter = params.get('ap') || ''
  const l1Filter = params.get('l1') || ''
  const offset = parseInt(params.get('offset') || '0', 10) || 0

  const [data, setData] = useState<ChaPracticesResponse>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (pgFilter) qs.set('problem_group_cosh_id', pgFilter)
    if (recFilter) qs.set('recommendation_id', recFilter)
    if (timelineFilter) qs.set('timeline_id', timelineFilter)
    if (apFilter) qs.set('area_or_plant', apFilter)
    if (l1Filter) qs.set('l1', l1Filter)
    qs.set('limit', String(PAGE_SIZE))
    qs.set('offset', String(offset))
    api.get<ChaPracticesResponse>(`/client/${clientId}/cha/practices?${qs.toString()}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [clientId, pgFilter, recFilter, timelineFilter, apFilter, l1Filter, offset])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (pgFilter) {
      out.push({ key: 'pg', label: `Problem: ${data.items[0]?.problem_group_name_en || pgFilter}` })
    }
    if (recFilter) {
      const r = data.items[0]
      const friendly = r ?
        `${r.problem_group_name_en} · ${r.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}` :
        recFilter
      out.push({ key: 'rec', label: `Recommendation: ${friendly}` })
    }
    if (timelineFilter) {
      out.push({ key: 'timeline', label: `Timeline: ${data.items[0]?.timeline_name || timelineFilter}` })
    }
    if (apFilter) {
      out.push({ key: 'ap', label: `Bundle: ${apFilter === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}` })
    }
    if (l1Filter) {
      out.push({ key: 'l1', label: `L1: ${l1Filter}` })
    }
    return out
  }, [pgFilter, recFilter, timelineFilter, apFilter, l1Filter, data.items])

  const setL1 = (v: string) => {
    const next = new URLSearchParams(params.toString())
    if (v) next.set('l1', v); else next.delete('l1')
    next.delete('offset')
    const qs = next.toString()
    router.push(qs ? `${path}?${qs}` : path)
  }

  const goPage = (newOffset: number) => {
    const next = new URLSearchParams(params.toString())
    if (newOffset > 0) next.set('offset', String(newOffset)); else next.delete('offset')
    const qs = next.toString()
    router.push(qs ? `${path}?${qs}` : path)
  }

  const showingFrom = data.total === 0 ? 0 : offset + 1
  const showingTo = Math.min(offset + data.items.length, data.total)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Practices</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Every practice across the company&apos;s CHA recommendations. Use chips to narrow, or filter by L1 for cross-cutting queries.
        </p>
      </div>

      <FilterChips chips={chips} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-500">L1 type</label>
        <select value={l1Filter} onChange={e => setL1(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">All</option>
          <option value="PESTICIDE">PESTICIDE</option>
          <option value="FERTILIZER">FERTILIZER</option>
          <option value="SPECIAL_INPUT">SPECIAL_INPUT</option>
          <option value="POST_HARVEST">POST_HARVEST</option>
          <option value="GROWING_CONDITIONS">GROWING_CONDITIONS</option>
          <option value="GENERAL_INSTRUCTIONS">GENERAL_INSTRUCTIONS</option>
          <option value="MEDIA">MEDIA</option>
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : data.items.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🩺</p>
          <p className="text-slate-600 font-medium">No practices match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Practice</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Brand</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Dosage</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Problem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Bundle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.items.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-slate-800">
                      {p.l2_type || p.l1_type || p.l0_type}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {p.l0_type}{p.l1_type ? ` · ${p.l1_type}` : ''}
                      {p.is_special_input ? ' · special-input' : ''}
                      {p.frequency_days ? ` · every ${p.frequency_days}d` : ''}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell text-xs text-slate-600 font-mono">
                    {p.brand_cosh_id || '—'}
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell text-xs text-slate-600">
                    {p.dosage_summary || '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cha/timelines?pg=${encodeURIComponent(p.problem_group_cosh_id)}&rec=${encodeURIComponent(p.recommendation_id)}`}
                      className="text-slate-600 text-xs hover:text-green-700">
                      {p.timeline_name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cha/recommendations?pg=${encodeURIComponent(p.problem_group_cosh_id)}`}
                      className="text-slate-600 text-xs hover:text-green-700">
                      {p.problem_group_name_en}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs">
                    {p.area_or_plant === 'AREA_WISE' ? 'Area' :
                     p.area_or_plant === 'PLANT_WISE' ? 'Plant' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Showing {showingFrom}–{showingTo} of {data.total}</span>
          <div className="flex gap-2">
            <button onClick={() => goPage(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50">
              ← Previous
            </button>
            <button onClick={() => goPage(offset + PAGE_SIZE)}
              disabled={offset + data.items.length >= data.total}
              className="px-3 py-1.5 border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ChaPracticesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <ChaPracticesContent />
    </Suspense>
  )
}
