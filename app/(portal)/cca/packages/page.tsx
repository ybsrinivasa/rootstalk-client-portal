'use client'
import { useEffect, useState, useMemo, Suspense, FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface CcaPackage {
  id: string
  name: string
  crop_cosh_id: string
  crop_name_en: string
  package_type: 'ANNUAL' | 'PERENNIAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  duration_days: number
  description: string | null
  timeline_count: number
  location_count: number
  updated_at: string | null
  created_at: string
}

interface CcaCrop {
  crop_cosh_id: string
  name_en: string
}

interface GlobalPackage {
  id: string
  name: string
  crop_cosh_id: string
  package_type: string
  duration_days: number
  status: string
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

// Hardcoded for V1 — Cosh hasn't shipped the start-date-label Connect
// yet. When it does, replace with a /cca/start-date-labels fetch.
const START_DATE_LABELS = [
  { cosh_id: 'label:sowing_date', name: 'Sowing Date' },
  { cosh_id: 'label:planting_date', name: 'Planting Date' },
  { cosh_id: 'label:pruning_date', name: 'Pruning Date' },
]

function PackagesContent() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''
  const statusFilter = params.get('status') || ''

  const [packages, setPackages] = useState<CcaPackage[]>([])
  const [crops, setCrops] = useState<CcaCrop[]>([])
  const [loading, setLoading] = useState(true)

  // Create
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [form, setForm] = useState({
    name: '',
    crop_cosh_id: '',
    package_type: 'ANNUAL' as 'ANNUAL' | 'PERENNIAL',
    duration_days: '120',
    start_date_label_cosh_id: 'label:sowing_date',
    description: '',
  })

  // Pull from Library — SE-side refresh of a Global the CM has
  // already pushed. Variables retain "forking" naming for now to
  // minimise diff churn; semantically these track the pull flow.
  const [showImport, setShowImport] = useState(false)
  const [globals, setGlobals] = useState<GlobalPackage[]>([])
  const [loadingGlobals, setLoadingGlobals] = useState(false)
  const [forking, setForking] = useState<string | null>(null)
  const [forkError, setForkError] = useState('')

  const load = async () => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (cropFilter) qs.set('crop_cosh_id', cropFilter)
    if (statusFilter) qs.set('status', statusFilter)
    try {
      const [{ data: pkgs }, { data: cropsData }] = await Promise.all([
        api.get<CcaPackage[]>(`/client/${clientId}/cca/packages?${qs.toString()}`),
        api.get<CcaCrop[]>(`/client/${clientId}/cca/crops`),
      ])
      setPackages(pkgs)
      setCrops(cropsData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [clientId, cropFilter, statusFilter])

  const cropName = useMemo(() => {
    if (!cropFilter) return ''
    return crops.find(c => c.crop_cosh_id === cropFilter)?.name_en || cropFilter
  }, [cropFilter, crops])

  const chips: ActiveChip[] = useMemo(() => {
    const out: ActiveChip[] = []
    if (cropFilter) out.push({ key: 'crop', label: `Crop: ${cropName}` })
    if (statusFilter) out.push({ key: 'status', label: `Status: ${statusFilter}` })
    return out
  }, [cropFilter, statusFilter, cropName])

  const openCreate = () => {
    setForm({
      name: '',
      crop_cosh_id: cropFilter || '',  // pre-fill from chip if active
      package_type: 'ANNUAL',
      duration_days: '120',
      start_date_label_cosh_id: 'label:sowing_date',
      description: '',
    })
    setCreateError('')
    setShowCreate(true)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!clientId) return
    setCreating(true); setCreateError('')
    try {
      await api.post(`/client/${clientId}/packages`, {
        name: form.name.trim(),
        crop_cosh_id: form.crop_cosh_id,
        package_type: form.package_type,
        duration_days:
          form.package_type === 'PERENNIAL'
            ? null
            : parseInt(form.duration_days, 10),
        start_date_label_cosh_id: form.start_date_label_cosh_id,
        description: form.description.trim() || null,
      })
      setShowCreate(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
      setCreateError(msg || 'Failed to create package.')
    } finally {
      setCreating(false)
    }
  }

  const openImport = async () => {
    setShowImport(true); setForkError(''); setLoadingGlobals(true)
    try {
      const { data } = await api.get<GlobalPackage[]>('/advisory/global/packages')
      setGlobals(data.filter(g => g.status === 'ACTIVE'))
    } catch {
      setGlobals([])
    } finally {
      setLoadingGlobals(false)
    }
  }

  const doFork = async (globalId: string) => {
    if (!clientId) return
    setForking(globalId); setForkError('')
    try {
      // Locked 2026-05-11: /pull replaces /fork on the SE-side.
      // First contact (CM push) happens out of band from the SA
      // portal; subsequent versions are pulled here. The backend
      // returns 422 package_not_pushed_yet if the CM hasn't
      // pushed yet — surface that as a clear inline error.
      await api.post(`/client/${clientId}/packages/${globalId}/pull`)
      setShowImport(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const detailObj = detail as { code?: string; message?: string } | undefined
      const code = typeof detail === 'object' && detail ? detailObj?.code : undefined
      const msg =
        typeof detail === 'string'
          ? detail
          : code === 'package_not_pushed_yet'
            ? 'Not shared with your company yet. Ask your Content Manager to push it first.'
            : detailObj?.message
      setForkError(msg || 'Failed to pull.')
    } finally {
      setForking(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Packages</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Package of Practices — one per (crop, season, region). Click a row to open the editor.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={openImport}
            className="border text-sm font-medium px-4 py-2.5 rounded-xl"
            style={{ borderColor: colour, color: colour }}>
            ↓ Pull from Library
          </button>
          <button onClick={openCreate}
            disabled={crops.length === 0}
            className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}
            title={crops.length === 0 ? 'CA must add focus crops in Setup first' : ''}>
            + New Package
          </button>
        </div>
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">📋</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No packages match the active filters.' : 'No packages yet.'}
          </p>
          {chips.length === 0 && crops.length > 0 && (
            <p className="text-slate-400 text-sm mt-1">
              Click <strong>+ New Package</strong> to author one, or <strong>Import from Library</strong> to start from a template.
            </p>
          )}
          {crops.length === 0 && (
            <p className="text-slate-400 text-sm mt-1">
              No focus crops on the belt yet — ask the CA to add some in <Link href="/setup" className="text-green-700 hover:underline">Setup → Crops</Link>.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Crop</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Timelines</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Locations</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Last edited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {packages.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link href={`/advisory/${p.id}`} className="font-medium text-slate-800 hover:text-green-700">
                      {p.name}
                    </Link>
                    <span className="text-xs text-slate-400 ml-2">v{p.version}</span>
                    {p.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{p.description}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 text-xs">{p.crop_name_en}</td>
                  <td className="px-5 py-3.5 text-slate-500 hidden sm:table-cell text-xs capitalize">
                    {p.package_type.toLowerCase()} · {p.duration_days}d
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600 hidden md:table-cell text-xs">
                    <Link
                      href={`/cca/timelines?crop=${encodeURIComponent(p.crop_cosh_id)}&package=${encodeURIComponent(p.id)}`}
                      className="hover:text-green-700">
                      {p.timeline_count}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden md:table-cell text-xs">{p.location_count}</td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden lg:table-cell text-xs">
                    {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Package modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">New Package</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Define the crop, type, and duration. Locations / parameters / authors come next inside the editor.
              </p>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Package Name</label>
                <input value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="e.g. Tomato Kharif 2025"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Crop</label>
                <select value={form.crop_cosh_id}
                  onChange={e => setForm(f => ({ ...f, crop_cosh_id: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                  <option value="">Pick a crop…</option>
                  {crops.map(c => (
                    <option key={c.crop_cosh_id} value={c.crop_cosh_id}>{c.name_en}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Only crops on the company&apos;s belt are listed. CA manages this list in Setup.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Type</label>
                  <select value={form.package_type}
                    onChange={e => setForm(f => ({ ...f, package_type: e.target.value as 'ANNUAL' | 'PERENNIAL' }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                    <option value="ANNUAL">Annual</option>
                    <option value="PERENNIAL">Perennial</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Duration (days)</label>
                  {form.package_type === 'PERENNIAL' ? (
                    <input type="text" disabled value="365"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-slate-50 text-slate-400" />
                  ) : (
                    <input type="number" min="1" max="365" value={form.duration_days}
                      onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))}
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date Label</label>
                <select value={form.start_date_label_cosh_id}
                  onChange={e => setForm(f => ({ ...f, start_date_label_cosh_id: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                  {START_DATE_LABELS.map(l => (
                    <option key={l.cosh_id} value={l.cosh_id}>{l.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">What the farmer enters as Day 0 — sowing for annuals, planting / pruning for perennials.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description (optional)</label>
                <textarea value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2} placeholder="Brief description for the SE team…"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>

              {createError && <p className="text-sm text-red-600">{createError}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowCreate(false); setCreateError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {creating ? 'Creating…' : 'Create Package'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import from Library modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Pull from Global CCA Library</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Pull the latest version of packages your Content Manager has shared with
                your company. Each pull creates a new draft for you to review — your live
                version stays untouched until you publish the draft.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingGlobals ? (
                <p className="text-center text-slate-400 text-sm py-8">Loading global library…</p>
              ) : globals.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-8">
                  No active global packages yet. Ask your RootsTalk admin to publish some templates.
                </p>
              ) : (
                globals.map(g => {
                  // Heuristic: a Global is "shared with us" if we already
                  // have a local row matching its crop+name. The CM-push
                  // step creates exactly that. SE can then pull subsequent
                  // versions. Globals without a matching local row haven't
                  // been pushed yet — the SE can still tap Pull, but the
                  // backend will refuse with package_not_pushed_yet and
                  // we surface that as a clear inline error.
                  const alreadyShared = packages.some(p => p.crop_cosh_id === g.crop_cosh_id && p.name === g.name)
                  return (
                    <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                      <div className="flex-1">
                        <p className="font-medium text-sm text-slate-800">{g.name}</p>
                        <p className="text-xs text-slate-400 font-mono">
                          {g.crop_cosh_id} · {g.package_type.toLowerCase()} · {g.duration_days}d
                        </p>
                      </div>
                      {alreadyShared ? (
                        <button onClick={() => doFork(g.id)}
                          disabled={forking === g.id}
                          className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ background: colour }}>
                          {forking === g.id ? 'Pulling…' : '↻ Pull update'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium" title="Ask your Content Manager to push this package first.">
                          Not shared yet
                        </span>
                      )}
                    </div>
                  )
                })
              )}
              {forkError && <p className="text-sm text-red-600 px-2">{forkError}</p>}
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

export default function CcaPackagesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <PackagesContent />
    </Suspense>
  )
}
