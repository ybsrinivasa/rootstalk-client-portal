'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'

// RM-facing recommendation detail panel for one practice.
// Mounted inside an expanded row on Practice Timeline / Input Tracking.
// Mirrors what the farmer sees in their PWA (minus media playback) so
// the RM can hold a credible, specific conversation on the weekly call.

interface SignatureChip {
  parameter_name: string | null
  variable_name: string | null
}
interface ElementRow {
  element_type: string
  value: string | null
  unit: string | null
}
interface RecommendedProduct {
  common_name: string | null
  trade_name: string | null
  manufacturer: string | null
  formulation: string | null
  ai_concentration: string | null
  is_brand_locked: boolean
}
interface MediaCounts {
  photos: number
  audios: number
  hyperlinks: number
}
interface AckInfo {
  marked_at: string | null
  purchased_at: string | null
  hidden_at: string | null
  purchased_brand_cosh_id: string | null
  purchased_brand_text: string | null
}
interface SiblingLeg {
  practice_id: string
  l2_type: string | null
  l2_name: string | null
  relation_role: string | null
  is_self: boolean
  ack_marked_at: string | null
  ack_purchased_at: string | null
  ack_hidden_at: string | null
}
interface RelationInfo {
  relation_id: string
  relation_type: string | null
  siblings: SiblingLeg[]
}
interface BrandRow {
  cosh_id: string | null
  name: string | null
  manufacturer: string | null
}
interface BrandCandidates {
  is_locked: boolean
  locked_brand_name?: string | null
  brands: BrandRow[]
  error?: string
}
interface NpkStraight {
  cosh_id: string | null
  name: string | null
  n: number
  p: number
  k: number
  class: string | null
  water_soluble: boolean
  kg_product_needed: number | null
  has_brands: boolean
}
interface NpkMixed {
  cosh_id: string | null
  name: string | null
  n: number
  p: number
  k: number
  kg_product: number
  kg_product_total: number
  delivered: { n: number; p: number; k: number }
  match_target: string | null
  total_delivered: number
  has_brands: boolean
}
interface NpkPayload {
  is_npk_practice: boolean
  fertigation: boolean
  applications_multiplier: number
  required_dose: { n: number; p: number; k: number }
  ranked_mixed: NpkMixed[]
  enabled_straights: NpkStraight[]
  gap: { n: number; p: number; k: number }
  cosh_skipped_count: number
  error?: string
}
interface RecommendationPayload {
  practice: {
    practice_id: string
    l0_type: string | null
    l1_type: string | null
    l2_type: string | null
    l2_name: string | null
    timeline_name: string | null
    occurrence_date: string | null
    window_start: string | null
    window_end: string | null
    frequency_days: number | null
    is_brand_locked: boolean
  }
  recommended_product: RecommendedProduct
  elements: ElementRow[]
  media_counts: MediaCounts
  ack: AckInfo
  relation: RelationInfo | null
  brand_candidates: BrandCandidates | null
  npk_recommendation: NpkPayload | null
  signature_chips: SignatureChip[]
}

const ELEMENT_LABELS: Record<string, string> = {
  APPLICATION_METHOD: 'Application method',
  DOSAGE: 'Dosage',
  VOLUME_PER_PLANT: 'Volume per plant',
  INSTRUCTIONS: 'Instructions',
  QUANTITY: 'Quantity',
  TITLE: 'Title',
  DESCRIPTION: 'Description',
  NOTES: 'Notes',
  FREQUENCY: 'Frequency',
  TARGET_PEST: 'Target pest',
  TARGET_DISEASE: 'Target disease',
  TIMING: 'Timing',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return iso }
}

function legAckLabel(leg: SiblingLeg): { text: string; cls: string } {
  if (leg.ack_hidden_at) return { text: 'Hidden by farmer', cls: 'text-slate-500' }
  if (leg.ack_marked_at) return { text: `Done ${fmtDate(leg.ack_marked_at)}`, cls: 'text-emerald-700 font-semibold' }
  if (leg.ack_purchased_at) return { text: `Purchased ${fmtDate(leg.ack_purchased_at)}`, cls: 'text-emerald-700 font-semibold' }
  return { text: 'Not yet done', cls: 'text-slate-500 italic' }
}

export default function RecommendationPanel({
  clientId,
  farmerUserId,
  subscriptionId,
  practiceId,
}: {
  clientId: string
  farmerUserId: string
  subscriptionId: string
  practiceId: string
}) {
  const [data, setData] = useState<RecommendationPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    api.get<RecommendationPayload>(
      `/client/${clientId}/farmer-support/farmers/${farmerUserId}/subscriptions/${subscriptionId}/practices/${practiceId}/recommendation`,
    )
      .then(r => { if (!cancelled) setData(r.data) })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { detail?: string } }; message?: string }
        if (!cancelled) setError(err?.response?.data?.detail || err?.message || 'Failed to load recommendation.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId, farmerUserId, subscriptionId, practiceId])

  if (loading) {
    return <div className="p-4 text-xs text-slate-400 italic">Loading recommendation…</div>
  }
  if (error) {
    return <div className="p-4 text-xs text-red-600">{error}</div>
  }
  if (!data) return null

  const m = data.media_counts
  const totalMedia = m.photos + m.audios + m.hyperlinks

  return (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 text-xs">
      {/* Recommended product — the SPECIFIC thing to tell the farmer
          to buy. Shows prominently at the top because it's what the
          RM reads aloud on the call. Brand-lock gets a highlight so
          the RM knows the farmer cannot substitute. */}
      {(data.recommended_product.common_name
        || data.recommended_product.trade_name
        || data.recommended_product.manufacturer
        || data.recommended_product.formulation) && (
        <div className={`rounded-lg p-3 ${
          data.recommended_product.is_brand_locked
            ? 'bg-amber-50 border-2 border-amber-300'
            : 'bg-white border border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Recommended product
            </p>
            {data.recommended_product.is_brand_locked && (
              <span className="inline-block text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-amber-400 text-slate-900 rounded">
                🔒 Brand-locked
              </span>
            )}
          </div>
          <div className="space-y-0.5">
            {data.recommended_product.common_name && (
              <p>
                <span className="text-slate-500 min-w-[110px] inline-block">Common name</span>
                <strong className="text-slate-800">{data.recommended_product.common_name}</strong>
              </p>
            )}
            {data.recommended_product.trade_name && (
              <p>
                <span className="text-slate-500 min-w-[110px] inline-block">Trade name</span>
                <strong className="text-slate-800">{data.recommended_product.trade_name}</strong>
              </p>
            )}
            {data.recommended_product.manufacturer && (
              <p>
                <span className="text-slate-500 min-w-[110px] inline-block">Manufacturer</span>
                <span className="text-slate-800">{data.recommended_product.manufacturer}</span>
              </p>
            )}
            {data.recommended_product.formulation && (
              <p>
                <span className="text-slate-500 min-w-[110px] inline-block">Formulation</span>
                <span className="text-slate-800">{data.recommended_product.formulation}</span>
              </p>
            )}
            {data.recommended_product.ai_concentration && (
              <p>
                <span className="text-slate-500 min-w-[110px] inline-block">AI concentration</span>
                <span className="text-slate-800">{data.recommended_product.ai_concentration}</span>
              </p>
            )}
          </div>
          {data.recommended_product.is_brand_locked && data.recommended_product.trade_name && (
            <p className="text-[10px] text-amber-800 italic mt-2">
              Farmer cannot substitute — repeat this exact brand name to them.
            </p>
          )}
        </div>
      )}

      {/* Signature context so the RM knows WHY this variant was picked. */}
      {data.signature_chips.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Farmer&apos;s package signature
          </p>
          <div className="flex flex-wrap gap-1">
            {data.signature_chips.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 rounded-full text-[10px]">
                <span className="text-slate-500">{c.parameter_name}:</span>
                <span className="font-semibold text-slate-700">{c.variable_name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Elements — the recommendation body (dosage, method, etc). */}
      {data.elements.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Recommendation details
          </p>
          <ul className="space-y-1">
            {data.elements.map((el, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-500 min-w-[140px]">
                  {ELEMENT_LABELS[el.element_type] || el.element_type.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="text-slate-800">
                  {el.value || '—'}
                  {el.unit && <span className="text-slate-500"> {el.unit}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* NPK recommendation — ranked Mixed + enabled Straights. */}
      {data.npk_recommendation && !data.npk_recommendation.error && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            NPK dosage (farmer sees this on Brands screen)
          </p>
          <p className="text-slate-700 mb-2">
            Required per {data.npk_recommendation.fertigation ? 'application' : 'dose'}:
            {' '}<strong>N {data.npk_recommendation.required_dose.n} · P {data.npk_recommendation.required_dose.p} · K {data.npk_recommendation.required_dose.k} kg</strong>
          </p>
          {data.npk_recommendation.ranked_mixed.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] text-slate-500 font-semibold mb-0.5">Ranked mixed options</p>
              <ul className="space-y-0.5 ml-3 list-disc marker:text-slate-400">
                {data.npk_recommendation.ranked_mixed.slice(0, 5).map((m, i) => (
                  <li key={i} className="text-slate-700">
                    <strong>{m.name}</strong>
                    <span className="text-slate-500"> · N{m.n} P{m.p} K{m.k} · ~{m.kg_product} kg/dose · matches {m.match_target}</span>
                    {!m.has_brands && <span className="text-amber-600 italic text-[10px]"> · no retail brand found</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.npk_recommendation.enabled_straights.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 font-semibold mb-0.5">Enabled straights</p>
              <ul className="space-y-0.5 ml-3 list-disc marker:text-slate-400">
                {data.npk_recommendation.enabled_straights.map((s, i) => (
                  <li key={i} className="text-slate-700">
                    <strong>{s.name}</strong>
                    <span className="text-slate-500"> · {s.class} · N{s.n} P{s.p} K{s.k}</span>
                    {s.kg_product_needed != null && <span className="text-slate-500"> · ~{s.kg_product_needed} kg</span>}
                    {!s.has_brands && <span className="text-amber-600 italic text-[10px]"> · no retail brand found</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {data.npk_recommendation?.error && (
        <p className="text-red-600 italic">NPK recommendation could not be resolved.</p>
      )}

      {/* Chemical brand candidates — reuses the farmer's Brands screen. */}
      {data.brand_candidates && !data.brand_candidates.error && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Brand options {data.brand_candidates.is_locked && <span className="text-amber-700">(locked by company)</span>}
          </p>
          {data.brand_candidates.brands.length === 0 ? (
            <p className="text-slate-500 italic">No brands available in the farmer&apos;s catalogue.</p>
          ) : (
            <ul className="space-y-0.5 ml-3 list-disc marker:text-slate-400">
              {data.brand_candidates.brands.slice(0, 20).map((b, i) => (
                <li key={i} className="text-slate-700">
                  <strong>{b.name}</strong>
                  {b.manufacturer && <span className="text-slate-500"> · {b.manufacturer}</span>}
                </li>
              ))}
              {data.brand_candidates.brands.length > 20 && (
                <li className="text-slate-500 italic">… and {data.brand_candidates.brands.length - 20} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* AND/OR leg view + per-leg ack state. */}
      {data.relation && data.relation.siblings.length > 1 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
            Grouped with {data.relation.siblings.length - 1} other practice{data.relation.siblings.length === 2 ? '' : 's'} ({data.relation.relation_type || 'relation'})
          </p>
          <ul className="space-y-1">
            {data.relation.siblings.map(leg => {
              const ack = legAckLabel(leg)
              return (
                <li key={leg.practice_id}
                  className={`flex items-center justify-between gap-3 px-2 py-1 rounded ${leg.is_self ? 'bg-slate-200' : 'bg-white border border-slate-200'}`}>
                  <span className="text-slate-800">
                    {leg.l2_name || leg.l2_type}
                    {leg.is_self && <span className="ml-1 text-[9px] text-slate-500 uppercase">(this one)</span>}
                  </span>
                  <span className={`text-[10px] ${ack.cls}`}>{ack.text}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Media footer — count only, no playback. */}
      {totalMedia > 0 && (
        <p className="text-slate-500 italic border-t border-slate-200 pt-2">
          Farmer sees{' '}
          {m.photos > 0 && <span>📷 {m.photos} photo{m.photos === 1 ? '' : 's'}</span>}
          {m.photos > 0 && (m.audios > 0 || m.hyperlinks > 0) && ' · '}
          {m.audios > 0 && <span>🎵 {m.audios} audio{m.audios === 1 ? '' : 's'}</span>}
          {m.audios > 0 && m.hyperlinks > 0 && ' · '}
          {m.hyperlinks > 0 && <span>🔗 {m.hyperlinks} link{m.hyperlinks === 1 ? '' : 's'}</span>}
          {' '}on this practice (not shown here).
        </p>
      )}
    </div>
  )
}
