'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

// Crops landing for the Seed Varieties feature (Batch O+, 2026-05-18).
// Mirrors the /cca/crops nested-drill-down so the SDM picks a crop
// first, then lands on /seed/varieties?crop=<cosh_id> for management.
// Previous flat list with a "Crop (Cosh ID) *" text input was
// replaced because the cosh_id was opaque to the SDM.

interface ClientCrop {
  id: string
  crop_cosh_id: string
  crop_name_en?: string | null
  status: string
}

interface Variety {
  id: string
  crop_cosh_id: string
  status: string
}

export default function SeedCropsLandingPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [crops, setCrops] = useState<ClientCrop[]>([])
  const [varietyCountByCrop, setVarietyCountByCrop] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      api.get<ClientCrop[]>(`/client/${clientId}/crops`).catch(() => ({ data: [] as ClientCrop[] })),
      api.get<Variety[]>(`/client/${clientId}/varieties`).catch(() => ({ data: [] as Variety[] })),
    ]).then(([cropsRes, vRes]) => {
      setCrops(cropsRes.data.filter(c => !('removed_at' in c) || (c as { removed_at?: string | null }).removed_at == null))
      const counts: Record<string, number> = {}
      for (const v of vRes.data) {
        counts[v.crop_cosh_id] = (counts[v.crop_cosh_id] || 0) + 1
      }
      setVarietyCountByCrop(counts)
    }).finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Seed Varieties</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Pick a crop to manage its varieties. Crops are added by the CA in <Link href="/setup" className="text-green-700 hover:underline">Setup</Link>.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : crops.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🌱</p>
          <p className="text-slate-600 font-medium">No crops on the belt yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Ask the CA to add crops in <Link href="/setup" className="text-green-700 hover:underline">Setup → Crops</Link>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {crops.map(c => {
            const count = varietyCountByCrop[c.crop_cosh_id] || 0
            return (
              <Link key={c.crop_cosh_id}
                href={`/seed/varieties?crop=${encodeURIComponent(c.crop_cosh_id)}`}
                className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:border-green-200 hover:shadow-md transition-all"
                style={{ borderLeftWidth: 3, borderLeftColor: colour }}>
                <div className="flex items-start justify-between mb-1">
                  <p className="font-semibold text-slate-900 truncate flex-1">
                    {c.crop_name_en || '—'}
                  </p>
                  <span className="text-xs text-slate-400">
                    {count === 0 ? 'no varieties' : `${count} variet${count === 1 ? 'y' : 'ies'}`}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
