'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

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

  // Timeline form
  const [showAddTL, setShowAddTL] = useState(false)
  const [addingTL, setAddingTL] = useState(false)
  const [tlError, setTlError] = useState('')
  const [tlForm, setTlForm] = useState({ name: '', from_type: 'DAS', from_value: '0', to_value: '30', display_order: '0' })

  // Practice form
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  const [addingPractice, setAddingPractice] = useState(false)
  const [practiceError, setPracticeError] = useState('')
  const [practiceForm, setPracticeForm] = useState({
    l0_type: 'INPUT', l1_type: '', l2_type: '',
    display_order: '0', is_special_input: false,
  })

  const loadTimelines = async () => {
    const { data } = await api.get<Timeline[]>(`/client/${clientId}/packages/${packageId}/timelines`)
    setTimelines(data.sort((a, b) => a.display_order - b.display_order))
  }

  const loadPractices = async (timelineId: string) => {
    const { data } = await api.get<Practice[]>(`/client/${clientId}/timelines/${timelineId}/practices`)
    setPracticeMap(m => ({ ...m, [timelineId]: data.sort((a, b) => a.display_order - b.display_order) }))
  }

  useEffect(() => {
    if (!clientId) return
    api.get<Package>(`/client/${clientId}/packages/${packageId}`)
      .then(r => setPkg(r.data))
      .catch(() => router.replace('/advisory'))
    loadTimelines()
  }, [clientId, packageId])

  const toggleTimeline = (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!practiceMap[id]) loadPractices(id)
  }

  async function handlePublish() {
    if (!confirm('Publish this package? Farmers will receive advisories once subscribed.')) return
    setPublishing(true); setPubError('')
    try {
      const { data } = await api.post<Package>(`/client/${clientId}/packages/${packageId}/publish`)
      setPkg(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setPubError(msg || 'Failed to publish.')
    } finally { setPublishing(false) }
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
          <button onClick={handlePublish} disabled={publishing}
            className="shrink-0 text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            {publishing ? 'Publishing…' : '✓ Publish Package'}
          </button>
        )}
      </div>
      {pubError && <p className="text-sm text-red-600">{pubError}</p>}

      {/* Timelines */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Timelines <span className="text-slate-400 font-normal text-sm">({timelines.length})</span></h2>
          <button onClick={() => setShowAddTL(true)}
            className="text-sm font-medium px-3 py-1.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            + Add Timeline
          </button>
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
              <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
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
    </div>
  )
}
