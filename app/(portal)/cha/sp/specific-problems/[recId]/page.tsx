'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import { PracticeFormModal, type ExistingPractice } from '@/components/advisory-authoring/PracticeFormModal'
import { RelationsSection } from '@/components/advisory-authoring/RelationsSection'
import { CQsSection } from '@/components/advisory-authoring/CQsSection'
import { useReadOnlyGuard } from '@/components/advisory-authoring/ReadOnlyGuard'
import { practiceShortLabel } from '@/lib/practice-label'

interface SP {
  id: string
  specific_problem_cosh_id: string
  client_id: string
  crop_cosh_id: string | null
  // Resolved by backend from Cosh's crop_area_plant_wise Connect.
  // Drives the Import-from-PG filter — only same-measure CA-PGs are
  // offered as import sources.
  crop_measure: 'AREA_WISE' | 'PLANT_WISE' | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

interface ImportablePG {
  id: string
  problem_group_cosh_id: string
  problem_group_name_en: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  timeline_count: number
}

interface PracticeElement {
  element_type: string
  label: string
  cosh_ref: string | null
  value: string | null
  unit_cosh_id: string | null
  display_value: string | null
  display_order: number
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
  relation_id?: string | null
  elements?: PracticeElement[]
}

interface Timeline {
  id: string
  name: string
  from_type: string
  from_value: number
  to_value: number
  status?: 'ACTIVE' | 'INACTIVE'
  practices: Practice[]
}

interface SpProblem {
  cosh_id: string
  name_en: string
}

interface PublishReadiness {
  ready: boolean
  status: string
  version: number
  blocker_code?: string
  missing?: { code: string; message: string }[]
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

export default function SpDetailPage() {
  const { recId } = useParams<{ recId: string }>()
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [sp, setSp] = useState<SP | null>(null)
  const [problemName, setProblemName] = useState('')
  const [cropName, setCropName] = useState('')
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [practiceMap, setPracticeMap] = useState<Record<string, Practice[]>>({})
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedPractice, setExpandedPractice] = useState<string | null>(null)

  // Add timeline
  const [showAddTL, setShowAddTL] = useState(false)
  const [addingTL, setAddingTL] = useState(false)
  const [tlError, setTlError] = useState('')
  const [tlForm, setTlForm] = useState({ name: '', from_value: '0', to_value: '7' })

  // Edit timeline (Phase 4 of CA-portal parity, 2026-05-17). SP
  // Reference Type is fixed to DAYS_AFTER_DETECTION — locked.
  const [showEditTL, setShowEditTL] = useState<Timeline | null>(null)
  const [editingTL, setEditingTL] = useState(false)
  const [editTLError, setEditTLError] = useState('')
  const [editTLForm, setEditTLForm] = useState({
    name: '', from_value: '0', to_value: '7', status: 'ACTIVE',
  })

  // Practice authoring goes through <PracticeFormModal> — same
  // component the SA-portal + CA-CCA + CA-PG editors use. mode
  // flips by editingPractice.
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  // Relations mirror — feeds CQsSection. Same pattern as N1.
  const [relationsByTimeline, setRelationsByTimeline] = useState<Record<string, unknown[]>>({})
  const [editingPractice, setEditingPractice] = useState<{ timelineId: string; practice: Practice } | null>(null)

  // Publish
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pubError, setPubError] = useState('')

  // Import-from-PG (Task G, 2026-05-18). Picker lists this client's
  // CA-PGs whose area_or_plant matches the SP's crop_measure. Backend
  // POST /import-from-pg/{pg_id} either seeds the SP with content or
  // refuses with 409 import_would_overwrite when the SP already has
  // timelines — surfaced as a force-overwrite confirm step.
  const [showImport, setShowImport] = useState(false)
  const [importablePGs, setImportablePGs] = useState<ImportablePG[]>([])
  const [loadingImportablePGs, setLoadingImportablePGs] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importError, setImportError] = useState('')
  const [overwriteConfirmPg, setOverwriteConfirmPg] = useState<ImportablePG | null>(null)

  const loadSp = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<SP>(`/client/${clientId}/sp-recommendations/${recId}`)
      setSp(data)
    } catch {
      router.replace('/cha/sp/specific-problems')
    }
  }
  const loadTimelines = async () => {
    if (!clientId || !recId) return
    const { data } = await api.get<Timeline[]>(`/client/${clientId}/sp-recommendations/${recId}/timelines`)
    const sorted = data.sort((a, b) => a.from_value - b.from_value)
    setTimelines(sorted)
    const seed: Record<string, Practice[]> = {}
    for (const tl of sorted) {
      if (tl.practices) seed[tl.id] = tl.practices
    }
    setPracticeMap(seed)
  }

  // Per-timeline practices with elements + server-resolved labels.
  // Polymorphic — same /client/{cid}/timelines/{tl}/practices works
  // for any pipe (CCA / PG / SP / QA).
  const loadPractices = async (tlId: string) => {
    if (!clientId) return
    try {
      const { data } = await api.get<Practice[]>(
        `/client/${clientId}/timelines/${tlId}/practices`,
      )
      setPracticeMap(m => ({ ...m, [tlId]: data.sort((a, b) => a.display_order - b.display_order) }))
    } catch { /* leave existing entry alone */ }
  }
  const loadReadiness = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<PublishReadiness>(
        `/client/${clientId}/sp-recommendations/${recId}/publish-readiness`,
      )
      setReadiness(data)
    } catch {
      setReadiness(null)
    }
  }
  const loadFriendlyNames = async () => {
    if (!clientId || !sp) return
    try {
      // SP problem name from the per-crop list
      if (sp.crop_cosh_id) {
        const { data: probs } = await api.get<SpProblem[]>(
          `/client/${clientId}/cha-sp/specific-problems?crop_cosh_id=${encodeURIComponent(sp.crop_cosh_id)}`,
        )
        const match = probs.find(p => p.cosh_id === sp.specific_problem_cosh_id)
        if (match) setProblemName(match.name_en)
        // Crop friendly name from the eligible-crops list
        const { data: crops } = await api.get<{ crop_cosh_id: string; name_en: string }[]>(
          `/client/${clientId}/cha-sp/eligible-crops`,
        )
        const cropMatch = crops.find(c => c.crop_cosh_id === sp.crop_cosh_id)
        if (cropMatch) setCropName(cropMatch.name_en)
      }
    } catch { /* non-fatal */ }
  }

  async function openImport() {
    if (!sp || !clientId) return
    setShowImport(true)
    setImportError('')
    setOverwriteConfirmPg(null)
    setLoadingImportablePGs(true)
    try {
      const { data } = await api.get<ImportablePG[]>(
        `/client/${clientId}/cha/recommendations`,
      )
      // Filter to same crop measure as this SP. If the SP's crop
      // hasn't been classified by Cosh yet (crop_measure null), show
      // nothing — the empty state surfaces a clearer message.
      const filtered = sp.crop_measure
        ? data.filter(pg => pg.area_or_plant === sp.crop_measure)
        : []
      setImportablePGs(filtered)
    } catch {
      setImportablePGs([])
    } finally {
      setLoadingImportablePGs(false)
    }
  }

  async function doImport(pg: ImportablePG, force: boolean) {
    if (!clientId || !recId) return
    setImporting(pg.id); setImportError('')
    try {
      await api.post(
        `/client/${clientId}/sp-recommendations/${recId}/import-from-pg/${pg.id}`
          + (force ? '?force=true' : ''),
      )
      setShowImport(false)
      setOverwriteConfirmPg(null)
      await loadTimelines()
      await loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const code = typeof detail === 'object' ? (detail as { code?: string })?.code : undefined
      const msg = typeof detail === 'string'
        ? detail
        : (detail as { message?: string })?.message || 'Failed to import.'
      if (code === 'import_would_overwrite') {
        // Drop into the confirm step — same modal, different body.
        setOverwriteConfirmPg(pg)
        setImportError('')
      } else {
        setImportError(msg)
      }
    } finally {
      setImporting(null)
    }
  }

  useEffect(() => {
    loadSp(); loadTimelines(); loadReadiness()
  }, [clientId, recId])

  useEffect(() => { loadFriendlyNames() }, [sp, clientId])

  async function handleAddTimeline(e: FormEvent) {
    e.preventDefault()
    setAddingTL(true); setTlError('')
    try {
      await api.post(`/client/${clientId}/sp-recommendations/${recId}/timelines`, {
        name: tlForm.name,
        from_type: 'DAYS_AFTER_DETECTION',
        from_value: parseInt(tlForm.from_value, 10),
        to_value: parseInt(tlForm.to_value, 10),
      })
      setShowAddTL(false)
      setTlForm({ name: '', from_value: '0', to_value: '7' })
      await loadTimelines()
      loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setTlError(msg || 'Failed to add timeline.')
    } finally { setAddingTL(false) }
  }

  function openEditTimeline(tl: Timeline) {
    setEditTLForm({
      name: tl.name,
      from_value: String(tl.from_value),
      to_value: String(tl.to_value),
      status: tl.status || 'ACTIVE',
    })
    setEditTLError('')
    setShowEditTL(tl)
  }

  async function handleEditTimeline(e: FormEvent) {
    e.preventDefault()
    if (!showEditTL) return
    setEditTLError('')
    const fromVal = parseInt(editTLForm.from_value, 10)
    const toVal = parseInt(editTLForm.to_value, 10)
    if (Number.isNaN(fromVal) || Number.isNaN(toVal)) {
      setEditTLError('FROM and TO must be whole numbers.'); return
    }
    if (fromVal > toVal) {
      setEditTLError('FROM must be ≤ TO (the window cannot run backwards).'); return
    }
    setEditingTL(true)
    try {
      const { data } = await api.put<Timeline>(
        `/client/${clientId}/sp-recommendations/${recId}/timelines/${showEditTL.id}`,
        {
          name: editTLForm.name,
          from_value: fromVal,
          to_value: toVal,
          status: editTLForm.status,
        },
      )
      setTimelines(tls => tls.map(t => t.id === data.id ? { ...t, ...data, practices: t.practices } : t))
      setShowEditTL(null)
      loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setEditTLError(msg || 'Failed to save timeline.')
    } finally { setEditingTL(false) }
  }

  async function deleteTimeline(tl: Timeline) {
    if (!confirm(`Delete timeline "${tl.name}"? All practices in it will also be removed.`)) return
    await api.delete(`/client/${clientId}/sp-recommendations/${recId}/timelines/${tl.id}`)
    await loadTimelines()
    loadReadiness()
  }

  async function deletePractice(timelineId: string, practiceId: string) {
    if (!confirm('Delete this practice?')) return
    await api.delete(
      `/client/${clientId}/sp-recommendations/${recId}/timelines/${timelineId}/practices/${practiceId}`,
    )
    await loadTimelines()
  }

  async function handlePublish() {
    setPublishing(true); setPubError('')
    try {
      await api.post(`/client/${clientId}/sp-recommendations/${recId}/publish`)
      setShowPublishConfirm(false)
      await loadSp()
      await loadReadiness()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setPubError(msg || 'Failed to publish.')
      await loadReadiness()
    } finally { setPublishing(false) }
  }

  // 2026-05-21 Phase 1 — gate every edit action on DRAFT status.
  // Pre-fix, the backend silently wrote mutations to ACTIVE rows
  // (the sp_not_draft helper now 422s them); this hook stops the
  // user before they fill in a form that will fail. Hook lives
  // ABOVE the early-return so Rules of Hooks hold.
  const editorReadOnly = sp ? sp.status !== 'DRAFT' : true
  const { tryEdit, GuardModal } = useReadOnlyGuard({
    isReadOnly: editorReadOnly,
    statusLabel: sp?.status?.toLowerCase() || 'published',
  })

  if (!sp) return (
    <div className="max-w-4xl mx-auto pt-20 text-center text-slate-400">Loading recommendation…</div>
  )

  const totalPractices = timelines.reduce((s, t) => s + t.practices.length, 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <Link href="/cha/sp/specific-problems" className="mt-1 text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">
              {problemName || '(loading…)'}
            </h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[sp.status]}`}>
              {sp.status}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {cropName || '(loading crop…)'} · v{sp.version}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <Link href={`/cha/sp/specific-problems/${recId}/preview`}
            className="text-sm font-medium px-4 py-2 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            👁 Preview
          </Link>
          {sp.status === 'DRAFT' && (
            <button onClick={openImport}
              className="text-sm font-medium px-4 py-2 rounded-xl border"
              style={{ borderColor: colour, color: colour }}>
              ↓ Import from PG
            </button>
          )}
          {sp.status === 'DRAFT' && (
            <button onClick={() => setShowPublishConfirm(true)}
              disabled={publishing || !readiness?.ready}
              title={!readiness?.ready ? 'Resolve the items below first' : ''}
              className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              {publishing ? 'Publishing…' : '✓ Publish'}
            </button>
          )}
        </div>
      </div>

      {sp.status === 'DRAFT' && readiness && (
        readiness.ready ? (
          <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-green-600 mt-0.5">✓</span>
            <div className="text-sm">
              <p className="font-medium text-green-800">Ready to publish</p>
              <p className="text-green-700 mt-0.5">
                Click <strong>Publish</strong> to make this v{sp.version + 1}.
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

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">
            Timelines <span className="text-slate-400 font-normal text-sm">({timelines.length})</span>
          </h2>
          <button onClick={() => tryEdit(() => setShowAddTL(true))}
            className="text-sm font-medium px-3 py-1.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            + Add Timeline
          </button>
        </div>

        {timelines.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
            <p className="text-slate-400 text-4xl mb-3">📅</p>
            <p className="text-slate-600 font-medium">No timelines yet</p>
            <p className="text-slate-400 text-sm mt-1">
              Add the first timeline (in days after problem detection) to start authoring practices.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {timelines.map(tl => (
              <div key={tl.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <button onClick={() => {
                    const next = expanded === tl.id ? null : tl.id
                    setExpanded(next)
                    if (next === tl.id) loadPractices(tl.id)
                  }}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                  <div className="text-left">
                    <p className="font-medium text-slate-800">
                      {tl.name}
                      {tl.status === 'INACTIVE' && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Inactive</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">
                      Day {tl.from_value} → {tl.to_value} after detection · {(practiceMap[tl.id] || tl.practices).length} practice{(practiceMap[tl.id] || tl.practices).length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={e => { e.stopPropagation(); tryEdit(() => openEditTimeline(tl)) }}
                      className="text-slate-300 hover:text-blue-500 p-1.5"
                      title="Edit timeline">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button onClick={e => { e.stopPropagation(); tryEdit(() => deleteTimeline(tl)) }}
                      className="text-slate-300 hover:text-red-400 p-1.5"
                      title="Delete timeline">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <span className="text-slate-400 text-sm ml-1">
                      {expanded === tl.id ? '▾' : '▸'}
                    </span>
                  </div>
                </button>

                {expanded === tl.id && (
                  <div className="px-5 pb-4 pt-1 border-t border-slate-50 space-y-2">
                    {!practiceMap[tl.id] ? (
                      <p className="text-xs text-slate-400 py-3">Loading practices…</p>
                    ) : practiceMap[tl.id].length === 0 ? (
                      <p className="text-xs text-slate-400 py-3">No practices yet.</p>
                    ) : (
                      practiceMap[tl.id].map(p => {
                        const isPExpanded = expandedPractice === p.id
                        const hasElements = (p.elements?.length || 0) > 0
                        return (
                          <div key={p.id} className="border-b border-slate-50 last:border-0">
                            <div
                              className="flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded"
                              onClick={() => setExpandedPractice(isPExpanded ? null : p.id)}>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${L0_COLOUR[p.l0_type] || 'bg-slate-100'}`}>{p.l0_type}</span>
                              <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">
                                {p.l2_type ? practiceShortLabel(p) : <span className="text-slate-400 italic">No sub-type</span>}
                              </span>
                              {p.is_special_input && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">special</span>}
                              {p.is_brand_locked && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full" title="Locked brand">🔒 locked</span>}
                              <span className="text-[11px] text-slate-400">
                                {hasElements ? `${p.elements!.length} element${p.elements!.length === 1 ? '' : 's'}` : 'no elements'}
                              </span>
                              <button onClick={e => {
                                e.stopPropagation()
                                tryEdit(() => {
                                  setEditingPractice({ timelineId: tl.id, practice: p })
                                  setShowAddPractice(tl.id)
                                })
                              }}
                                className="text-slate-300 hover:text-blue-500 p-1" title="Edit practice">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button onClick={e => { e.stopPropagation(); tryEdit(() => deletePractice(tl.id, p.id)) }}
                                className="text-slate-300 hover:text-red-400 p-1" title="Delete practice">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                              <svg className={`w-3.5 h-3.5 text-slate-300 transition-transform ${isPExpanded ? 'rotate-180' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                            {isPExpanded && (
                              <div className="ml-2 pl-3 border-l-2 border-slate-100 py-2 space-y-1 mb-2">
                                {hasElements ? p.elements!.map(el => (
                                  <div key={el.element_type} className="flex items-baseline gap-2 text-xs">
                                    <span className="text-slate-500 min-w-[140px] shrink-0">{el.label}:</span>
                                    <span className="text-slate-800 font-medium min-w-0">
                                      {el.display_value || <span className="text-slate-300 italic">—</span>}
                                    </span>
                                  </div>
                                )) : (
                                  <p className="text-xs text-slate-400 italic">No elements on this Practice.</p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                    <button onClick={() => tryEdit(() => { setEditingPractice(null); setShowAddPractice(tl.id) })}
                      className="w-full mt-2 text-sm py-2 rounded-xl border border-dashed border-slate-200 text-slate-500 hover:bg-slate-50">
                      + Add Practice
                    </button>

                    {/* Relations + CQs — shared with CA-CCA (Batch N2). */}
                    <RelationsSection
                      timelineId={tl.id}
                      timelineName={tl.name}
                      practices={(practiceMap[tl.id] || []).map(p => ({
                        id: p.id,
                        l0_type: p.l0_type,
                        l1_type: p.l1_type,
                        l2_type: p.l2_type,
                        is_special_input: p.is_special_input,
                        elements: p.elements?.map(e => ({
                          element_type: e.element_type,
                          value: e.value,
                          display_value: e.display_value,
                        })),
                      }))}
                      pipe={{
                        pipe: 'SP_CLIENT',
                        clientId: clientId || '',
                        parentId: recId,
                      }}
                      onRelationsChange={(tid, rels) =>
                        setRelationsByTimeline(m => ({ ...m, [tid]: rels }))
                      }
                    />
                    <CQsSection
                      timelineId={tl.id}
                      timelineName={tl.name}
                      practices={(practiceMap[tl.id] || []).map(p => ({
                        id: p.id,
                        l0_type: p.l0_type,
                        l1_type: p.l1_type,
                        l2_type: p.l2_type,
                        is_special_input: p.is_special_input,
                        relation_id: p.relation_id ?? null,
                        elements: p.elements?.map(e => ({
                          element_type: e.element_type,
                          value: e.value,
                          display_value: e.display_value,
                        })),
                      }))}
                      relations={(relationsByTimeline[tl.id] || []) as never}
                      pipe={{
                        pipe: 'SP_CLIENT',
                        clientId: clientId || '',
                        parentId: recId,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import-from-PG modal (Task G, 2026-05-18). Two states:
            (1) Picker — pick a CA-PG of matching measure to seed this SP.
            (2) Force-overwrite confirm — when SP already has content
                and the user picked a PG (server returned 409). */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                {overwriteConfirmPg ? 'Overwrite existing content?' : 'Import from a CA-PG'}
              </h2>
              <p className="text-slate-500 text-sm mt-0.5">
                {overwriteConfirmPg
                  ? `This SP already has timelines. Importing from ${overwriteConfirmPg.problem_group_name_en} will replace them with a fresh copy.`
                  : sp?.crop_measure
                    ? `Seed this SP with a copy of one of your ${sp.crop_measure === 'AREA_WISE' ? 'area-wise' : 'plant-wise'} CA-PGs. You can edit freely after.`
                    : 'Pick a CA-PG to seed this SP.'}
              </p>
            </div>

            {overwriteConfirmPg ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-900">
                  <p className="font-medium mb-1">⚠ This action can't be undone in V1.</p>
                  <p className="text-xs">
                    Existing timelines + practices will be deleted and replaced with the {overwriteConfirmPg.problem_group_name_en} bundle.
                  </p>
                </div>
                {importError && <p className="text-sm text-red-600">{importError}</p>}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {loadingImportablePGs ? (
                  <p className="text-center text-slate-400 text-sm py-8">Loading PGs…</p>
                ) : !sp?.crop_measure ? (
                  <p className="text-center text-slate-400 text-sm py-8 px-4">
                    {cropName || 'This crop'} isn&apos;t classified as area-wise or plant-wise yet, so we can&apos;t pick matching PGs. Contact RootsTalk support.
                  </p>
                ) : importablePGs.length === 0 ? (
                  <p className="text-center text-slate-400 text-sm py-8 px-4">
                    No {sp.crop_measure === 'AREA_WISE' ? 'area-wise' : 'plant-wise'} CA-PGs to import from yet. Create one under <Link href="/cha/problems" className="text-green-700 hover:underline">Problem Groups</Link> first.
                  </p>
                ) : (
                  importablePGs.map(pg => (
                    <div key={pg.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                      <div className="flex-1">
                        <p className="font-medium text-sm text-slate-800">{pg.problem_group_name_en}</p>
                        <p className="text-xs text-slate-400">
                          {pg.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'} · v{pg.version} · {pg.status.toLowerCase()} · {pg.timeline_count} timeline{pg.timeline_count === 1 ? '' : 's'}
                        </p>
                      </div>
                      <button onClick={() => doImport(pg, false)}
                        disabled={importing === pg.id}
                        className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: colour }}>
                        {importing === pg.id ? 'Importing…' : 'Import'}
                      </button>
                    </div>
                  ))
                )}
                {importError && <p className="text-sm text-red-600 px-2">{importError}</p>}
              </div>
            )}

            <div className="p-4 border-t border-slate-100 flex gap-3">
              {overwriteConfirmPg ? (
                <>
                  <button type="button"
                    onClick={() => { setOverwriteConfirmPg(null); setImportError('') }}
                    disabled={importing !== null}
                    className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-50">
                    Back
                  </button>
                  <button type="button"
                    onClick={() => doImport(overwriteConfirmPg, true)}
                    disabled={importing !== null}
                    className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #b45309cc, #b45309)' }}>
                    {importing ? 'Overwriting…' : 'Yes, overwrite'}
                  </button>
                </>
              ) : (
                <button type="button"
                  onClick={() => { setShowImport(false); setImportError('') }}
                  className="w-full border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Timeline modal */}
      {showAddTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Pick a day-range after the farmer reports the problem.
              </p>
            </div>
            <form onSubmit={handleAddTimeline} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input value={tlForm.name}
                  onChange={e => setTlForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="e.g. Day 0–3 — initial response"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From (days after detection)</label>
                  <input type="number" min="0" value={tlForm.from_value}
                    onChange={e => setTlForm(f => ({ ...f, from_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To (days after detection)</label>
                  <input type="number" min="0" value={tlForm.to_value}
                    onChange={e => setTlForm(f => ({ ...f, to_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              {tlError && <p className="text-sm text-red-600">{tlError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowAddTL(false); setTlError('') }}
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

      {/* Add / Edit Practice — shared modal (Phase 4 of CA-portal
          parity, 2026-05-17). cropCoshId comes from the SP row so
          plant-wise extras render correctly. */}
      <PracticeFormModal
        open={!!showAddPractice}
        mode={editingPractice ? 'edit' : 'create'}
        timelineId={showAddPractice || ''}
        cropCoshId={sp?.crop_cosh_id || ''}
        existingPractice={editingPractice?.practice as ExistingPractice | undefined}
        contextSubtitle={(() => {
          if (!showAddPractice) return undefined
          const tl = timelines.find(t => t.id === showAddPractice)
          if (!tl) return undefined
          return `${tl.name} · Day ${tl.from_value} → ${tl.to_value} after detection`
        })()}
        timelineWindow={(() => {
          if (!showAddPractice) return undefined
          const tl = timelines.find(t => t.id === showAddPractice)
          if (!tl) return undefined
          return { from_value: tl.from_value, to_value: tl.to_value }
        })()}
        pipe={{ pipe: 'SP_CLIENT', clientId: clientId || '', parentId: recId }}
        onClose={() => {
          setShowAddPractice(null)
          setEditingPractice(null)
        }}
        onSaved={() => {
          const tlId = showAddPractice
          if (tlId) loadPractices(tlId)
          loadReadiness()
        }}
      />

      {/* Edit Timeline modal */}
      {showEditTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Reference Type: <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">Days After Detection</span>
                <span className="ml-2 text-xs text-slate-400">(locked — CHA timelines always anchor on detection)</span>
              </p>
            </div>
            <form onSubmit={handleEditTimeline} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input value={editTLForm.name}
                  onChange={e => setEditTLForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">From (Day)</label>
                  <input type="number" min="0" value={editTLForm.from_value}
                    onChange={e => setEditTLForm(f => ({ ...f, from_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">To (Day)</label>
                  <input type="number" min="0" value={editTLForm.to_value}
                    onChange={e => setEditTLForm(f => ({ ...f, to_value: e.target.value }))}
                    required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <div className="flex gap-2">
                  {(['ACTIVE', 'INACTIVE'] as const).map(s => (
                    <button key={s} type="button"
                      onClick={() => setEditTLForm(f => ({ ...f, status: s }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium border ${
                        editTLForm.status === s
                          ? (s === 'ACTIVE'
                              ? 'bg-green-50 border-green-300 text-green-700'
                              : 'bg-slate-100 border-slate-300 text-slate-700')
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Inactive timelines stay visible on this page with a badge but are excluded from the farmer&apos;s daily advisory.
                </p>
              </div>
              {editTLError && <p className="text-sm text-red-600">{editTLError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowEditTL(null); setEditTLError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={editingTL}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {editingTL ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish confirmation */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                Publish {problemName || '(loading…)'}?
              </h2>
              <p className="text-slate-500 text-sm mt-1.5">
                {cropName || '—'} · {sp.version > 0 ? `will become v${sp.version + 1}` : 'first publication'}.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <p><strong>Timelines:</strong> {timelines.length}</p>
                <p><strong>Practices:</strong> {totalPractices}</p>
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
      <GuardModal />
    </div>
  )
}
