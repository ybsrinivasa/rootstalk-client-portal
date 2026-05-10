'use client'
import { useEffect, useState, useMemo, Suspense, FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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

  const openCreate = () => {
    setForm({
      problem_group_cosh_id: pgFilter || '',
      area_or_plant: (apFilter as 'AREA_WISE' | 'PLANT_WISE') || 'AREA_WISE',
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
      setGlobals(data.filter(g => g.status === 'ACTIVE'))
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
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
      const code = (detail as { code?: string })?.code
      if (code === 'import_would_overwrite') {
        setImportError(
          `${msg} (V1 doesn't surface a 'force overwrite' button — open the existing local copy and edit it instead.)`,
        )
      } else {
        setImportError(msg || 'Failed to import.')
      }
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
          <h1 className="text-2xl font-bold text-slate-900">Recommendations</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            One row per (Problem × bundle). Each is its own DRAFT/ACTIVE lifecycle.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={openImport}
            className="border text-sm font-medium px-4 py-2.5 rounded-xl"
            style={{ borderColor: colour, color: colour }}>
            ↓ Import from Global
          </button>
          <button onClick={openCreate}
            className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            + New Recommendation
          </button>
        </div>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : recs.length === 0 ? (
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
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recs.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/cha/timelines?pg=${encodeURIComponent(r.problem_group_cosh_id)}&rec=${encodeURIComponent(r.id)}`}
                      className="font-medium text-slate-800 hover:text-green-700">
                      {r.problem_group_name_en}
                    </Link>
                    <span className="text-xs text-slate-400 ml-2">v{r.version}</span>
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
                  <td className="px-5 py-3.5 text-right">
                    {r.status === 'DRAFT' && (
                      <button onClick={() => openPublish(r)}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg border"
                        style={{ borderColor: colour, color: colour }}>
                        ✓ Publish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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
                Get a copy of an ACTIVE global PG recommendation. Each bundle
                (area-wise / plant-wise) imports into its own local row.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingGlobals ? (
                <p className="text-center text-slate-400 text-sm py-8">Loading global library…</p>
              ) : globals.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8">
                  No active global PG recommendations yet. Ask your RootsTalk admin to publish some.
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
                      {alreadyImported ? (
                        <span className="text-xs text-green-600 font-medium">✓ Imported</span>
                      ) : (
                        <button onClick={() => doImport(g.id)}
                          disabled={importing === g.id}
                          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ background: colour }}>
                          {importing === g.id ? 'Importing…' : 'Import'}
                        </button>
                      )}
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
