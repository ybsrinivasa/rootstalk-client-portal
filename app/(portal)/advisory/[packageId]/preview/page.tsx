'use client'

// Batch 39S (2026-05-17) — CA-side CCA Preview page.
//
// Read-only walkthrough of a Local Package's authoring state so the
// SE can verify the timeline structure + practice elements before
// hitting Publish. Composes from existing endpoints; no new backend.
//
// V1 scope: Package header (name, crop, status, version, locations,
// authors, parameter-variable fingerprint) + Timelines (active only,
// in display order) + Practices per timeline + Elements per practice
// with label / value / unit detail.
//
// Out of scope for V1: Relations and Conditional Questions card
// rendering. Those need the same chain-walker the SA Global Preview
// uses (`PreviewCards.tsx` in rootstalk-frontend); duplicating it
// here adds ~1500 LOC across three components. Adding that to CA
// Preview is a follow-up if SEs need it.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Package {
  id: string
  name: string
  crop_cosh_id: string
  package_type: 'ANNUAL' | 'PERENNIAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  duration_days: number
  version: number
  description: string | null
  start_date_label_cosh_id: string | null
}

interface Timeline {
  id: string
  name: string
  from_type: 'DBS' | 'DAS' | 'CALENDAR'
  from_value: number
  to_value: number
  display_order: number
  status?: 'ACTIVE' | 'INACTIVE'
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
  timeline_id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null
  l2_type: string | null
  display_order: number
  is_special_input: boolean
  is_brand_locked?: boolean
  frequency_days?: number | null
  elements?: ElementRow[]
}

interface Location {
  state_cosh_id: string
  district_cosh_id: string
}

interface Author {
  id: string
  user_id: string
  user_name: string
  designation: string | null
}

interface PackageVariable {
  parameter_id: string
  parameter_name?: string
  variable_id: string
  variable_name?: string
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

function formatTimelineRange(tl: Timeline): string {
  if (tl.from_type === 'CALENDAR') {
    return `DOY ${tl.from_value} → ${tl.to_value}`
  }
  return `Day ${tl.from_value} → ${tl.to_value}`
}

export default function CCAPreviewPage() {
  const params = useParams<{ packageId: string }>()
  const router = useRouter()
  const packageId = params.packageId
  const clientId = getClient()?.id

  const [pkg, setPkg] = useState<Package | null>(null)
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [practicesByTimeline, setPracticesByTimeline] = useState<Record<string, Practice[]>>({})
  const [locations, setLocations] = useState<Location[]>([])
  const [authors, setAuthors] = useState<Author[]>([])
  const [variables, setVariables] = useState<PackageVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clientId) return
    let cancelled = false

    async function load() {
      try {
        const [pkgRes, tlRes, locRes, authRes, varRes] = await Promise.all([
          api.get<Package>(`/client/${clientId}/packages/${packageId}`),
          api.get<Timeline[]>(`/client/${clientId}/packages/${packageId}/timelines`),
          api.get<Location[]>(`/client/${clientId}/packages/${packageId}/locations`).catch(() => ({ data: [] })),
          api.get<Author[]>(`/client/${clientId}/packages/${packageId}/authors`).catch(() => ({ data: [] })),
          api.get<PackageVariable[]>(`/client/${clientId}/packages/${packageId}/variables`).catch(() => ({ data: [] })),
        ])
        if (cancelled) return
        setPkg(pkgRes.data)
        const sortedTls = tlRes.data
          .filter(t => t.status !== 'INACTIVE')
          .sort((a, b) => a.display_order - b.display_order)
        setTimelines(sortedTls)
        setLocations(locRes.data)
        setAuthors(authRes.data)
        setVariables(varRes.data)

        // Per-timeline practices in parallel — read-only so no need
        // for the user to expand to see content.
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
  }, [clientId, packageId])

  if (loading) {
    return <div className="p-8 text-slate-400 text-sm">Loading preview…</div>
  }
  if (error || !pkg) {
    return (
      <div className="p-8">
        <p className="text-red-600 text-sm">{error || 'Package not found.'}</p>
        <Link href={`/advisory/${packageId}`} className="text-blue-600 text-sm">← Back to editor</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Top action bar */}
      <div className="flex items-center justify-between">
        <Link href={`/advisory/${packageId}`}
          className="text-sm text-blue-600 hover:underline">← Back to editor</Link>
        <span className="text-xs text-slate-400 uppercase tracking-wide">Preview</span>
      </div>

      {/* Package header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900">{pkg.name}</h1>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[pkg.status] || 'bg-slate-100 text-slate-600'}`}>
            {pkg.status}
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-900 text-white">
            v{pkg.version}
          </span>
          <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-100 rounded-full">
            {pkg.package_type} · {pkg.duration_days} days
          </span>
        </div>
        {pkg.description && (
          <p className="text-sm text-slate-600">{pkg.description}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm pt-2 border-t border-slate-100">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Locations</p>
            <p className="text-slate-700">
              {locations.length === 0
                ? <span className="text-slate-400 italic">none</span>
                : `${locations.length} district${locations.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Authors</p>
            {authors.length === 0
              ? <p className="text-slate-400 italic">none</p>
              : (
                <ul className="text-slate-700 space-y-0.5">
                  {authors.map(a => (
                    <li key={a.id}>
                      {a.user_name}
                      {a.designation && <span className="text-slate-400"> · {a.designation}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Parameters</p>
            {variables.length === 0
              ? <p className="text-slate-400 italic">none set</p>
              : (
                <ul className="text-slate-700 space-y-0.5">
                  {variables.map(v => (
                    <li key={v.parameter_id}>
                      <span className="text-slate-500">{v.parameter_name || v.parameter_id}:</span>{' '}
                      <span className="font-medium">{v.variable_name || v.variable_id}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      </div>

      {/* Timelines */}
      {timelines.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-slate-500 text-sm">No active timelines on this Package yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timelines.map(tl => {
            const practices = practicesByTimeline[tl.id] || []
            return (
              <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                  <p className="font-semibold text-sm text-slate-800">{tl.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {tl.from_type} · {formatTimelineRange(tl)}
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
