'use client'

// Client Reports — Sales (Phase 2).
//
// First vertical slice: Locked-Brand Sales card only. Proves the whole
// pipeline (Sales tab → new endpoint → three-unit renderer). The other
// three headline cards + pivot reports + Dealer filter + dimension
// drills fill in metric-by-metric per the punch list.
//
// Volume-only (never price — dealer-declared given_volume, not the
// PWA's estimated_volume). Three unit buckets (Litres / Kilograms /
// Numbers), ambiguous units silently excluded. Sale marker inherited
// from Phase 1 (PackingList.farmer_received_at IS NOT NULL) so numbers
// agree with the Phase 1 Sale Conversion card for the same period.

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { ReportSubjectTabs } from '@/components/reports/subject-tabs'
import { ThreeUnitNumber } from '@/components/reports/three-unit-number'

interface SalesVolumeResponse {
  litres: number
  kilograms: number
  numbers: number
}

export default function SalesReportPage() {
  const client = getClient()
  const clientId = client?.id
  const brandColour = client?.primary_colour || '#0F172A'

  const [locked, setLocked] = useState<SalesVolumeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!clientId) return
    setError('')
    setLoading(true)
    try {
      const { data } = await api.get<SalesVolumeResponse>(
        `/client/${clientId}/reports/sales?metric=LOCKED`,
      )
      setLocked(data)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not load Sales data.'))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <ReportSubjectTabs />

      <div className="mt-6">
        <h1 className="text-2xl font-bold text-slate-900">Sales</h1>
        <p className="text-sm text-slate-500 mt-1">
          Volumes sold through your onboarded dealers, by SE authoring intent.
          Confirmed once the farmer receives the goods.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Locked-Brand Sales
          </p>
          <div className="mt-3">
            {loading || !locked ? (
              <div className="h-8 w-32 bg-slate-100 rounded animate-pulse" />
            ) : (
              <ThreeUnitNumber
                litres={locked.litres}
                kilograms={locked.kilograms}
                numbers={locked.numbers}
                colour={brandColour}
              />
            )}
          </div>
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">
            Items your SE locked to your brand — dealer had to sell exactly that.
            By design, always through your onboarded network.
          </p>
        </div>

        {/* Other three headline cards + pivot reports + Dealer filter
            + dimension drills fill in over the next commits per the
            Phase 2 punch list. */}
      </div>
    </div>
  )
}
