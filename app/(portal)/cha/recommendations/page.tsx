'use client'
import { useEffect, useState, useMemo, Suspense, FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface ChaRec {
  id: string
  problem_group_cosh_id: string
  problem_group_name_en: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  imported_from_global_at: string | null
  timeline_count: number
  created_at: string
}

interface ChaProblem {
  cosh_id: string
  name_en: string
}

interface GlobalPG {
  id: string
  problem_group_cosh_id: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  status: string
  version: number
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function ChaRecsContent() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'
  const params = useSearchParams()
  const router = useRouter()
  const pgFilter = params.get('pg') || ''
  const apFilter = params.get('ap') || ''
  const statusFilter = params.get('status') || ''

  const [recs, setRecs] = useState<ChaRec[]>([])
  const [problems, setProblems] = useState<ChaProblem[]>([])
  const [loading, setLoading] = useState(true)

  // Create
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [form, setForm] = useState({
    problem_group_cosh_id: '',
    area_or_plant: 'AREA_WISE' as 'AREA_WISE' | 'PLANT_WISE',
  })

  // Import
  const [showImport, setShowImport] = useState(false)
  const [globals, setGlobals] = useState<GlobalPG[]>([])
  const [loadingGlobals, setLoadingGlobals] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importError, setImportError] = useState('')

  // One-click bundle creation (2026-05-21) — replaces the old modal
  // when the SE clicks "+ Add Recommendations" on a bundle card. The
  // bundle type comes from the card itself; PG cosh_id from the URL.
  // Per-bundle error so a failure on one card doesn't blank both.
  const [bundleBusy, setBundleBusy] = useState<'AREA_WISE' | 'PLANT_WISE' | null>(null)
  const [bundleError, setBundleError] = useState<Record<string, string>>({})

  // Publish
  const [publishTarget, setPublishTarget] = useState<ChaRec | null>(null)
  const [publishReadiness, setPublishReadiness] = useState<{
    ready: boolean
    status: string
    version: number
    blocker_code?: string
    missing?: { code: string; message: string }[]
  } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')

  const load = async () => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (pgFilter) qs.set('problem_group_cosh_id', pgFilter)
    if (apFilter) qs.set('area_or_plant', apFilter)
    if (statusFilter) qs.set('status', statusFilter)
    try {
      const [{ data: recsData }, { data: pbms }] = await Promise.all([
        api.get<ChaRec[]>(`/client/${clientId}/cha/recommendations?${qs.toString()}`),
        api.get<ChaProblem[]>(`/client/${clientId}/cha/problems`),
      ])
      setRecs(recsData)
      setProblems(pbms)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [clientId, pgFilter, apFilter, statusFilter])

  // Batch T (2026-05-18) — collapse the list to one row per
  // (problem_group × bundle) lineage. Head precedence: DRAFT > ACTIVE
  // > most recent INACTIVE. Hides historical INACTIVE rows from the
  // list entirely (they're accessible from the detail page's Version
  // History disclosure). Net effect: at most two rows per PG —
  // one for Area-wise, one for Plant-wise.
  const collapsedRecs = useMemo(() => {
    const STATUS_RANK: Record<string, number> = { DRAFT: 0, ACTIVE: 1, INACTIVE: 2 }
    const byLineage = new Map<string, ChaRec>()
    for (const r of recs) {
      const key = `${r.problem_group_cosh_id}::${r.area_or_plant ?? ''}`
      const cur = byLineage.get(key)
      if (!cur) { byLineage.set(key, r); continue }
      const a = STATUS_RANK[r.status] ?? 99
      const b = STATUS_RANK[cur.status] ?? 99
      if (a < b) { byLineage.set(key, r); continue }
      if (a === b) {
        // Same status — pick the most recently created.
        if (new Date(r.created_at) > new Date(cur.created_at)) {
          byLineage.set(key, r)
        }
      }
    }
    return Array.from(byLineage.values())
  }, [recs])

  // 2026-05-22 — version count per lineage; surfaced as "· N versions"
  // next to vN so the SE knows older versions exist behind the head
  // (reachable via the detail page's Version History disclosure).
  const versionCountByLineage = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of recs) {
      const key = `${r.problem_group_cosh_id}::${r.area_or_plant ?? ''}`
      m.set(key, (m.get(key) || 0) + 1)
    }
    return m
  }, [recs])

  // When filtered to a single PG, the title at the top should name
  // it clearly so the SE knows which PG's bundles they're seeing.
  const filteredPgName = useMemo(() => {
    if (!pgFilter) return ''
    return problems.find(p => p.cosh_id === pgFilter)?.name_en || ''
  }, [pgFilter, problems])

  // Bundle-card "+ Add Recommendations" — skip the create modal
  // entirely. Bundle type is implicit in the card; PG cosh_id is in
  // the URL filter. Create the DRAFT and route straight to its
  // timelines page. Race-safe: if a rec already exists in this
  // (client, pg, bundle) lineage, refetch + route to it instead.
  async function createBundleAndGo(bundle: 'AREA_WISE' | 'PLANT_WISE') {
    if (!clientId || !pgFilter) return
    setBundleBusy(bundle)
    setBundleError(e => ({ ...e, [bundle]: '' }))
    try {
      const { data } = await api.post<ChaRec>(
        `/client/${clientId}/pg-recommendations`,
        { problem_group_cosh_id: pgFilter, area_or_plant: bundle },
      )
      router.push(`/cha/recommendations/${data.id}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const code = (detail as { code?: string })?.code
      if (code === 'bundle_already_exists') {
        try {
          const { data } = await api.get<ChaRec[]>(`/client/${clientId}/pg-recommendations`)
          const existing = data.find(
            r => r.problem_group_cosh_id === pgFilter && r.area_or_plant === bundle,
          )
          if (existing) {
            router.push(`/cha/recommendations/${existing.id}`)
            return
          }
        } catch { /* fall through to surfaced error */ }
        setBundleError(e => ({ ...e, [bundle]: 'A bundle already exists for this combination. Refresh the page to see it.' }))
      } else {
        const msg = typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
        setBundleError(e => ({ ...e, [bundle]: msg || 'Failed to create recommendation.' }))
      }
    } finally {
      setBundleBusy(null)
    }
  }

  const openCreate = (preselectBundle?: 'AREA_WISE' | 'PLANT_WISE') => {
    setForm({
      problem_group_cosh_id: pgFilter || '',
      area_or_plant:
        preselectBundle
        || (apFilter as 'AREA_WISE' | 'PLANT_WISE')
        || 'AREA_WISE',
    })
    setCreateError('')
    setShowCreate(true)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!clientId || !form.problem_group_cosh_id) return
    setCreating(true); setCreateError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations`, {
        problem_group_cosh_id: form.problem_group_cosh_id,
        area_or_plant: form.area_or_plant,
      })
      setShowCreate(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
      const code = (detail as { code?: string })?.code
      if (code === 'bundle_already_exists') {
        setCreateError(`${msg} Open the existing bundle from the table below.`)
      } else {
        setCreateError(msg || 'Failed to create recommendation.')
      }
    } finally {
      setCreating(false)
    }
  }

  const openImport = async () => {
    setShowImport(true); setImportError(''); setLoadingGlobals(true)
    try {
      const { data } = await api.get<GlobalPG[]>('/advisory/global/pg-recommendations')
      // When in PG-context (came from /cha/problems → a PG), only
      // show globals for that PG. Otherwise show every active global.
      setGlobals(
        data.filter(g =>
          g.status === 'ACTIVE'
          && (!pgFilter || g.problem_group_cosh_id === pgFilter)
        )
      )
    } catch {
      setGlobals([])
    } finally {
      setLoadingGlobals(false)
    }
  }

  const doImport = async (globalId: string) => {
    if (!clientId) return
    setImporting(globalId); setImportError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/import/${globalId}`)
      setShowImport(false)
      await load()
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { detail?: unknown } } })?.response
      const detail = res?.data?.detail as { code?: string; message?: string } | string | undefined
      // Batch T (2026-05-18) — backend 409s with `draft_exists_confirm_overwrite`
      // when a DRAFT is already in flight. Ask SE whether to replace
      // and retry with overwrite=true.
      if (res?.status === 409 && typeof detail === 'object' && detail.code === 'draft_exists_confirm_overwrite') {
        const ok = confirm(
          'A draft already exists for this problem group and bundle. ' +
          'Importing again will replace the draft\'s contents with the ' +
          'imported version. Continue?',
        )
        if (!ok) { setImporting(null); return }
        try {
          await api.post(`/client/${clientId}/pg-recommendations/import/${globalId}?overwrite=true`)
          setShowImport(false)
          await load()
        } catch (err2: unknown) {
          const d2 = (err2 as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
          const m2 = typeof d2 === 'string' ? d2 : (d2 as { message?: string })?.message
          setImportError(m2 || 'Failed to import.')
        } finally {
          setImporting(null)
        }
        return
      }
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setImportError(msg || 'Failed to import.')
    } finally {
      setImporting(null)
    }
  }

  const openPublish = async (rec: ChaRec) => {
    setPublishTarget(rec); setPublishError(''); setPublishReadiness(null)
    try {
      const { data } = await api.get(
        `/client/${clientId}/pg-recommendations/${rec.id}/publish-readiness`,
      )
      setPublishReadiness(data)
    } catch {
      setPublishReadiness(null)
    }
  }

  async function handlePublish() {
    if (!publishTarget || !clientId) return
    setPublishing(true); setPublishError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/${publishTarget.id}/publish`)
      setPublishTarget(null)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
      setPublishError(msg || 'Failed to publish.')
      // Re-fetch readiness — server may have surfaced a new gate.
      try {
        const { data } = await api.get(
          `/client/${clientId}/pg-recommendations/${publishTarget.id}/publish-readiness`,
        )
        setPublishReadiness(data)
      } catch { /* keep old state */ }
    } finally {
      setPublishing(false)
    }
  }

  const problemNameById = useMemo(
    () => Object.fromEntries(problems.map(p => [p.cosh_id, p.name_en])),
    [problems],
  )

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (pgFilter) {
      const friendly = recs[0]?.problem_group_name_en || pgFilter
      out.push({ key: 'pg', label: `Problem: ${friendly}` })
    }
    if (apFilter) {
      out.push({ key: 'ap', label: `Bundle: ${apFilter === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'}` })
    }
    if (statusFilter) {
      out.push({ key: 'status', label: `Status: ${statusFilter}` })
    }
    return out
  }, [pgFilter, apFilter, statusFilter, recs])

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {filteredPgName ? (
            <>
              <div className="flex items-center gap-3 mb-1">
                <Link href="/cha/problems"
                  className="text-slate-400 hover:text-slate-600"
                  title="Back to Problems">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">{filteredPgName}</h1>
              </div>
              <p className="text-slate-500 text-sm mt-0.5">
                Up to two bundles — one for Area-wise crops, one for Plant-wise.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-900">Recommendations</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                One row per (Problem × bundle). Each is its own DRAFT/ACTIVE lifecycle.
              </p>
            </>
          )}
        </div>
        {/* Top-right pair only on the unfiltered list view. When a PG
            is selected, the per-bundle cards below carry equivalent
            affordances — the top-right pair would be redundant
            (and confusing now that bundle creation is one-click). */}
        {!pgFilter && (
          <div className="flex gap-2">
            <button onClick={openImport}
              className="border text-sm font-medium px-4 py-2.5 rounded-xl"
              style={{ borderColor: colour, color: colour }}>
              ↓ Import from Global
            </button>
            <button onClick={() => openCreate()}
              className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              + New Recommendation
            </button>
          </div>
        )}
      </div>

      {/* Filter chips are redundant when the page is already filtered
          to a single PG — the heading above names it. Show chips only
          on the unfiltered (admin / direct-URL) view. */}
      {!pgFilter && <FilterChips chips={chips} />}

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : pgFilter ? (
        // Batch T (2026-05-18) — bundle-cards layout for the
        // single-PG view. Two side-by-side cards (Area-wise +
        // Plant-wise) make the bifurcation obvious; filled bundles
        // show metadata + Open link, empty bundles show a "Start"
        // CTA. Publish is intentionally NOT on this page — it lives
        // on the detail page next to Preview.
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['AREA_WISE', 'PLANT_WISE'] as const).map(bundle => {
            const rec = collapsedRecs.find(r => r.area_or_plant === bundle)
            const bundleLabel = bundle === 'AREA_WISE'
              ? 'Recommendations for Area-wise Crops'
              : 'Recommendations for Plant-wise Crops'
            const bundleIcon = bundle === 'AREA_WISE' ? '🟧' : '🟪'
            if (!rec) {
              return (
                <div key={bundle}
                  className="bg-white rounded-2xl border border-dashed border-slate-200 p-6 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{bundleIcon}</span>
                    <h3 className="font-semibold text-slate-800">{bundleLabel}</h3>
                  </div>
                  <p className="text-slate-400 text-sm mb-6">Not started</p>
                  <div className="mt-auto flex flex-col gap-2">
                    <button onClick={() => createBundleAndGo(bundle)}
                      disabled={bundleBusy === bundle}
                      className="text-sm font-semibold px-4 py-2.5 rounded-xl border text-white disabled:opacity-50"
                      style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                      {bundleBusy === bundle ? 'Starting…' : '+ Add Recommendations'}
                    </button>
                    <button onClick={openImport}
                      className="text-sm font-medium px-4 py-2 rounded-xl border"
                      style={{ borderColor: colour, color: colour }}>
                      ↓ Import from Global
                    </button>
                  </div>
                  {bundleError[bundle] && (
                    <p className="text-xs text-red-600 mt-2">{bundleError[bundle]}</p>
                  )}
                </div>
              )
            }
            return (
              <Link key={bundle} href={`/cha/recommendations/${encodeURIComponent(rec.id)}`}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 hover:border-slate-300 hover:shadow-md transition group">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{bundleIcon}</span>
                  <h3 className="font-semibold text-slate-800">{bundleLabel}</h3>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[rec.status]}`}>
                    {rec.status}
                  </span>
                  <span className="text-xs text-slate-500">v{rec.version}</span>
                  {(() => {
                    const key = `${rec.problem_group_cosh_id}::${rec.area_or_plant ?? ''}`
                    const count = versionCountByLineage.get(key) || 1
                    if (count <= 1) return null
                    return (
                      <span className="text-xs text-slate-400">· {count} versions</span>
                    )
                  })()}
                </div>
                <dl className="text-sm text-slate-600 space-y-1 mb-4">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Source</dt>
                    <dd>{rec.imported_from_global_at ? 'Imported from Global' : 'Authored from scratch'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Timelines</dt>
                    <dd>{rec.timeline_count}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">Created</dt>
                    <dd>{new Date(rec.created_at).toLocaleDateString()}</dd>
                  </div>
                </dl>
                <div className="text-sm font-medium group-hover:underline"
                  style={{ color: colour }}>
                  Open Recommendations →
                </div>
              </Link>
            )
          })}
        </div>
      ) : collapsedRecs.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📋</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No recommendations match the active filters.' : 'No recommendations yet.'}
          </p>
          {chips.length === 0 && (
            <p className="text-slate-400 text-sm mt-1">
              Pick a <Link href="/cha/problems" className="text-green-700 hover:underline">Problem</Link> to start authoring its first bundle.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Problem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bundle</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Source</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Timelines</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {collapsedRecs.map(r => {
                const key = `${r.problem_group_cosh_id}::${r.area_or_plant ?? ''}`
                const count = versionCountByLineage.get(key) || 1
                return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cha/recommendations/${encodeURIComponent(r.id)}`}
                      className="font-medium text-slate-800 hover:text-green-700">
                      {r.problem_group_name_en}
                    </Link>
                    <span className="text-xs text-slate-400 ml-2">v{r.version}</span>
                    {count > 1 && (
                      <span className="text-xs text-slate-400 ml-1.5">· {count} versions</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 text-xs">
                    {r.area_or_plant === 'AREA_WISE' ? 'Area-wise' :
                     r.area_or_plant === 'PLANT_WISE' ? 'Plant-wise' : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell text-xs">
                    {r.imported_from_global_at ? 'imported' : 'authored from scratch'}
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600 hidden md:table-cell text-xs">
                    <Link
                      href={`/cha/timelines?pg=${encodeURIComponent(r.problem_group_cosh_id)}&rec=${encodeURIComponent(r.id)}`}
                      className="hover:text-green-700">
                      {r.timeline_count}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden lg:table-cell text-xs">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Recommendation modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">New Recommendation</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Author from scratch. Pick the Problem and which side
                (area-wise / plant-wise crops). Each bundle has its own
                lifecycle.
              </p>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Problem Group</label>
                <select value={form.problem_group_cosh_id}
                  onChange={e => setForm(f => ({ ...f, problem_group_cosh_id: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                  <option value="">Pick a problem group…</option>
                  {problems.map(p => (
                    <option key={p.cosh_id} value={p.cosh_id}>{p.name_en}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  V1 list. When Cosh ships the <code className="font-mono">problem_group</code> Connect, more will appear here.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Bundle</label>
                <div className="flex gap-3">
                  {(['AREA_WISE', 'PLANT_WISE'] as const).map(v => (
                    <label key={v} className="flex-1">
                      <input type="radio" name="ap"
                        checked={form.area_or_plant === v}
                        onChange={() => setForm(f => ({ ...f, area_or_plant: v }))}
                        className="sr-only peer" />
                      <span className="block px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-center cursor-pointer peer-checked:border-green-500 peer-checked:bg-green-50 peer-checked:text-green-700 hover:bg-slate-50">
                        {v === 'AREA_WISE' ? 'Area-wise crops' : 'Plant-wise crops'}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Each side is a separate bundle of timelines and practices.
                </p>
              </div>

              {createError && <p className="text-sm text-red-600">{createError}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowCreate(false); setCreateError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit"
                  disabled={creating || !form.problem_group_cosh_id}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {creating ? 'Creating…' : 'Create Recommendation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish confirmation modal — gate panel + confirmation in one */}
      {publishTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                Publish {publishTarget.problem_group_name_en}?
              </h2>
              <p className="text-slate-500 text-sm mt-1.5">
                {publishTarget.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'} bundle
                {publishTarget.version > 0 ? ` will become v${publishTarget.version + 1}` : ''}.
              </p>
            </div>
            <div className="p-6 space-y-3">
              {!publishReadiness ? (
                <p className="text-sm text-slate-400">Checking readiness…</p>
              ) : publishReadiness.ready ? (
                <div className="rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-800 flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>Ready to publish — every gate is clear.</span>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-900">
                  <p className="font-medium mb-2 flex items-start gap-2">
                    <span className="text-amber-600">⚠</span>
                    {(publishReadiness.missing?.length || 0) === 1
                      ? '1 thing to fix before publishing'
                      : `${publishReadiness.missing?.length || 0} things to fix before publishing`}
                  </p>
                  <ul className="space-y-1.5 ml-6">
                    {(publishReadiness.missing || []).map((m, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5 text-xs">●</span>
                        <span>{m.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {publishError && <p className="text-sm text-red-600">{publishError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => { setPublishTarget(null); setPublishError('') }}
                disabled={publishing}
                className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handlePublish}
                disabled={publishing || !publishReadiness?.ready}
                title={!publishReadiness?.ready ? 'Resolve the items above first' : ''}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {publishing ? 'Publishing…' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import from Global modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Import from Global CHA Library</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Pick a Global PG to bring into your company. Each import creates
                a new draft version for you to review.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {/* Multi-version explainer — shown above the picker so the
                  SE knows what happens. Per user 2026-05-18. */}
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-900 leading-relaxed">
                <strong>How import works:</strong> Each import creates a new draft version.
                Review it carefully, then publish it to make it live. Farmers
                continue seeing the currently-published version until you publish
                the new one. You can revert to any older version whenever you
                wish — open it from the version history and click <em>Make editable</em>.
                If a draft already exists from an earlier import, this new import
                will replace it (the earlier draft moves to <em>inactive</em>).
              </div>
              {loadingGlobals ? (
                <p className="text-center text-slate-400 text-sm py-8">Loading global library…</p>
              ) : globals.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8">
                  {pgFilter
                    ? `No active global recommendations for ${problemNameById[pgFilter] || pgFilter} yet. Ask your RootsTalk admin to publish one.`
                    : 'No active global PG recommendations yet. Ask your RootsTalk admin to publish some.'}
                </p>
              ) : (
                globals.map(g => {
                  const alreadyImported = recs.some(
                    r => r.problem_group_cosh_id === g.problem_group_cosh_id
                      && r.area_or_plant === g.area_or_plant,
                  )
                  return (
                    <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                      <div className="flex-1">
                        <p className="font-medium text-sm text-slate-800">
                          {problemNameById[g.problem_group_cosh_id] || g.problem_group_cosh_id}
                        </p>
                        <p className="text-xs text-slate-400">
                          {g.area_or_plant === 'AREA_WISE' ? 'Area-wise' :
                            g.area_or_plant === 'PLANT_WISE' ? 'Plant-wise' : 'unscoped'} ·
                          v{g.version} · {g.status.toLowerCase()}
                        </p>
                      </div>
                      {/* "✓ Imported" badge removed — re-import always
                          creates a new draft now, so showing "already
                          imported" is misleading. The Import button stays
                          enabled on every row. */}
                      <button onClick={() => doImport(g.id)}
                        disabled={importing === g.id}
                        className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: colour }}>
                        {importing === g.id ? 'Importing…' : alreadyImported ? 'Import (new version)' : 'Import'}
                      </button>
                    </div>
                  )
                })
              )}
              {importError && <p className="text-sm text-red-600 px-2">{importError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setShowImport(false)}
                className="w-full border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ChaRecsPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <ChaRecsContent />
    </Suspense>
  )
}
