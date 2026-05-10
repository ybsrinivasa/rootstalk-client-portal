'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface ChaProblem {
  cosh_id: string
  name_en: string
  status: string
  area_wise_status: string | null
  plant_wise_status: string | null
}

const BUNDLE_PILL: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function bundleLabel(label: string, status: string | null) {
  if (!status) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-400 border border-dashed border-slate-200 font-medium">
        {label}: not started
      </span>
    )
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${BUNDLE_PILL[status] || 'bg-slate-100 text-slate-500'}`}>
      {label}: {status}
    </span>
  )
}

export default function ChaProblemsPage() {
  const client = getClient()
  const clientId = client?.id

  const [problems, setProblems] = useState<ChaProblem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    api.get<ChaProblem[]>(`/client/${clientId}/cha/problems`)
      .then(r => setProblems(r.data))
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Problems</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Problem Groups the SE can author recommendations against. Each PG has two bundles —
          one for area-wise crops, one for plant-wise — that progress independently.
          Click a Problem to see its recommendations.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800">
        V1 stopgap: this list is hardcoded (12 PGs covering common pilot scenarios). When Cosh ships the
        <code className="mx-1 px-1.5 py-0.5 bg-amber-100 rounded font-mono">problem_group</code>
        Connect, the list backfills from there with no UI changes.
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : problems.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🩺</p>
          <p className="text-slate-600 font-medium">No problem groups synced yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {problems.map(p => {
            const totalActive =
              (p.area_wise_status === 'ACTIVE' ? 1 : 0) +
              (p.plant_wise_status === 'ACTIVE' ? 1 : 0)
            const totalDraft =
              (p.area_wise_status === 'DRAFT' ? 1 : 0) +
              (p.plant_wise_status === 'DRAFT' ? 1 : 0)
            return (
              <Link key={p.cosh_id}
                href={`/cha/recommendations?pg=${encodeURIComponent(p.cosh_id)}`}
                className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:border-green-200 hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-3">
                  <p className="font-semibold text-slate-900 truncate">{p.name_en}</p>
                  <span className="text-xs text-slate-400">
                    {totalActive > 0 && <>{totalActive} active</>}
                    {totalActive > 0 && totalDraft > 0 && ' · '}
                    {totalDraft > 0 && <>{totalDraft} draft</>}
                    {totalActive === 0 && totalDraft === 0 && <>not started</>}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {bundleLabel('Area', p.area_wise_status)}
                  {bundleLabel('Plant', p.plant_wise_status)}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
