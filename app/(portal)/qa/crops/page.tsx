'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface QaCrop {
  crop_cosh_id: string
  name_en: string
}

export default function QaCropsPage() {
  const client = getClient()
  const clientId = client?.id

  const [crops, setCrops] = useState<QaCrop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    api.get<QaCrop[]>(`/client/${clientId}/qa/eligible-crops`)
      .then(r => setCrops(r.data))
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Q&amp;A · Crops</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Crops where the SE may author Standard Responses. This is the CA&apos;s
          full shortlist — no extra enablement required (unlike CHA-SP).
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Crop-agnostic entry — always available */}
          <Link
            href={`/qa/standard-responses?crop=__AGNOSTIC__`}
            className="bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-4 shadow-sm hover:border-green-300 hover:shadow-md transition-all">
            <p className="font-semibold text-slate-700">Crop-agnostic</p>
            <p className="text-xs text-slate-400 mt-0.5">Questions that apply across crops</p>
          </Link>

          {crops.map(c => (
            <Link key={c.crop_cosh_id}
              href={`/qa/standard-responses?crop=${encodeURIComponent(c.crop_cosh_id)}`}
              className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:border-green-200 hover:shadow-md transition-all">
              <p className="font-semibold text-slate-900">{c.name_en}</p>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">{c.crop_cosh_id}</p>
            </Link>
          ))}

          {crops.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
              <p className="text-slate-400 text-4xl mb-3">📚</p>
              <p className="text-slate-600 font-medium">No crops on the belt</p>
              <p className="text-slate-400 text-sm mt-1">
                Ask the CA to shortlist crops in <Link href="/setup" className="text-green-700 hover:underline">Setup</Link>.
                You can still author crop-agnostic Q&amp;A above.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
