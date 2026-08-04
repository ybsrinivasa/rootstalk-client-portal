'use client'

// Client Reports — Sales (Phase 2).
//
// Headline metrics (four cards fetched in parallel):
//   1. Locked-Brand Sales                — captured direct business
//   2. Recommended-Brand Honored         — conversion win
//   3. Recommended-Brand Substituted     — leakage signal
//   4. Volume Through Our Shops          — network-scope, retail-chain primary
//
// Cards 2 + 3 additionally surface an "outside our network" caption
// when applicable — recommended items sold by dealers who aren't on our
// onboarded list. Untracked demand (honored variant) or compound leakage
// (substituted variant).
//
// Filter chips + dealer chip + drill panel + pivot reports fill in
// over the next commits per the Phase 2 punch list.
//
// Volume-only (never price); three unit buckets (Litres / Kilograms /
// Numbers), ambiguous units silently excluded. Sale marker inherited
// from Phase 1 (PackingList.farmer_received_at IS NOT NULL).

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
  outside_network?: {
    litres: number
    kilograms: number
    numbers: number
  }
}

interface SalesData {
  locked: SalesVolumeResponse | null
  recommendedHonored: SalesVolumeResponse | null
  recommendedSubstituted: SalesVolumeResponse | null
  networkTotal: SalesVolumeResponse | null
}

const EMPTY_DATA: SalesData = {
  locked: null,
  recommendedHonored: null,
  recommendedSubstituted: null,
  networkTotal: null,
}

function outsideTotal(v?: SalesVolumeResponse['outside_network']): number {
  if (!v) return 0
  return v.litres + v.kilograms + v.numbers
}

function formatOutside(v: SalesVolumeResponse['outside_network']): string {
  if (!v) return ''
  const parts: string[] = []
  if (v.litres > 0) parts.push(`${v.litres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L`)
  if (v.kilograms > 0) parts.push(`${v.kilograms.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`)
  if (v.numbers > 0) parts.push(`${v.numbers.toLocaleString()} Nos`)
  return parts.join(' · ')
}

export default function SalesReportPage() {
  const client = getClient()
  const clientId = client?.id
  const brandColour = client?.primary_colour || '#0F172A'

  const [data, setData] = useState<SalesData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!clientId) return
    setError('')
    setLoading(true)
    try {
      const [lockedRes, honoredRes, substitutedRes, networkRes] = await Promise.all([
        api.get<SalesVolumeResponse>(`/client/${clientId}/reports/sales?metric=LOCKED`),
        api.get<SalesVolumeResponse>(`/client/${clientId}/reports/sales?metric=RECOMMENDED_HONORED`),
        api.get<SalesVolumeResponse>(`/client/${clientId}/reports/sales?metric=RECOMMENDED_SUBSTITUTED`),
        api.get<SalesVolumeResponse>(`/client/${clientId}/reports/sales?metric=NETWORK_TOTAL`),
      ])
      setData({
        locked: lockedRes.data,
        recommendedHonored: honoredRes.data,
        recommendedSubstituted: substitutedRes.data,
        networkTotal: networkRes.data,
      })
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

      {/* Row 1 — Brand scope: three cards */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SalesCard
          title="Locked-Brand Sales"
          caption="Items your SE locked to your brand — dealer had to sell exactly that. By design, always through your onboarded network."
          data={data.locked}
          loading={loading}
          brandColour={brandColour}
        />
        <SalesCard
          title="Recommended-Brand Honored"
          caption="SE recommended your brand, dealer sold that same brand. The conversion win."
          data={data.recommendedHonored}
          loading={loading}
          brandColour={brandColour}
          outsideCaption={data.recommendedHonored?.outside_network && outsideTotal(data.recommendedHonored.outside_network) > 0
            ? `+ ${formatOutside(data.recommendedHonored.outside_network)} sold outside your network`
            : null}
        />
        <SalesCard
          title="Recommended-Brand Substituted"
          caption="SE recommended your brand, dealer sold a different brand. Leakage — where your recommendation isn't landing."
          data={data.recommendedSubstituted}
          loading={loading}
          brandColour="#B45309"     // amber to signal leakage
        />
      </div>

      {/* Row 2 — Network scope: full-width card */}
      <div className="mt-4">
        <SalesCard
          title="Volume Through Our Shops"
          caption="Everything sold by your onboarded dealers — any brand, any authoring intent."
          data={data.networkTotal}
          loading={loading}
          brandColour={brandColour}
          fullWidth
        />
      </div>
    </div>
  )
}

interface SalesCardProps {
  title: string
  caption: string
  data: SalesVolumeResponse | null
  loading: boolean
  brandColour: string
  outsideCaption?: string | null
  fullWidth?: boolean
}

function SalesCard({ title, caption, data, loading, brandColour, outsideCaption, fullWidth }: SalesCardProps) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm p-5 ${fullWidth ? 'w-full' : ''}`}>
      <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
        {title}
      </p>
      <div className="mt-3">
        {loading || !data ? (
          <div className="h-8 w-32 bg-slate-100 rounded animate-pulse" />
        ) : (
          <ThreeUnitNumber
            litres={data.litres}
            kilograms={data.kilograms}
            numbers={data.numbers}
            colour={brandColour}
          />
        )}
      </div>
      {outsideCaption && (
        <p className="text-xs text-slate-500 mt-2 italic">
          {outsideCaption}
        </p>
      )}
      <p className="text-xs text-slate-500 mt-3 leading-relaxed">
        {caption}
      </p>
    </div>
  )
}
