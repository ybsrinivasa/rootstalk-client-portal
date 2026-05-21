'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import { PracticeFormModal, type ExistingPractice } from '@/components/advisory-authoring/PracticeFormModal'
import { RelationsSection } from '@/components/advisory-authoring/RelationsSection'
import { CQsSection } from '@/components/advisory-authoring/CQsSection'
import {
  VersionHistorySection,
  type LineageRow,
} from '@/components/advisory-authoring/LineageSection'
import { practiceShortLabel } from '@/lib/practice-label'

interface Rec {
  id: string
  problem_group_cosh_id: string
  area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
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

interface Problem {
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

export default function RecDetailPage() {
  const { recId } = useParams<{ recId: string }>()
  const router = useRouter()
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [rec, setRec] = useState<Rec | null>(null)
  const [problemName, setProblemName] = useState('')
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

  // Edit timeline (Phase 3 of CA-portal parity, 2026-05-17). PG
  // Reference Type is fixed to DAYS_AFTER_DETECTION (locked Global
  // PG choice — there is no "before detection" window).
  const [showEditTL, setShowEditTL] = useState<Timeline | null>(null)
  const [editingTL, setEditingTL] = useState(false)
  const [editTLError, setEditTLError] = useState('')
  const [editTLForm, setEditTLForm] = useState({
    name: '', from_value: '0', to_value: '7', status: 'ACTIVE',
  })

  // Practice authoring goes through <PracticeFormModal> — same
  // component the SA-portal PG editor uses. mode flips by editingPractice.
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)

  // Relations mirror — populated by RelationsSection's
  // onRelationsChange so CQsSection can resolve relation labels +
  // gate eligibility. Same pattern as CA-CCA (Batch N1).
  const [relationsByTimeline, setRelationsByTimeline] = useState<Record<string, unknown[]>>({})
  const [editingPractice, setEditingPractice] = useState<{ timelineId: string; practice: Practice } | null>(null)

  // Publish
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pubError, setPubError] = useState('')

  // Lineage (Batch R, 2026-05-18) — mirrors SA-PG. Each re-import or
  // clone-to-draft creates a new row sharing
  // (client_id, problem_group_cosh_id, area_or_plant). Single-DRAFT
  // invariant enforced server-side.
  const [lineage, setLineage] = useState<LineageRow[]>([])
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')
  const [makingEditable, setMakingEditable] = useState<string | null>(null)

  // Import from Global on the Timeline screen (2026-05-21). Auto-pick
  // the ACTIVE Global PG matching this rec's (problem_group_cosh_id,
  // area_or_plant). When no match exists, the button is hidden.
  // Re-importing replaces an empty DRAFT silently, asks before
  // overwriting a DRAFT with content, and clones-to-new-DRAFT from
  // an ACTIVE/INACTIVE row (the import endpoint handles all three).
  const [matchingGlobal, setMatchingGlobal] = useState<{ id: string; version: number } | null>(null)
  const [importingGlobal, setImportingGlobal] = useState(false)
  const [importError, setImportError] = useState('')

  const loadRec = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<Rec>(`/client/${clientId}/pg-recommendations/${recId}`)
      setRec(data)
    } catch {
      router.replace('/cha/recommendations')
    }
  }
  const loadTimelines = async () => {
    if (!clientId || !recId) return
    const { data } = await api.get<Timeline[]>(
      `/client/${clientId}/pg-recommendations/${recId}/timelines`,
    )
    const sorted = data.sort((a, b) => a.from_value - b.from_value)
    setTimelines(sorted)
    // Seed practiceMap from the nested-on-timeline shape so the
    // count + "+ Add Practice" affordance render before the user
    // expands. Per-timeline element-rich fetch (loadPractices)
    // runs on expand + after every save so element values stay fresh.
    const seed: Record<string, Practice[]> = {}
    for (const tl of sorted) {
      if (tl.practices) seed[tl.id] = tl.practices
    }
    setPracticeMap(seed)
  }

  // Per-timeline practices with elements + server-resolved labels.
  // Polymorphic /client/{cid}/timelines/{tl}/practices works for any
  // timeline regardless of pipe (CCA / PG / SP / QA).
  const loadPractices = async (tlId: string) => {
    if (!clientId) return
    try {
      const { data } = await api.get<Practice[]>(
        `/client/${clientId}/timelines/${tlId}/practices`,
      )
      setPracticeMap(m => ({ ...m, [tlId]: data.sort((a, b) => a.display_order - b.display_order) }))
    } catch { /* leave existing entry alone on failure */ }
  }
  const loadReadiness = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<PublishReadiness>(
        `/client/${clientId}/pg-recommendations/${recId}/publish-readiness`,
      )
      setReadiness(data)
    } catch {
      setReadiness(null)
    }
  }
  const loadLineage = async () => {
    if (!clientId || !recId) return
    try {
      const { data } = await api.get<LineageRow[]>(
        `/client/${clientId}/pg-recommendations/${recId}/lineage`,
      )
      setLineage(data)
    } catch { setLineage([]) }
  }
  const loadProblemName = async () => {
    if (!clientId) return
    try {
      const { data } = await api.get<Problem[]>(`/client/${clientId}/cha/problems`)
      if (rec) {
        const match = data.find(p => p.cosh_id === rec.problem_group_cosh_id)
        if (match) setProblemName(match.name_en)
      }
    } catch { /* non-fatal */ }
  }
  // Match an ACTIVE Global PG by (problem_group_cosh_id, area_or_plant)
  // — the natural key for any (pg × bundle) lineage. There should be
  // at most one ACTIVE per natural key; if none, the button hides.
  const loadMatchingGlobal = async () => {
    if (!rec) { setMatchingGlobal(null); return }
    try {
      const { data } = await api.get<{
        id: string; problem_group_cosh_id: string;
        area_or_plant: 'AREA_WISE' | 'PLANT_WISE' | null;
        status: string; version: number
      }[]>('/advisory/global/pg-recommendations')
      const match = data.find(g =>
        g.problem_group_cosh_id === rec.problem_group_cosh_id
        && g.area_or_plant === rec.area_or_plant
        && g.status === 'ACTIVE',
      )
      setMatchingGlobal(match ? { id: match.id, version: match.version } : null)
    } catch { setMatchingGlobal(null) }
  }

  useEffect(() => {
    loadRec()
    loadTimelines()
    loadReadiness()
    loadLineage()
  }, [clientId, recId])

  useEffect(() => { loadProblemName(); loadMatchingGlobal() }, [rec, clientId])

  async function handleAddTimeline(e: FormEvent) {
    e.preventDefault()
    setAddingTL(true); setTlError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/${recId}/timelines`, {
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
    } finally {
      setAddingTL(false)
    }
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
        `/client/${clientId}/pg-recommendations/${recId}/timelines/${showEditTL.id}`,
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
    await api.delete(`/client/${clientId}/pg-recommendations/${recId}/timelines/${tl.id}`)
    await loadTimelines()
    loadReadiness()
  }

  async function deletePractice(timelineId: string, practiceId: string) {
    if (!confirm('Delete this practice?')) return
    await api.delete(
      `/client/${clientId}/pg-recommendations/${recId}/timelines/${timelineId}/practices/${practiceId}`,
    )
    await loadTimelines()
  }

  async function handleCloneToDraft() {
    // Batch T (2026-05-18): clone-to-draft is now find-or-create —
    // if a DRAFT already exists in the lineage, the backend returns
    // it (no new row, no demotion). So no confirm dialog needed;
    // the SE just lands on the existing DRAFT or a freshly cloned
    // one. Only Publish creates new rows.
    setCloning(true); setCloneError('')
    try {
      const { data } = await api.post<Rec>(
        `/client/${clientId}/pg-recommendations/${recId}/clone-to-draft`,
      )
      router.push(`/cha/recommendations/${data.id}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setCloneError(msg || 'Failed to start a new draft.')
    } finally { setCloning(false) }
  }

  async function handleMakeEditable(srcId: string, srcVersion: number) {
    const existing = lineage.find(r => r.status === 'DRAFT')
    if (existing && existing.id !== srcId) {
      const ok = confirm(
        `A v${existing.version} DRAFT already exists in this lineage. ` +
        `Making v${srcVersion} editable will replace it (the existing ` +
        `draft becomes INACTIVE). Continue?`,
      )
      if (!ok) return
    }
    setMakingEditable(srcId); setCloneError('')
    try {
      const { data } = await api.post<Rec>(
        `/client/${clientId}/pg-recommendations/${srcId}/clone-to-draft`,
      )
      router.push(`/cha/recommendations/${data.id}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setCloneError(msg || 'Failed to make this version editable.')
    } finally { setMakingEditable(null) }
  }

  // Import-from-Global on the Timeline screen (2026-05-21). Behaviour
  // routes through the existing import endpoint:
  //   • Viewing ACTIVE / INACTIVE → no DRAFT in lineage → backend
  //     creates a new DRAFT row with the imported content. We route
  //     to it. No confirm.
  //   • Viewing DRAFT with no content → silent overwrite (nothing to
  //     destroy). No confirm.
  //   • Viewing DRAFT with content → ask before overwriting. The
  //     backend returns 409 draft_exists_confirm_overwrite by default;
  //     we pre-empt with a friendlier confirm here, then retry with
  //     overwrite=true.
  async function handleImportFromGlobal() {
    if (!clientId || !rec || !matchingGlobal) return
    setImportError('')
    const hasContent = rec.status === 'DRAFT' && timelines.length > 0
    if (hasContent) {
      const ok = confirm(
        `This DRAFT has ${timelines.length} timeline${timelines.length === 1 ? '' : 's'}. ` +
        `Re-importing from Global v${matchingGlobal.version} will replace all of it. Continue?`,
      )
      if (!ok) return
    }
    setImportingGlobal(true)
    try {
      const { data } = await api.post<Rec>(
        `/client/${clientId}/pg-recommendations/import/${matchingGlobal.id}` +
        (hasContent ? '?overwrite=true' : ''),
      )
      // ACTIVE/INACTIVE source → new DRAFT id. DRAFT source → same id.
      if (data.id !== recId) {
        router.push(`/cha/recommendations/${data.id}`)
      } else {
        await loadRec()
        await loadTimelines()
        await loadReadiness()
        await loadLineage()
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setImportError(msg || 'Failed to import from Global.')
    } finally { setImportingGlobal(false) }
  }

  async function handlePublish() {
    setPublishing(true); setPubError('')
    try {
      await api.post(`/client/${clientId}/pg-recommendations/${recId}/publish`)
      setShowPublishConfirm(false)
      await loadRec()
      await loadReadiness()
      await loadLineage()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setPubError(msg || 'Failed to publish.')
      await loadReadiness()
    } finally {
      setPublishing(false)
    }
  }

  if (!rec) return (
    <div className="max-w-4xl mx-auto pt-20 text-center text-slate-400">Loading recommendation…</div>
  )

  // Batch S/T (2026-05-18) — non-DRAFT rows are read-only. ACTIVE
  // rows are what farmers read live; editing them would leak
  // unreviewed changes. INACTIVE rows are historical record. Gate
  // all edit affordances on isDraft. The "Edit this version" button
  // (Batch T) wraps clone-to-draft so the SE can transition out of
  // read-only state with one click.
  const isDraft = rec.status === 'DRAFT'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <VersionHistorySection
        lineage={lineage}
        rowDetailUrl={(row) => `/cha/recommendations/${row.id}`}
        makingEditable={makingEditable}
        onMakeEditable={handleMakeEditable}
        // Display DRAFT rows as "v{nextVersion} (draft)" so two-v1
        // rows don't read as a duplicate. Batch T (2026-05-18).
        versionLabel={(row) => {
          if (row.status === 'DRAFT') {
            const otherMax = Math.max(
              0,
              ...lineage.filter(r => r.id !== row.id).map(r => r.version),
            )
            return `v${otherMax + 1} (draft)`
          }
          return `v${row.version}`
        }}
      />
      <div className="flex items-start gap-4">
        {/* Back link preserves the PG filter so the SE returns to the
            same single-PG view they entered from (Batch T, 2026-05-18).
            Falls back to the unfiltered list only if no problem_group
            is set on the row. */}
        <Link href={rec.problem_group_cosh_id
            ? `/cha/recommendations?pg=${encodeURIComponent(rec.problem_group_cosh_id)}`
            : '/cha/recommendations'}
          className="mt-1 text-slate-400 hover:text-slate-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900">
              {problemName || '(loading…)'}
            </h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[rec.status]}`}>
              {rec.status}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {rec.area_or_plant === 'AREA_WISE' ? 'Area-wise crops' :
             rec.area_or_plant === 'PLANT_WISE' ? 'Plant-wise crops' : '(no bundle set)'}
            {' · '}v{rec.version}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Link href={`/cha/recommendations/${recId}/preview`}
              className="text-sm font-medium px-4 py-2 rounded-xl border"
              style={{ borderColor: colour, color: colour }}>
              👁 Preview
            </Link>
            {/* Import from Global is always shown — disabled when no
                ACTIVE Global PG exists for this (PG × bundle) so the
                SE understands the state instead of guessing about a
                missing button. Available regardless of row status:
                the import endpoint creates a new DRAFT from ACTIVE /
                INACTIVE, or overwrites an existing DRAFT after confirm. */}
            <button onClick={handleImportFromGlobal}
              disabled={importingGlobal || !matchingGlobal}
              title={matchingGlobal
                ? `Pull content from Global v${matchingGlobal.version}`
                : 'No published Global recommendation exists for this Problem Group + bundle yet. Ask the Content Manager to publish one.'}
              className="text-sm font-medium px-4 py-2 rounded-xl border disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: colour, color: colour }}>
              {importingGlobal ? 'Importing…' :
                !matchingGlobal ? '↓ Import from Global (none published)' :
                isDraft ? '↓ Import from Global' : '↓ Import from Global (new draft)'}
            </button>
            {/* Batch T (2026-05-18): single Edit button on non-DRAFT
                rows replaces the big read-only banner. ACTIVE → start
                a fresh draft; INACTIVE → revert from this history. */}
            {!isDraft && (
              <button onClick={handleCloneToDraft} disabled={cloning}
                className="text-sm font-medium px-4 py-2 rounded-xl border disabled:opacity-50"
                style={{ borderColor: colour, color: colour }}>
                {cloning ? 'Starting…' :
                  rec.status === 'ACTIVE' ? '✏ Edit this version' : '✏ Make editable'}
              </button>
            )}
          </div>
          {!isDraft && cloneError && (
            <p className="text-xs text-red-600">{cloneError}</p>
          )}
          {importError && (
            <p className="text-xs text-red-600">{importError}</p>
          )}
          {rec.status === 'DRAFT' && (
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

      {/* Pre-publish gate panel */}
      {rec.status === 'DRAFT' && readiness && (
        readiness.ready ? (
          <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-green-600 mt-0.5">✓</span>
            <div className="text-sm">
              <p className="font-medium text-green-800">Ready to publish</p>
              <p className="text-green-700 mt-0.5">
                Click <strong>Publish</strong> to make this recommendation v{rec.version + 1}.
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

      {/* Timelines */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">
            Timelines <span className="text-slate-400 font-normal text-sm">({timelines.length})</span>
          </h2>
          {isDraft && (
            <button onClick={() => setShowAddTL(true)}
              className="text-sm font-medium px-3 py-1.5 rounded-xl border"
              style={{ borderColor: colour, color: colour }}>
              + Add Timeline
            </button>
          )}
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
                    {isDraft && (
                      <>
                        <button onClick={e => { e.stopPropagation(); openEditTimeline(tl) }}
                          className="text-slate-300 hover:text-blue-500 p-1.5"
                          title="Edit timeline">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={e => { e.stopPropagation(); deleteTimeline(tl) }}
                          className="text-slate-300 hover:text-red-400 p-1.5"
                          title="Delete timeline">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    )}
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
                              {isDraft && (
                                <>
                                  <button onClick={e => {
                                    e.stopPropagation()
                                    setEditingPractice({ timelineId: tl.id, practice: p })
                                    setShowAddPractice(tl.id)
                                  }}
                                    className="text-slate-300 hover:text-blue-500 p-1" title="Edit practice">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                  <button onClick={e => { e.stopPropagation(); deletePractice(tl.id, p.id) }}
                                    className="text-slate-300 hover:text-red-400 p-1" title="Delete practice">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </>
                              )}
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
                    {isDraft && (
                      <button onClick={() => { setEditingPractice(null); setShowAddPractice(tl.id) }}
                        className="w-full mt-2 text-sm py-2 rounded-xl border border-dashed border-slate-200 text-slate-500 hover:bg-slate-50">
                        + Add Practice
                      </button>
                    )}

                    {/* Relations + CQs — shared with SA Global CCA
                        + CA-CCA. Batch N2 (2026-05-18). Hidden on
                        non-DRAFT rows (Batch S, 2026-05-18) — they
                        are always-editable widgets and would let the
                        user mutate live ACTIVE state. Use the
                        Preview page to inspect relations/CQs on
                        ACTIVE / INACTIVE versions. */}
                    {isDraft && (
                      <>
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
                        pipe: 'PG_CLIENT',
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
                        pipe: 'PG_CLIENT',
                        clientId: clientId || '',
                        parentId: recId,
                      }}
                    />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
                  required placeholder="e.g. Week 1 — initial response"
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

      {/* Add / Edit Practice — shared modal with full element form
          (Phase 3 of CA-portal parity, 2026-05-17). Same component
          SA-portal CCA + PG use; mode flips by editingPractice.
          cropCoshId is empty because PG isn't crop-bound. */}
      <PracticeFormModal
        open={!!showAddPractice}
        mode={editingPractice ? 'edit' : 'create'}
        timelineId={showAddPractice || ''}
        cropCoshId={''}
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
        pipe={{ pipe: 'PG_CLIENT', clientId: clientId || '', parentId: recId }}
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

      {/* Publish confirmation modal */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                Publish {problemName || '(loading…)'}?
              </h2>
              <p className="text-slate-500 text-sm mt-1.5">
                {rec.area_or_plant === 'AREA_WISE' ? 'Area-wise' : 'Plant-wise'} bundle
                {rec.version > 0 ? ` will become v${rec.version + 1}` : ''}.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <p><strong>Timelines:</strong> {timelines.length}</p>
                <p><strong>Practices:</strong> {timelines.reduce((s, t) => s + t.practices.length, 0)}</p>
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
