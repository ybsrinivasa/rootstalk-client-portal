'use client'

// Batch 39V (2026-05-17) — CA-side QA Preview page.
//
// Mirror of Batches 39S/39T/39U Preview pages for the QA (StandardResponse)
// pipe. Read-only walkthrough of a question + its timeline/practice/
// element body — the same view a FarmPundit will see when they pick
// this Standard Response while answering a farmer's query.
//
// QA differs from CCA/PG/SP in two ways that shape this Preview:
//   1. No publish step — StandardResponse has no status/version
//      columns. So no "Ready to publish" panel, no version pill.
//   2. The QA timelines GET inlines practices + elements in one
//      payload (different from PG/SP where elements need a second
//      hop). One fewer parallel call.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface ElementOut {
  id: string
  element_type: string
  cosh_ref: string | null
  value: string | null
  unit_cosh_id: string | null
  display_order: number
  label?: string
  display_value?: string
}

interface PracticeOut {
  id: string
  timeline_id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null
  l2_type: string | null
  display_order: number
  is_special_input: boolean
  frequency_days: number | null
  elements: ElementOut[]
}

interface TimelineOut {
  id: string
  standard_response_id: string
  parent_kind: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  practices: PracticeOut[]
}

interface QaSr {
  id: string
  question_text: string
  crop_cosh_id: string | null
  crop_name_en: string | null
}

const L0_COLOUR: Record<string, string> = {
  INPUT: 'bg-blue-100 text-blue-700',
  NON_INPUT: 'bg-purple-100 text-purple-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700',
  MEDIA: 'bg-pink-100 text-pink-700',
}

function humanize(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export default function QAPreviewPage() {
  const params = useParams<{ srId: string }>()
  const srId = params?.srId
  const clientId = getClient()?.id

  const [sr, setSr] = useState<QaSr | null>(null)
  const [timelines, setTimelines] = useState<TimelineOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId || !srId) return
    let cancelled = false

    async function load() {
      try {
        const [srsRes, tlsRes] = await Promise.all([
          api.get<QaSr[]>(`/client/${clientId}/qa/standard-responses`),
          api.get<TimelineOut[]>(`/client/${clientId}/standard-responses/${srId}/timelines`),
        ])
        if (cancelled) return
        const found = srsRes.data.find(s => s.id === srId)
        if (!found) { setError('Entry not found'); return }
        setSr(found)
        setTimelines(
          tlsRes.data
            .slice()
            .sort((a, b) => a.from_value - b.from_value),
        )
      } catch (err: unknown) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Failed to load preview.'
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [clientId, srId])

  if (loading) {
    return <div className="p-8 text-slate-400 text-sm">Loading preview…</div>
  }
  if (error || !sr) {
    return (
      <div className="p-8">
        <p className="text-red-600 text-sm">{error || 'Standard response not found.'}</p>
        <Link href={`/standard-responses/${srId}`} className="text-blue-600 text-sm">← Back to editor</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <Link href={`/standard-responses/${srId}`}
          className="text-sm text-blue-600 hover:underline">← Back to editor</Link>
        <span className="text-xs text-slate-400 uppercase tracking-wide">Preview</span>
      </div>

      {/* SR header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-2">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-slate-900 flex-1">{sr.question_text}</h1>
          {sr.crop_cosh_id ? (
            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {sr.crop_name_en || '(crop)'}
            </span>
          ) : (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              Crop-agnostic
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          What a FarmPundit sees when picking this Standard Response while answering a farmer&apos;s query.
          Timelines below merge into the farmer&apos;s advisory, anchored at &ldquo;days after response delivered&rdquo;.
        </p>
      </div>

      {/* Timelines */}
      {timelines.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-slate-500 text-sm">No timelines on this Standard Response yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timelines.map(tl => (
            <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                <p className="font-semibold text-sm text-slate-800">{tl.name}</p>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  Day {tl.from_value} → {tl.to_value} after response
                </p>
              </div>
              {tl.practices.length === 0 ? (
                <p className="px-5 py-4 text-xs text-slate-400 italic">No practices in this timeline.</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {tl.practices
                    .slice()
                    .sort((a, b) => a.display_order - b.display_order)
                    .map(p => (
                    <li key={p.id} className="px-5 py-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${L0_COLOUR[p.l0_type] || 'bg-slate-100'}`}>
                          {p.l0_type}
                        </span>
                        <span className="text-sm text-slate-700">
                          {[p.l1_type, p.l2_type].filter(Boolean).map(humanize).join(' › ') || (
                            <span className="text-slate-400 italic">No sub-type</span>
                          )}
                        </span>
                        {p.is_special_input && (
                          <span className="text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                            Special
                          </span>
                        )}
                        {p.frequency_days != null && (
                          <span className="text-[10px] text-slate-500 px-1.5 py-0.5 bg-slate-50 rounded-full">
                            every {p.frequency_days}d
                          </span>
                        )}
                      </div>
                      {(p.elements && p.elements.length > 0) && (
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 pl-1 text-xs">
                          {p.elements.map((e, i) => {
                            const label = e.label || humanize(e.element_type)
                            const value = e.display_value ?? e.value ?? ''
                            return (
                              <div key={e.id || i} className="flex gap-2">
                                <dt className="text-slate-500 shrink-0">{label}:</dt>
                                <dd className={value ? 'text-slate-700 font-medium' : 'text-slate-400 italic'}>
                                  {value || '—'}
                                </dd>
                              </div>
                            )
                          })}
                        </dl>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
