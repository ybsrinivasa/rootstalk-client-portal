'use client'

// CA-side QA Preview page.
//
// Read-only walkthrough of a question + its timeline/practice/element
// body — the same view a FarmPundit will see when they pick this
// Standard Response while answering a farmer's query.
//
// Carries the Publish gate. A DRAFT question is invisible to Pundits
// until the curator publishes it from this screen. Publish is
// one-time; subsequent edits propagate to the live ACTIVE row
// immediately, and the curator uses the Inactive toggle on the editor
// page as the hide-during-rewrite affordance. No version history.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

type SRStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

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
  status: SRStatus
}

const L0_COLOUR: Record<string, string> = {
  INPUT: 'bg-blue-100 text-blue-700',
  NON_INPUT: 'bg-purple-100 text-purple-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700',
  MEDIA: 'bg-pink-100 text-pink-700',
}

const STATUS_CHIP: Record<SRStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-amber-50 text-amber-700',
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
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [sr, setSr] = useState<QaSr | null>(null)
  const [timelines, setTimelines] = useState<TimelineOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showConfirm, setShowConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')

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

  async function handlePublish() {
    if (!clientId || !srId) return
    setPublishing(true); setPublishError('')
    try {
      const { data } = await api.post<QaSr>(
        `/client/${clientId}/standard-responses/${srId}/publish`,
      )
      setSr(s => s ? { ...s, status: data.status } : s)
      setShowConfirm(false)
    } catch (err: unknown) {
      setPublishError(extractErrorMessage(err, 'Failed to publish.'))
    } finally { setPublishing(false) }
  }

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

  const canPublish = sr.status === 'DRAFT'

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <Link href={`/standard-responses/${srId}`}
          className="text-sm text-blue-600 hover:underline">← Back to editor</Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 uppercase tracking-wide">Preview</span>
          {canPublish && (
            <button onClick={() => { setShowConfirm(true); setPublishError('') }}
              className="text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              Publish
            </button>
          )}
        </div>
      </div>

      {/* SR header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-2">
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-slate-900 flex-1">{sr.question_text}</h1>
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[sr.status] || STATUS_CHIP.DRAFT}`}>
            {sr.status?.toLowerCase() || 'draft'}
          </span>
          {sr.crop_cosh_id ? (
            <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {sr.crop_name_en || '(crop)'}
            </span>
          ) : (
            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
              Common to all crops
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

      {/* Publish confirmation */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Publish this question?</h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Once published, FarmPundits can pick this question when responding to a farmer&apos;s query
                and the timelines below will merge into the farmer&apos;s advisory.
              </p>
              <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
                <p className="font-medium">A few things to know:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Edits you make after publishing take effect immediately — there is no version history.</li>
                  <li>To hide the question while rewriting, set it to Inactive from the editor.</li>
                  <li>Publish is a one-time action — you won&apos;t see this button again.</li>
                </ul>
              </div>
              {publishError && <p className="text-sm text-red-600">{publishError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowConfirm(false); setPublishError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="button" onClick={handlePublish} disabled={publishing}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
