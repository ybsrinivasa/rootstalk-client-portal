'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface QaTimeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  standard_response_id: string
  question_text: string
  crop_cosh_id: string | null
  crop_name_en: string | null
  practice_count: number
}

function QaTimelinesContent() {
  const client = getClient()
  const clientId = client?.id
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''
  const srFilter = params.get('sr') || ''

  const [rows, setRows] = useState<QaTimeline[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (cropFilter) qs.set('crop_cosh_id', cropFilter)
    if (srFilter) qs.set('standard_response_id', srFilter)
    api.get<QaTimeline[]>(`/client/${clientId}/qa/timelines?${qs.toString()}`)
      .then(r => setRows(r.data))
      .finally(() => setLoading(false))
  }, [clientId, cropFilter, srFilter])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (cropFilter) {
      const friendly = cropFilter === '__AGNOSTIC__'
        ? 'Crop-agnostic'
        : (rows[0]?.crop_name_en || cropFilter)
      out.push({ key: 'crop', label: `Crop: ${friendly}` })
    }
    if (srFilter) {
      const friendly = rows[0]?.question_text || srFilter
      out.push({ key: 'sr', label: `Question: ${friendly.slice(0, 40)}${friendly.length > 40 ? '…' : ''}` })
    }
    return out
  }, [cropFilter, srFilter, rows])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Q&amp;A · Timelines</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Every Q&amp;A timeline across the company&apos;s library. Days are counted
          from when the Pundit&apos;s response is delivered to the farmer.
        </p>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📅</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No timelines match the active filters.' : 'No Q&A timelines yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Days after response</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Question</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Crop</th>
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
                  <td className="px-5 py-3.5 text-slate-600 text-xs">
                    <Link href={`/standard-responses/${t.standard_response_id}`}
                      className="hover:text-green-700">
                      {t.question_text.slice(0, 60)}{t.question_text.length > 60 ? '…' : ''}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs">
                    {t.crop_name_en || <span className="italic text-slate-400">agnostic</span>}
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs">
                    <Link
                      href={`/qa/practices?sr=${encodeURIComponent(t.standard_response_id)}&timeline=${encodeURIComponent(t.id)}`}
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

export default function QaTimelinesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <QaTimelinesContent />
    </Suspense>
  )
}
