'use client'

// Farmer 360° View placeholder. The full implementation ships in
// Phase 3 — subscription history, practice timeline, pest diagnoses,
// expert queries, input tracking with the 6-status model, and the
// call log slot. This stub exists so Phase 2 list-row clicks land
// somewhere coherent instead of 404-ing.

import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function FarmerSupportDetailStub() {
  const params = useParams<{ userId: string }>()
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-4">
        <Link href="/farmer-support" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to Farmer Support
        </Link>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <p className="text-3xl mb-3">🛠️</p>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          Farmer 360° view — coming in Phase 3
        </h1>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          This page will show the farmer&apos;s full history: subscriptions,
          practice timeline, pest diagnoses, expert queries, input status, and
          the call log. The list and alerts in Phase 2 are live now.
        </p>
        <p className="text-[11px] text-slate-400 mt-4 font-mono">farmer_user_id · {params?.userId}</p>
      </div>
    </div>
  )
}
