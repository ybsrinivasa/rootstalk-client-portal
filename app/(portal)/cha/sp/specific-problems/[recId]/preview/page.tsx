'use client'

// Batch 39U (2026-05-17) — CA-side CHA-SP Preview page.
//
// Mirror of Batch 39T's PG Preview for the SP pipe. Read-only
// walkthrough of a Local SP recommendation's authoring state so
// the SE can verify the timeline structure + practice elements
// before hitting Publish. Composes from existing endpoints; no
// new backend.
//
// V1 scope: SP header (specific-problem name, crop name, status,
// version) + Timelines (sorted by from_value) + Practices with
// element label / value / unit detail. No bundle dimension —
// SP recommendations don't carry area_or_plant (the crop already
// implies the typing; see SPRecommendation model docstring).
//
// Out of scope for V1: Relations and Conditional Questions cards.
// Same rationale as 39S/39T — defer the chain-walker port until
// SEs ask for it on the CHA-SP side.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface SP {
  id: string
  specific_problem_cosh_id: string
  client_id: string
  crop_cosh_id: string | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

interface Timeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
}

interface ElementRow {
  id?: string
  element_type: string
  label?: string
  value: string | null
  cosh_ref?: string | null
  display_value?: string
}

interface Practice {
  id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null
  l2_type: string | null
  display_order: number
  is_special_input: boolean
  is_brand_locked?: boolean
  frequency_days?: number | null
  elements?: ElementRow[]
}

interface SpProblem {
  cosh_id: string
  name_en: string
}

interface EligibleCrop {
  crop_cosh_id: string
  name_en: string
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
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

export default function SPPreviewPage() {
  const params = useParams<{ recId: string }>()
  const recId = params.recId
  const clientId = getClient()?.id

  const [sp, setSp] = useState<SP | null>(null)
  const [problemName, setProblemName] = useState('')
  const [cropName, setCropName] = useState('')
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [practicesByTimeline, setPracticesByTimeline] = useState<Record<string, Practice[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    async function load() {
      try {
        const [spRes, tlRes, cropsRes] = await Promise.all([
          api.get<SP>(`/client/${clientId}/sp-recommendations/${recId}`),
          api.get<Timeline[]>(`/client/${clientId}/sp-recommendations/${recId}/timelines`),
          api.get<EligibleCrop[]>(`/client/${clientId}/cha-sp/eligible-crops`).catch(() => ({ data: [] })),
        ])
        if (cancelled) return
        setSp(spRes.data)

        const cropMatch = cropsRes.data.find(c => c.crop_cosh_id === spRes.data.crop_cosh_id)
        if (cropMatch) setCropName(cropMatch.name_en)

        if (spRes.data.crop_cosh_id) {
          try {
            const { data: probs } = await api.get<SpProblem[]>(
              `/client/${clientId}/cha-sp/specific-problems?crop_cosh_id=${encodeURIComponent(spRes.data.crop_cosh_id)}`,
            )
            const match = probs.find(p => p.cosh_id === spRes.data.specific_problem_cosh_id)
            if (match) setProblemName(match.name_en)
          } catch { /* non-fatal */ }
        }

        const sortedTls = tlRes.data
          .slice()
          .sort((a, b) => a.from_value - b.from_value)
        setTimelines(sortedTls)

        const pracMap: Record<string, Practice[]> = {}
        await Promise.all(sortedTls.map(async tl => {
          try {
            const { data } = await api.get<Practice[]>(
              `/client/${clientId}/timelines/${tl.id}/practices`,
            )
            pracMap[tl.id] = data.sort((a, b) => a.display_order - b.display_order)
          } catch {
            pracMap[tl.id] = []
          }
        }))
        if (cancelled) return
        setPracticesByTimeline(pracMap)
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
  }, [clientId, recId])

  if (loading) {
    return <div className="p-8 text-slate-400 text-sm">Loading preview…</div>
  }
  if (error || !sp) {
    return (
      <div className="p-8">
        <p className="text-red-600 text-sm">{error || 'Recommendation not found.'}</p>
        <Link href={`/cha/sp/specific-problems/${recId}`} className="text-blue-600 text-sm">← Back to editor</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <Link href={`/cha/sp/specific-problems/${recId}`}
          className="text-sm text-blue-600 hover:underline">← Back to editor</Link>
        <span className="text-xs text-slate-400 uppercase tracking-wide">Preview</span>
      </div>

      {/* SP header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900">{problemName || '(loading…)'}</h1>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[sp.status] || 'bg-slate-100 text-slate-600'}`}>
            {sp.status}
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-900 text-white">
            v{sp.version}
          </span>
          <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-100 rounded-full">
            {cropName || '(no crop set)'}
          </span>
        </div>
      </div>

      {/* Timelines */}
      {timelines.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-slate-500 text-sm">No timelines on this recommendation yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timelines.map(tl => {
            const practices = practicesByTimeline[tl.id] || []
            return (
              <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                  <p className="font-semibold text-sm text-slate-800">{tl.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    {tl.from_value}–{tl.to_value} days after detection
                  </p>
                </div>
                {practices.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-slate-400 italic">No practices in this timeline.</p>
                ) : (
                  <ul className="divide-y divide-slate-50">
                    {practices.map(p => (
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
                          {p.is_brand_locked && (
                            <span className="text-[10px] uppercase tracking-wide bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">
                              Brand-locked
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
            )
          })}
        </div>
      )}
    </div>
  )
}
