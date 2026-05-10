'use client'
import { useEffect, useState, FormEvent, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import PackageCalendar from '@/components/cca/PackageCalendar'

interface Package {
  id: string; name: string; crop_cosh_id: string
  package_type: 'ANNUAL' | 'PERENNIAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  duration_days: number; version: number; description: string | null
}
interface Timeline {
  id: string; package_id: string; name: string
  from_type: 'DBS' | 'DAS' | 'CALENDAR'
  from_value: number; to_value: number; display_order: number
}
interface Practice {
  id: string; timeline_id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null; l2_type: string | null; display_order: number
  is_special_input: boolean; relation_id: string | null
}

interface PublishReadinessItem {
  code: string
  message: string
  [key: string]: unknown
}
interface PublishReadiness {
  ready: boolean
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  blocker_code?: string
  missing?: PublishReadinessItem[]
}

const FROM_TYPE_LABEL = { DBS: 'Days Before Sowing', DAS: 'Days After Sowing', CALENDAR: 'Calendar' }
const L0_COLOUR = {
  INPUT: 'bg-blue-100 text-blue-700',
  NON_INPUT: 'bg-purple-100 text-purple-700',
  INSTRUCTION: 'bg-amber-100 text-amber-700',
  MEDIA: 'bg-pink-100 text-pink-700',
}

export default function PackageDetailPage() {
  const { packageId } = useParams<{ packageId: string }>()
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [pkg, setPkg] = useState<Package | null>(null)
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [practiceMap, setPracticeMap] = useState<Record<string, Practice[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [pubError, setPubError] = useState('')
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null)
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [practiceCounts, setPracticeCounts] = useState<Record<string, number>>({})

  // Map for jumping from a calendar band to its timeline editor block.
  const timelineRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Timeline form
  const [showAddTL, setShowAddTL] = useState(false)
  const [addingTL, setAddingTL] = useState(false)
  const [tlError, setTlError] = useState('')
  const [tlForm, setTlForm] = useState({ name: '', from_type: 'DAS', from_value: '0', to_value: '30', display_order: '0' })

  // Timeline import
  const [showImport, setShowImport] = useState(false)
  const [importPackages, setImportPackages] = useState<Package[]>([])
  const [importSourcePkgId, setImportSourcePkgId] = useState('')
  const [importTimelines, setImportTimelines] = useState<Timeline[]>([])
  const [importSourceTlId, setImportSourceTlId] = useState('')
  const [importNewName, setImportNewName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  // Practice form
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  const [addingPractice, setAddingPractice] = useState(false)
  const [practiceError, setPracticeError] = useState('')
  const [practiceForm, setPracticeForm] = useState({
    l0_type: 'INPUT', l1_type: '', l2_type: '',
    display_order: '0', is_special_input: false,
  })

  const loadTimelines = async () => {
    // Fetch the per-package timeline list (used by the editor body)
    // and the cross-package /cca/timelines slice (which denormalises
    // practice_count) in parallel. The latter feeds the calendar
    // viz; both refresh together when timelines are added/removed.
    const [{ data: tls }, { data: cca }] = await Promise.all([
      api.get<Timeline[]>(`/client/${clientId}/packages/${packageId}/timelines`),
      api.get<{ id: string; practice_count: number }[]>(
        `/client/${clientId}/cca/timelines?package_id=${packageId}`,
      ).catch(() => ({ data: [] as { id: string; practice_count: number }[] })),
    ])
    setTimelines(tls.sort((a, b) => a.display_order - b.display_order))
    const counts: Record<string, number> = {}
    for (const c of cca) counts[c.id] = c.practice_count
    setPracticeCounts(counts)
  }

  const loadReadiness = async () => {
    if (!clientId || !packageId) return
    try {
      const { data } = await api.get<PublishReadiness>(
        `/client/${clientId}/packages/${packageId}/publish-readiness`,
      )
      setReadiness(data)
    } catch {
      // Non-fatal: panel just stays unrendered. The Publish button
      // still works (relies on the publish 422 envelope as fallback).
      setReadiness(null)
    }
  }

  const loadPractices = async (timelineId: string) => {
    const { data } = await api.get<Practice[]>(`/client/${clientId}/timelines/${timelineId}/practices`)
    setPracticeMap(m => ({ ...m, [timelineId]: data.sort((a, b) => a.display_order - b.display_order) }))
  }

  useEffect(() => {
    if (!clientId) return
    api.get<Package>(`/client/${clientId}/packages/${packageId}`)
      .then(r => setPkg(r.data))
      .catch(() => router.replace('/cca/packages'))
    loadTimelines()
    loadReadiness()
  }, [clientId, packageId])

  const toggleTimeline = (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!practiceMap[id]) loadPractices(id)
  }

  async function handlePublish() {
    setPublishing(true); setPubError('')
    try {
      const { data } = await api.post<Package>(`/client/${clientId}/packages/${packageId}/publish`)
      setPkg(data)
      setShowPublishConfirm(false)
      await loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
      setPubError(msg || 'Failed to publish.')
      // Re-fetch readiness — server-side state may have shifted
      // (e.g. crop just dropped off the belt) since the panel was
      // last rendered, surfacing a different blocker.
      await loadReadiness()
    } finally { setPublishing(false) }
  }

  async function openImport() {
    setShowImport(true)
    setImportError('')
    const { data } = await api.get<Package[]>(`/client/${clientId}/packages`)
    setImportPackages(data.filter(p => p.id !== packageId))
  }

  async function loadImportTimelines(pkgId: string) {
    setImportSourcePkgId(pkgId)
    setImportSourceTlId('')
    if (!pkgId) { setImportTimelines([]); return }
    const { data } = await api.get<Timeline[]>(`/client/${clientId}/packages/${pkgId}/timelines`)
    setImportTimelines(data)
  }

  async function handleImport() {
    if (!importSourceTlId || !importNewName.trim()) return
    setImporting(true); setImportError('')
    try {
      await api.post(`/client/${clientId}/packages/${packageId}/timelines/import`, {
        source_timeline_id: importSourceTlId,
        new_name: importNewName.trim(),
      })
      setShowImport(false)
      setImportSourcePkgId(''); setImportSourceTlId(''); setImportNewName('')
      await loadTimelines()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setImportError(msg || 'Import failed.')
    } finally { setImporting(false) }
  }

  async function handleAddTimeline(e: FormEvent) {
    e.preventDefault()
    setAddingTL(true); setTlError('')
    try {
      await api.post(`/client/${clientId}/packages/${packageId}/timelines`, {
        name: tlForm.name,
        from_type: tlForm.from_type,
        from_value: parseInt(tlForm.from_value),
        to_value: parseInt(tlForm.to_value),
        display_order: parseInt(tlForm.display_order),
      })
      setShowAddTL(false)
      setTlForm({ name: '', from_type: 'DAS', from_value: '0', to_value: '30', display_order: '0' })
      await loadTimelines()
      loadReadiness()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setTlError(msg || 'Failed to add timeline.')
    } finally { setAddingTL(false) }
  }

  async function handleAddPractice(e: FormEvent) {
    e.preventDefault()
    if (!showAddPractice) return
    setAddingPractice(true); setPracticeError('')
    try {
      await api.post(`/client/${clientId}/timelines/${showAddPractice}/practices`, {
        l0_type: practiceForm.l0_type,
        l1_type: practiceForm.l1_type || null,
        l2_type: practiceForm.l2_type || null,
        display_order: parseInt(practiceForm.display_order),
        is_special_input: practiceForm.is_special_input,
        elements: [],
      })
      setShowAddPractice(null)
      setPracticeForm({ l0_type: 'INPUT', l1_type: '', l2_type: '', display_order: '0', is_special_input: false })
      await loadPractices(showAddPractice)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setPracticeError(msg || 'Failed to add practice.')
    } finally { setAddingPractice(false) }
  }

  async function handleDeleteTimeline(tl: Timeline) {
    if (!confirm(`Delete timeline "${tl.name}"? All practices in it will also be deleted.`)) return
    await api.delete(`/client/${clientId}/packages/${packageId}/timelines/${tl.id}`)
    await loadTimelines()
    loadReadiness()
    if (expanded === tl.id) setExpanded(null)
  }

  async function handleDeletePractice(timelineId: string, practiceId: string) {
    if (!confirm('Delete this practice?')) return
    await api.delete(`/client/${clientId}/timelines/${timelineId}/practices/${practiceId}`)
    await loadPractices(timelineId)
  }

  if (!pkg) return (
    <div className="max-w-4xl mx-auto pt-20 text-center text-slate-400">Loading package…</div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => router.back()} className="mt-1 text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">{pkg.name}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              pkg.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
              pkg.status === 'INACTIVE' ? 'bg-slate-100 text-slate-500' :
              'bg-amber-100 text-amber-700'
            }`}>{pkg.status}</span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {pkg.crop_cosh_id} · {pkg.package_type.toLowerCase()} · {pkg.duration_days} days · v{pkg.version}
          </p>
          {pkg.description && <p className="text-slate-600 text-sm mt-1">{pkg.description}</p>}
        </div>
        {pkg.status === 'DRAFT' && (
          <button onClick={() => setShowPublishConfirm(true)}
            disabled={publishing || !readiness?.ready}
            title={!readiness?.ready ? 'Resolve the items below first' : ''}
            className="shrink-0 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            {publishing ? 'Publishing…' : '✓ Publish'}
          </button>
        )}
      </div>
      {pubError && <p className="text-sm text-red-600">{pubError}</p>}

      {/* Pre-publish gate panel — only when DRAFT */}
      {pkg.status === 'DRAFT' && readiness && (
        readiness.ready ? (
          <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-green-600 mt-0.5">✓</span>
            <div className="text-sm">
              <p className="font-medium text-green-800">Ready to publish</p>
              <p className="text-green-700 mt-0.5">
                Every gate is clear. Click <strong>Publish</strong> to make this Package available
                {pkg.version > 0 ? ` as v${pkg.version + 1}` : ''}.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-amber-600 mt-0.5">⚠</span>
              <div className="text-sm">
                <p className="font-medium text-amber-800">
                  {readiness.missing?.length === 1
                    ? '1 thing to fix before publishing'
                    : `${readiness.missing?.length || 0} things to fix before publishing`}
                </p>
                <p className="text-amber-700 mt-0.5 text-xs">
                  Resolve each item, then come back here and click Publish.
                </p>
              </div>
            </div>
            <ul className="space-y-1.5 ml-7 text-sm text-amber-900">
              {(readiness.missing || []).map((m, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5 text-xs">●</span>
                  <span>{m.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {/* Calendar visualisation */}
      {timelines.length > 0 && (
        <PackageCalendar
          pkg={pkg}
          timelines={timelines}
          practiceCounts={practiceCounts}
          onTimelineClick={(id) => {
            // Scroll to the timeline's editor block + expand it.
            setExpanded(id)
            if (!practiceMap[id]) loadPractices(id)
            const el = timelineRefs.current[id]
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      )}

      {/* Timelines */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Timelines <span className="text-slate-400 font-normal text-sm">({timelines.length})</span></h2>
          <div className="flex gap-2">
            <button onClick={openImport}
              className="text-sm font-medium px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50">
              ↓ Import
            </button>
            <button onClick={() => setShowAddTL(true)}
              className="text-sm font-medium px-3 py-1.5 rounded-xl border"
              style={{ borderColor: colour, color: colour }}>
              + Add
            </button>
          </div>
        </div>

        {timelines.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-dashed border-slate-200">
            <p className="text-slate-500 text-sm">No timelines yet. A timeline defines a window (e.g. Day 0–30 after sowing) and contains the practices for that window.</p>
            <button onClick={() => setShowAddTL(true)}
              className="mt-3 text-sm font-medium text-white px-4 py-2 rounded-xl"
              style={{ background: colour }}>
              Add First Timeline
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {timelines.map(tl => (
              <div key={tl.id}
                ref={el => { timelineRefs.current[tl.id] = el }}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Timeline header */}
                <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => toggleTimeline(tl.id)}>
                  <div className="flex-1">
                    <p className="font-medium text-slate-800 text-sm">{tl.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {FROM_TYPE_LABEL[tl.from_type]} · Day {tl.from_value} → {tl.to_value}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleDeleteTimeline(tl) }}
                    className="text-slate-300 hover:text-red-400 transition-colors p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${expanded === tl.id ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Practices */}
                {expanded === tl.id && (
                  <div className="border-t border-slate-100 px-5 py-4 space-y-2">
                    {!practiceMap[tl.id] ? (
                      <p className="text-xs text-slate-400">Loading practices…</p>
                    ) : practiceMap[tl.id].length === 0 ? (
                      <p className="text-xs text-slate-400">No practices in this timeline yet.</p>
                    ) : (
                      practiceMap[tl.id].map(p => (
                        <div key={p.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${L0_COLOUR[p.l0_type]}`}>{p.l0_type}</span>
                          <span className="text-sm text-slate-700 flex-1">
                            {[p.l1_type, p.l2_type].filter(Boolean).join(' › ') || <span className="text-slate-400 italic">No sub-type</span>}
                          </span>
                          {p.is_special_input && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Special</span>}
                          <button onClick={() => handleDeletePractice(tl.id, p.id)}
                            className="text-slate-300 hover:text-red-400 p-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))
                    )}
                    <button onClick={() => { setShowAddPractice(tl.id); setPracticeError('') }}
                      className="text-xs font-medium mt-2"
                      style={{ color: colour }}>
                      + Add Practice
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Timeline Modal */}
      {showAddTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">A timeline defines a time window and groups related practices</p>
            </div>
            <form onSubmit={handleAddTimeline} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Timeline Name</label>
                <input value={tlForm.name} onChange={e => setTlForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="e.g. Basal Dose Application"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Reference Type</label>
                <select value={tlForm.from_type} onChange={e => setTlForm(f => ({ ...f, from_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="DBS">DBS — Days Before Sowing</option>
                  <option value="DAS">DAS — Days After Sowing</option>
                  <option value="CALENDAR">Calendar Date</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From (day)</label>
                  <input type="number" value={tlForm.from_value}
                    onChange={e => setTlForm(f => ({ ...f, from_value: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To (day)</label>
                  <input type="number" value={tlForm.to_value}
                    onChange={e => setTlForm(f => ({ ...f, to_value: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Order</label>
                  <input type="number" min="0" value={tlForm.display_order}
                    onChange={e => setTlForm(f => ({ ...f, display_order: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              {tlError && <p className="text-sm text-red-600">{tlError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddTL(false); setTlError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={addingTL}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {addingTL ? 'Adding…' : 'Add Timeline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Practice Modal */}
      {showAddPractice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Practice</h2>
              <p className="text-slate-500 text-sm mt-0.5">Define what the farmer should do in this timeline window</p>
            </div>
            <form onSubmit={handleAddPractice} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Practice Type (L0)</label>
                <select value={practiceForm.l0_type}
                  onChange={e => setPracticeForm(f => ({ ...f, l0_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="INPUT">INPUT — Apply an agri-input (fertiliser, pesticide, etc.)</option>
                  <option value="NON_INPUT">NON_INPUT — Crop operation (weeding, irrigation, etc.)</option>
                  <option value="INSTRUCTION">INSTRUCTION — Advisory text message</option>
                  <option value="MEDIA">MEDIA — Image or video</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">L1 Sub-type</label>
                  <input value={practiceForm.l1_type}
                    onChange={e => setPracticeForm(f => ({ ...f, l1_type: e.target.value }))}
                    placeholder="e.g. FERTILISER"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">L2 Sub-type</label>
                  <input value={practiceForm.l2_type}
                    onChange={e => setPracticeForm(f => ({ ...f, l2_type: e.target.value }))}
                    placeholder="e.g. NPK"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Display Order</label>
                  <input type="number" min="0" value={practiceForm.display_order}
                    onChange={e => setPracticeForm(f => ({ ...f, display_order: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={practiceForm.is_special_input}
                      onChange={e => setPracticeForm(f => ({ ...f, is_special_input: e.target.checked }))}
                      className="w-4 h-4 rounded" />
                    <span className="text-sm text-slate-700">Special input</span>
                  </label>
                </div>
              </div>
              {practiceError && <p className="text-sm text-red-600">{practiceError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddPractice(null); setPracticeError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={addingPractice}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {addingPractice ? 'Adding…' : 'Add Practice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Timeline Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900 text-lg">Import Timeline from Another PoP</h2>
            <p className="text-xs text-slate-400">
              The imported timeline is fully independent — changes here won't affect the source, and vice versa.
              You must give it a new name.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Source Package</label>
              <select value={importSourcePkgId}
                onChange={e => loadImportTimelines(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none">
                <option value="">Select a package…</option>
                {importPackages.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.crop_cosh_id})</option>
                ))}
              </select>
            </div>

            {importTimelines.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Source Timeline</label>
                <select value={importSourceTlId}
                  onChange={e => {
                    setImportSourceTlId(e.target.value)
                    const tl = importTimelines.find(t => t.id === e.target.value)
                    if (tl) setImportNewName(`${tl.name} (copy)`)
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none">
                  <option value="">Select a timeline…</option>
                  {importTimelines.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {FROM_TYPE_LABEL[t.from_type]} {t.from_value}→{t.to_value}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {importSourceTlId && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">New Name for this PoP *</label>
                <input value={importNewName}
                  onChange={e => setImportNewName(e.target.value)}
                  placeholder="Give it a distinct name"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
                <p className="text-xs text-slate-400 mt-1">The timeline will be copied with all its practices. Rename to avoid confusion.</p>
              </div>
            )}

            {importError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{importError}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={handleImport}
                disabled={importing || !importSourceTlId || !importNewName.trim()}
                className="flex-1 py-3 text-white font-semibold rounded-xl text-sm disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {importing ? 'Importing…' : 'Import Timeline'}
              </button>
              <button onClick={() => { setShowImport(false); setImportError('') }}
                className="px-5 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish confirmation modal */}
      {showPublishConfirm && pkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Publish &quot;{pkg.name}&quot;?</h2>
              <p className="text-slate-500 text-sm mt-1.5">
                {pkg.version === 0 ? (
                  <>This is the first publication. Once live, farmers can subscribe and the advisory
                  starts flowing on their app.</>
                ) : (
                  <>This will create version <strong>v{pkg.version + 1}</strong>. New subscriptions
                  will use v{pkg.version + 1}; existing subscriptions on prior versions continue
                  unchanged on their version.</>
                )}
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <p><strong>Crop:</strong> {pkg.crop_cosh_id}</p>
                <p><strong>Type:</strong> {pkg.package_type.toLowerCase()} · {pkg.duration_days} days</p>
                <p><strong>Timelines:</strong> {timelines.length}</p>
              </div>
              {pubError && <p className="text-sm text-red-600">{pubError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3">
              <button
                onClick={() => { setShowPublishConfirm(false); setPubError('') }}
                disabled={publishing}
                className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handlePublish} disabled={publishing}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {publishing ? 'Publishing…' : 'Confirm Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
