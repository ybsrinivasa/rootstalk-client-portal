'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface CcaCrop {
  crop_cosh_id: string
  name_en: string
  area_or_plant: string | null
  added_at: string
  package_counts: Record<string, number>
  last_edited: string | null
}

export default function CcaCropsPage() {
  const client = getClient()
  const clientId = client?.id

  const [crops, setCrops] = useState<CcaCrop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    api.get<CcaCrop[]>(`/client/${clientId}/cca/crops`)
      .then(r => setCrops(r.data))
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Crops</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Crops on the company&apos;s belt. Click a crop to see its packages.
          Crops are managed by the CA in <Link href="/setup" className="text-green-700 hover:underline">Setup</Link>.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : crops.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🌿</p>
          <p className="text-slate-600 font-medium">No crops on the belt yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Ask the CA to add focus crops in <Link href="/setup" className="text-green-700 hover:underline">Setup → Crops</Link>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {crops.map(c => {
            const total = Object.values(c.package_counts).reduce((a, b) => a + b, 0)
            return (
              <Link key={c.crop_cosh_id}
                href={`/cca/packages?crop=${encodeURIComponent(c.crop_cosh_id)}`}
                className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:border-green-200 hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{c.name_en}</p>
                    {c.area_or_plant && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {c.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">
                    {total === 0 ? 'no packages' : `${total} package${total === 1 ? '' : 's'}`}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {c.package_counts.DRAFT ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      {c.package_counts.DRAFT} DRAFT
                    </span>
                  ) : null}
                  {c.package_counts.ACTIVE ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                      {c.package_counts.ACTIVE} ACTIVE
                    </span>
                  ) : null}
                  {c.package_counts.INACTIVE ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                      {c.package_counts.INACTIVE} INACTIVE
                    </span>
                  ) : null}
                  {total === 0 && (
                    <span className="text-[10px] text-slate-400 italic">SE has nothing to do here yet</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
