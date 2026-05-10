'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface SpCrop {
  crop_cosh_id: string
  name_en: string
  is_eligible: boolean
}

export default function ChaSpCropsPage() {
  const client = getClient()
  const clientId = client?.id

  const [crops, setCrops] = useState<SpCrop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    api.get<SpCrop[]>(`/client/${clientId}/cha-sp/eligible-crops`)
      .then(r => setCrops(r.data))
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Specific Problem · Crops</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Crops where the SE may author specific-problem recommendations.
          Pick a crop to see its problem list.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-800">
        <strong>This is a subset.</strong> Shown here = the crops the CA shortlisted in
        <Link href="/setup" className="mx-1 underline hover:text-blue-900">Setup</Link>
        AND that RootsTalk has enabled for CHA at the platform level.
        A CA crop without RootsTalk enablement won&apos;t appear here.
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : crops.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🌱</p>
          <p className="text-slate-600 font-medium">No crops eligible yet</p>
          <p className="text-slate-400 text-sm mt-1">
            Either the CA hasn&apos;t shortlisted any crops, or RootsTalk hasn&apos;t enabled CHA on the company&apos;s shortlisted crops yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {crops.map(c => (
            <Link key={c.crop_cosh_id}
              href={`/cha/sp/specific-problems?crop=${encodeURIComponent(c.crop_cosh_id)}`}
              className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:border-green-200 hover:shadow-md transition-all">
              <p className="font-semibold text-slate-900">{c.name_en}</p>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">{c.crop_cosh_id}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
