'use client'
import { useEffect, useState, FormEvent, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import PackageCalendar from '@/components/cca/PackageCalendar'
import { PracticeFormModal, type ExistingPractice } from '@/components/advisory-authoring/PracticeFormModal'
import { RelationsSection } from '@/components/advisory-authoring/RelationsSection'
import { CQsSection } from '@/components/advisory-authoring/CQsSection'
import { useReadOnlyGuard } from '@/components/advisory-authoring/ReadOnlyGuard'
import { VersionHistorySection, type LineageRow as SharedLineageRow } from '@/components/advisory-authoring/LineageSection'
import { practiceShortLabel } from '@/lib/practice-label'
import { LocationPicker, pairKey, unpairKey, type LocationUniverse } from '@/components/locations/LocationPicker'

interface Package {
  id: string; name: string; crop_cosh_id: string
  package_type: 'ANNUAL' | 'PERENNIAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  duration_days: number; version: number; description: string | null
  start_date_label_cosh_id: string | null
  parent_global_id: string | null
  // Batch HH (2026-05-19) — footprint/crop cascade audit fields
  // from PackageOut. `cascade_inactivated_reason` is set only when
  // status went INACTIVE because of a cascade; cleared on
  // successful republish. `last_cascade_at` fires on every cascade
  // including shrinks that didn't flip status, so the banner
  // appears even on still-ACTIVE packages whose location list was
  // narrowed by the CA.
  cascade_inactivated_reason?: 'locations_cleared_by_cascade' | 'crop_removed_from_belt' | null
  last_cascade_at?: string | null
}
interface LineageRow {
  id: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  published_at: string | null
  created_at: string
  created_via: string | null
  source_version_id: string | null
  is_current: boolean
}
interface Timeline {
  id: string; package_id: string; name: string
  from_type: 'DBS' | 'DAS' | 'CALENDAR'
  from_value: number; to_value: number; display_order: number
  status?: 'ACTIVE' | 'INACTIVE'  // Batch 28 — Inactive timelines stay listed but exit farmer advisory
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
  id: string; timeline_id: string
  l0_type: 'INPUT' | 'NON_INPUT' | 'INSTRUCTION' | 'MEDIA'
  l1_type: string | null; l2_type: string | null; display_order: number
  is_special_input: boolean; relation_id: string | null
  is_brand_locked?: boolean
  frequency_days?: number | null
  elements?: PracticeElement[]
}
interface PackageAuthor {
  id: string
  user_id: string
  user_name: string | null
  display_order: number
}
interface PortalUser {
  id: string
  email: string
  name: string
  role: string
  status: string
}
interface ClientParameter {
  id: string
  crop_cosh_id: string
  name: string
  source: 'COSH' | 'CUSTOM'
  display_order: number
}
interface ClientVariable {
  id: string
  parameter_id: string
  name: string
  cosh_id: string | null
}
interface PackageVariableAssignment {
  parameter_id: string
  variable_id: string
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
  published_at: string | null
  subscriber_count: number
  blocker_code?: string
  missing?: PublishReadinessItem[]
}

const FROM_TYPE_LABEL = { DBS: 'Days Before Sowing', DAS: 'Days After Sowing', CALENDAR: 'Calendar' }

// 2026-05-22: live Cosh list from `/cosh/options/start-date-names`.
interface StartDateOption { cosh_id: string; name: string }

// Reference Type constrained by package_type (matches SA portal):
//   Annual    → DAS / DBS only
//   Perennial → CALENDAR only
const ALLOWED_FROM_TYPES_BY_PACKAGE_TYPE: Record<string, string[]> = {
  ANNUAL: ['DAS', 'DBS'],
  PERENNIAL: ['CALENDAR'],
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_OFFSETS = MONTH_DAYS.reduce<number[]>((acc, d, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + MONTH_DAYS[i - 1])
  return acc
}, [])

function dayOfYear(month: number, day: number): number {
  return MONTH_OFFSETS[month - 1] + day
}

function doyToMonthDay(doy: number): { month: number; day: number } {
  if (doy < 1) return { month: 1, day: 1 }
  if (doy > 365) return { month: 12, day: 31 }
  let m = 0
  while (m < 11 && MONTH_OFFSETS[m + 1] < doy) m++
  return { month: m + 1, day: doy - MONTH_OFFSETS[m] }
}

function shortMonthDay(doy: number): string {
  const { month, day } = doyToMonthDay(doy)
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${day}`
}

function formatTimelineRange(tl: { from_type: string; from_value: number; to_value: number }): string {
  if (tl.from_type === 'CALENDAR') {
    return `${shortMonthDay(tl.from_value)} → ${shortMonthDay(tl.to_value)}`
  }
  return `Day ${tl.from_value} → ${tl.to_value}`
}

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
  // Crop friendly name lookup — fetched once from /client/{cid}/crops
  // so the header / publish confirm / signature empty state show
  // "Tomato" instead of the raw Cosh UUID.
  const [cropName, setCropName] = useState<string>('')
  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [practiceMap, setPracticeMap] = useState<Record<string, Practice[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [pubError, setPubError] = useState('')
  const [readiness, setReadiness] = useState<PublishReadiness | null>(null)
  const [showPublishConfirm, setShowPublishConfirm] = useState(false)
  const [practiceCounts, setPracticeCounts] = useState<Record<string, number>>({})

  // Package locations — state/district pairs that scope the
  // package to specific geographies. Rebuilt 2026-05-17 (step 3)
  // to use the shared <LocationPicker>. Universe is bounded to
  // the company's ClientLocation footprint.
  const [locations, setLocations] = useState<{ id: string; state_cosh_id: string; state_name: string | null; district_cosh_id: string; district_name: string | null }[]>([])
  const [locationOptions, setLocationOptions] = useState<LocationUniverse>({ states: [] })
  const [showEditLocations, setShowEditLocations] = useState(false)
  const [locationsSelected, setLocationsSelected] = useState<Set<string>>(new Set())
  const [savingLocations, setSavingLocations] = useState(false)
  const [locationsError, setLocationsError] = useState('')

  // Footprint cascade banner (Batch HH, 2026-05-19). Read the
  // dismissal mark from localStorage scoped per-package; a NEW
  // cascade (different last_cascade_at) re-shows the banner so
  // the SE has to actively re-dismiss every distinct event.
  const [dismissedCascadeAt, setDismissedCascadeAt] = useState<string | null>(null)
  useEffect(() => {
    if (!pkg?.id) return
    if (typeof window === 'undefined') return
    setDismissedCascadeAt(
      localStorage.getItem(`cascadeBanner.dismissed.${pkg.id}`),
    )
  }, [pkg?.id])
  const cascadeBannerVisible = !!pkg?.last_cascade_at
    && pkg.last_cascade_at !== dismissedCascadeAt
  function dismissCascadeBanner() {
    if (!pkg?.last_cascade_at) return
    localStorage.setItem(
      `cascadeBanner.dismissed.${pkg.id}`,
      pkg.last_cascade_at,
    )
    setDismissedCascadeAt(pkg.last_cascade_at)
  }

  // Parameters & Variables (Package Signature). Mirror of SA Global
  // CCA (2026-05-17). Lives behind ✎ Set Signature; compact summary
  // in the header. CA-side endpoints under /client/{cid}/parameters
  // and /client/{cid}/packages/{pkg}/variables.
  const [showSignature, setShowSignature] = useState(false)
  const [parameters, setParameters] = useState<ClientParameter[]>([])
  const [variablesByParam, setVariablesByParam] = useState<Record<string, ClientVariable[]>>({})
  const [packageVariables, setPackageVariables] = useState<PackageVariableAssignment[]>([])
  const [newVarForParamId, setNewVarForParamId] = useState<string | null>(null)
  const [newVarName, setNewVarName] = useState('')
  const [pvSaveError, setPvSaveError] = useState('')
  const [creatingParam, setCreatingParam] = useState(false)
  const [paramDraft, setParamDraft] = useState<{ name: string; variables: string[] }>({
    name: '', variables: ['', ''],
  })
  const [editingParamId, setEditingParamId] = useState<string | null>(null)
  const [editingParamName, setEditingParamName] = useState('')
  const [editingVarKey, setEditingVarKey] = useState<string | null>(null)
  const [editingVarName, setEditingVarName] = useState('')
  const [hideUnusedParams, setHideUnusedParams] = useState(false)

  // Map for jumping from a calendar band to its timeline editor block.
  const timelineRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Timeline form
  const [showAddTL, setShowAddTL] = useState(false)
  const [addingTL, setAddingTL] = useState(false)
  const [tlError, setTlError] = useState('')
  const [tlForm, setTlForm] = useState({
    name: '', from_type: 'DAS', from_value: '0', to_value: '30', display_order: '0',
    // Calendar-only — drive month/day pickers; serialised to
    // from_value/to_value (day-of-year) on submit.
    from_month: '1', from_day: '1', to_month: '12', to_day: '31',
  })

  // Timeline import
  const [showImport, setShowImport] = useState(false)
  const [importPackages, setImportPackages] = useState<Package[]>([])
  const [importSourcePkgId, setImportSourcePkgId] = useState('')
  const [importTimelines, setImportTimelines] = useState<Timeline[]>([])
  const [importSourceTlId, setImportSourceTlId] = useState('')
  const [importNewName, setImportNewName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  // Practice authoring goes through the shared <PracticeFormModal>
  // (Phase 2 of CA-portal parity, 2026-05-17). `showAddPractice`
  // holds the timeline id the modal opens against; `editingPractice`
  // carries the row when the modal opens in edit mode.
  const [showAddPractice, setShowAddPractice] = useState<string | null>(null)
  const [editingPractice, setEditingPractice] = useState<{ timelineId: string; practice: Practice } | null>(null)
  const [expandedPractice, setExpandedPractice] = useState<string | null>(null)

  // Relations mirror — populated by RelationsSection's
  // onRelationsChange callback so CQsSection can resolve relation
  // labels + gate eligibility without a parallel fetch. Mirror of
  // the SA Global CCA pattern (Batch 39P-b2/c).
  const [relationsByTimeline, setRelationsByTimeline] = useState<Record<string, unknown[]>>({})

  // Package authors (Subject Experts of this company credited on
  // the package). Backend at PUT /packages/{pkg}/authors does the
  // replace-all + SE validation; UI here is name-pick + reorder
  // only. Designation + professional_profile come from User
  // Management later (Tasks D+E).
  const [authors, setAuthors] = useState<PackageAuthor[]>([])
  const [availableSEs, setAvailableSEs] = useState<PortalUser[]>([])
  const [showEditAuthors, setShowEditAuthors] = useState(false)
  const [authorsDraft, setAuthorsDraft] = useState<{ user_id: string; user_name: string | null }[]>([])
  const [addAuthorPick, setAddAuthorPick] = useState('')
  const [savingAuthors, setSavingAuthors] = useState(false)
  const [authorsError, setAuthorsError] = useState('')

  // Edit Package details — mirror of SA Global CCA (2026-05-17).
  // 5-field form: Name, Start Date Label, Duration, Description,
  // Status. Crop + Type stay immutable.
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', duration_days: '120',
    start_date_label_cosh_id: '',
    description: '',
    status: 'DRAFT' as 'DRAFT' | 'ACTIVE' | 'INACTIVE',
  })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [startDateLabels, setStartDateLabels] = useState<StartDateOption[]>([])

  useEffect(() => {
    api.get<StartDateOption[]>(`/cosh/options/start-date-names`)
      .then(r => setStartDateLabels(r.data))
      .catch(() => setStartDateLabels([]))
  }, [])

  // Edit Timeline (Batch 28 parity). `showEditTL` carries the
  // Timeline being edited; from_type stays read-only (locked at
  // create time).
  const [showEditTL, setShowEditTL] = useState<Timeline | null>(null)
  const [editingTL, setEditingTL] = useState(false)
  const [editTLError, setEditTLError] = useState('')
  const [editTLForm, setEditTLForm] = useState({
    name: '', from_value: '1', to_value: '30',
    from_month: '1', from_day: '1', to_month: '12', to_day: '31',
    status: 'ACTIVE',
  })

  // Lineage / multi-row versioning (locked 2026-05-11)
  const [lineage, setLineage] = useState<LineageRow[]>([])
  const [pulling, setPulling] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [makingEditable, setMakingEditable] = useState<string | null>(null)
  const [lineageError, setLineageError] = useState('')

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

  const loadLocations = async () => {
    if (!clientId || !packageId) return
    try {
      const { data } = await api.get<{ id: string; state_cosh_id: string; state_name: string | null; district_cosh_id: string; district_name: string | null }[]>(
        `/client/${clientId}/packages/${packageId}/locations`,
      )
      setLocations(data)
    } catch {
      setLocations([])
    }
  }

  const loadLocationOptions = async () => {
    if (!clientId) return
    try {
      const { data } = await api.get<LocationUniverse>(
        `/client/${clientId}/location-options-for-package`,
      )
      setLocationOptions(data)
    } catch {
      setLocationOptions({ states: [] })
    }
  }

  const loadAuthors = async () => {
    if (!clientId || !packageId) return
    try {
      const { data } = await api.get<PackageAuthor[]>(
        `/client/${clientId}/packages/${packageId}/authors`,
      )
      setAuthors(data)
    } catch {
      setAuthors([])
    }
  }

  const loadAvailableSEs = async () => {
    if (!clientId) return
    try {
      const { data } = await api.get<PortalUser[]>(`/client/${clientId}/users`)
      setAvailableSEs(
        data.filter(u => u.role === 'SUBJECT_EXPERT' && u.status === 'ACTIVE'),
      )
    } catch {
      setAvailableSEs([])
    }
  }

  function openEditAuthors() {
    setAuthorsDraft(
      authors
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map(a => ({ user_id: a.user_id, user_name: a.user_name })),
    )
    setAddAuthorPick('')
    setAuthorsError('')
    setShowEditAuthors(true)
  }

  function addAuthorToDraft() {
    if (!addAuthorPick) return
    if (authorsDraft.some(a => a.user_id === addAuthorPick)) return
    const se = availableSEs.find(u => u.id === addAuthorPick)
    if (!se) return
    setAuthorsDraft([...authorsDraft, { user_id: se.id, user_name: se.name }])
    setAddAuthorPick('')
  }

  function removeAuthorFromDraft(user_id: string) {
    setAuthorsDraft(authorsDraft.filter(a => a.user_id !== user_id))
  }

  function moveAuthorInDraft(index: number, delta: -1 | 1) {
    const next = index + delta
    if (next < 0 || next >= authorsDraft.length) return
    const copy = authorsDraft.slice()
    const [row] = copy.splice(index, 1)
    copy.splice(next, 0, row)
    setAuthorsDraft(copy)
  }

  async function handleSaveAuthors() {
    setSavingAuthors(true); setAuthorsError('')
    try {
      const body = authorsDraft.map((a, i) => ({
        user_id: a.user_id,
        display_order: i,
      }))
      await api.put(`/client/${clientId}/packages/${packageId}/authors`, body)
      setShowEditAuthors(false)
      await loadAuthors()
      loadReadiness()
    } catch (err: unknown) {
      setAuthorsError(extractErrorMessage(err, 'Failed to save authors.'))
    } finally {
      setSavingAuthors(false)
    }
  }

  function openEditLocations() {
    const sel = new Set<string>()
    for (const l of locations) sel.add(pairKey(l.state_cosh_id, l.district_cosh_id))
    setLocationsSelected(sel)
    setLocationsError('')
    setShowEditLocations(true)
  }

  async function handleSaveLocations() {
    setSavingLocations(true); setLocationsError('')
    const pairs = Array.from(locationsSelected).map(k => unpairKey(k))
    try {
      await api.put(
        `/client/${clientId}/packages/${packageId}/locations`,
        pairs,
      )
      setShowEditLocations(false)
      await loadLocations()
      loadReadiness()
    } catch (err: unknown) {
      setLocationsError(extractErrorMessage(err, 'Failed to save locations.'))
    } finally {
      setSavingLocations(false)
    }
  }

  // ── Parameters & Variables ────────────────────────────────────────────────

  const loadParameters = async (cropCoshId: string) => {
    if (!clientId) return
    const { data } = await api.get<ClientParameter[]>(
      `/client/${clientId}/parameters?crop_cosh_id=${encodeURIComponent(cropCoshId)}`,
    )
    setParameters(data)
    const map: Record<string, ClientVariable[]> = {}
    for (const p of data) {
      const r = await api.get<ClientVariable[]>(
        `/client/${clientId}/parameters/${p.id}/variables`,
      )
      map[p.id] = r.data
    }
    setVariablesByParam(map)
  }

  const loadPackageVariables = async () => {
    if (!clientId) return
    const { data } = await api.get<PackageVariableAssignment[]>(
      `/client/${clientId}/packages/${packageId}/variables`,
    )
    setPackageVariables(data)
  }

  function openCreateParam() {
    setParamDraft({ name: '', variables: ['', ''] })
    setPvSaveError('')
    setCreatingParam(true)
  }

  async function handleCreateCustomParam() {
    if (!pkg || !clientId) return
    const name = paramDraft.name.trim()
    const variables = paramDraft.variables.map(v => v.trim()).filter(Boolean)
    if (!name) { setPvSaveError('Parameter name is required.'); return }
    if (variables.length < 2) { setPvSaveError('At least 2 variables are required.'); return }
    setPvSaveError('')
    try {
      await api.post(`/client/${clientId}/parameters`, {
        crop_cosh_id: pkg.crop_cosh_id,
        name,
        variables: variables.map(n => ({ name: n })),
      })
      setCreatingParam(false)
      await loadParameters(pkg.crop_cosh_id)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to create parameter.'))
    }
  }

  async function handleRenameParameter(paramId: string, newName: string) {
    if (!pkg || !clientId || !newName.trim()) return
    setPvSaveError('')
    try {
      await api.put(`/client/${clientId}/parameters/${paramId}`, { name: newName.trim() })
      setEditingParamId(null)
      await loadParameters(pkg.crop_cosh_id)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to rename parameter.'))
    }
  }

  async function handleDeleteParameter(paramId: string, paramName: string) {
    if (!pkg || !clientId) return
    if (!confirm(`Delete parameter "${paramName}" and all its variables?`)) return
    setPvSaveError('')
    try {
      await api.delete(`/client/${clientId}/parameters/${paramId}`)
      await loadParameters(pkg.crop_cosh_id)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to delete parameter.'))
    }
  }

  async function handleRenameVariable(paramId: string, varId: string, newName: string) {
    if (!pkg || !clientId || !newName.trim()) return
    setPvSaveError('')
    try {
      await api.put(
        `/client/${clientId}/parameters/${paramId}/variables/${varId}`,
        { name: newName.trim() },
      )
      setEditingVarKey(null)
      await loadParameters(pkg.crop_cosh_id)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to rename variable.'))
    }
  }

  async function handleDeleteVariable(paramId: string, varId: string, varName: string) {
    if (!pkg || !clientId) return
    if (!confirm(`Delete variable "${varName}"?`)) return
    setPvSaveError('')
    try {
      await api.delete(`/client/${clientId}/parameters/${paramId}/variables/${varId}`)
      await loadParameters(pkg.crop_cosh_id)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to delete variable.'))
    }
  }

  async function handleAddVariable(parameterId: string) {
    if (!newVarName.trim() || !pkg || !clientId) return
    setPvSaveError('')
    try {
      await api.post(
        `/client/${clientId}/parameters/${parameterId}/variables`,
        { parameter_id: parameterId, name: newVarName.trim() },
      )
      setNewVarName(''); setNewVarForParamId(null)
      await loadParameters(pkg.crop_cosh_id)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to add variable.'))
    }
  }

  function getAssignedVariableId(parameterId: string): string {
    return packageVariables.find(pv => pv.parameter_id === parameterId)?.variable_id || ''
  }

  async function handleAssignVariable(parameterId: string, variableId: string) {
    if (!clientId) return
    setPvSaveError('')
    const next: PackageVariableAssignment[] = packageVariables
      .filter(pv => pv.parameter_id !== parameterId)
    if (variableId) {
      next.push({ parameter_id: parameterId, variable_id: variableId })
    }
    try {
      await api.put(
        `/client/${clientId}/packages/${packageId}/variables`,
        { assignments: next },
      )
      setPackageVariables(next)
    } catch (err: unknown) {
      setPvSaveError(extractErrorMessage(err, 'Failed to update package signature.'))
    }
  }

  useEffect(() => {
    if (!pkg) return
    loadParameters(pkg.crop_cosh_id)
    loadPackageVariables()
    // Resolve crop_cosh_id → friendly name so the UI never shows a UUID.
    if (clientId && pkg.crop_cosh_id) {
      api.get<{ crop_cosh_id: string; crop_name_en?: string | null }[]>(
        `/client/${clientId}/crops`,
      ).then(r => {
        const match = r.data.find(c => c.crop_cosh_id === pkg.crop_cosh_id)
        if (match?.crop_name_en) setCropName(match.crop_name_en)
      }).catch(() => { /* leave cropName empty; UI handles fallback */ })
    }
  }, [pkg?.crop_cosh_id])

  useEffect(() => {
    if (!clientId) return
    api.get<Package>(`/client/${clientId}/packages/${packageId}`)
      .then(r => setPkg(r.data))
      .catch(() => router.replace('/cca/packages'))
    loadTimelines()
    loadReadiness()
    loadLocations()
    loadLocationOptions()
    loadAuthors()
    loadAvailableSEs()
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
      await loadLineage()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message
      setPubError(extractErrorMessage(err, 'Failed to publish.'))
      // Re-fetch readiness — server-side state may have shifted
      // (e.g. crop just dropped off the belt) since the panel was
      // last rendered, surfacing a different blocker.
      await loadReadiness()
    } finally { setPublishing(false) }
  }

  function openEdit() {
    if (!pkg) return
    setEditForm({
      name: pkg.name,
      duration_days: String(pkg.duration_days),
      start_date_label_cosh_id: pkg.start_date_label_cosh_id || startDateLabels[0]?.cosh_id || '',
      description: pkg.description || '',
      status: pkg.status,
    })
    setEditError('')
    setShowEdit(true)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!pkg) return
    setSavingEdit(true); setEditError('')
    try {
      const body: Record<string, unknown> = {
        name: editForm.name.trim() || undefined,
        duration_days: parseInt(editForm.duration_days),
        start_date_label_cosh_id: editForm.start_date_label_cosh_id,
        description: editForm.description.trim() || null,
      }
      // Only send status when SE actually toggled it. DRAFT → ACTIVE
      // is server-side blocked (must go through Publish).
      if (editForm.status !== pkg.status) {
        body.status = editForm.status
      }
      const { data } = await api.put<Package>(`/client/${clientId}/packages/${packageId}`, body)
      setPkg(data)
      setShowEdit(false)
    } catch (err: unknown) {
      setEditError(extractErrorMessage(err, 'Failed to save changes.'))
    } finally { setSavingEdit(false) }
  }

  async function openImport() {
    setShowImport(true)
    setImportError('')
    setImportSourcePkgId('')
    setImportTimelines([])
    if (!pkg) return
    const { data } = await api.get<Package[]>(`/client/${clientId}/packages`)
    // Same-crop only — Packages live inside a Crop (Crops → Packages
    // → Timelines → Practices). Include the current Package itself
    // only when it has ≥ 1 timeline (otherwise there's nothing to
    // clone-within-package).
    const sameCrop = data.filter(p => p.crop_cosh_id === pkg.crop_cosh_id)
    const selfHasTimeline = timelines.length > 0
    setImportPackages(
      sameCrop.filter(p => p.id !== packageId || selfHasTimeline)
    )
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
      setImportError(extractErrorMessage(err, 'Import failed.'))
    } finally { setImporting(false) }
  }

  function openAddTimeline() {
    if (!pkg) return
    const isPerennial = pkg.package_type === 'PERENNIAL'
    setTlForm({
      name: '',
      from_type: isPerennial ? 'CALENDAR' : 'DAS',
      from_value: '0',
      to_value: '30',
      from_month: '1', from_day: '1',
      to_month: '12', to_day: '31',
      display_order: '0',
    })
    setTlError('')
    setShowAddTL(true)
  }

  async function handleAddTimeline(e: FormEvent) {
    e.preventDefault()
    setTlError('')

    // Compute from_value / to_value per Reference Type.
    let fromVal: number
    let toVal: number
    if (tlForm.from_type === 'CALENDAR') {
      fromVal = dayOfYear(parseInt(tlForm.from_month), parseInt(tlForm.from_day))
      toVal = dayOfYear(parseInt(tlForm.to_month), parseInt(tlForm.to_day))
      if (fromVal >= toVal) {
        setTlError('FROM date must be earlier than TO date in the calendar year.')
        return
      }
    } else {
      fromVal = parseInt(tlForm.from_value)
      toVal = parseInt(tlForm.to_value)
      if (Number.isNaN(fromVal) || Number.isNaN(toVal)) {
        setTlError('FROM and TO must be whole numbers.'); return
      }
      if (tlForm.from_type === 'DAS' && fromVal >= toVal) {
        setTlError('For DAS, FROM (smaller) must be less than TO (larger). The number increases as the season progresses.')
        return
      }
      if (tlForm.from_type === 'DBS' && fromVal <= toVal) {
        setTlError('For DBS, FROM (larger) must be greater than TO (smaller). The number counts down toward sowing.')
        return
      }
    }

    setAddingTL(true)
    try {
      await api.post(`/client/${clientId}/packages/${packageId}/timelines`, {
        name: tlForm.name,
        from_type: tlForm.from_type,
        from_value: fromVal,
        to_value: toVal,
        display_order: parseInt(tlForm.display_order),
      })
      setShowAddTL(false)
      await loadTimelines()
      loadReadiness()
    } catch (err: unknown) {
      setTlError(extractErrorMessage(err, 'Failed to add timeline.'))
    } finally { setAddingTL(false) }
  }

  function openEditTimeline(tl: Timeline) {
    const isCalendar = tl.from_type === 'CALENDAR'
    const fromMD = isCalendar ? doyToMonthDay(tl.from_value) : { month: 1, day: 1 }
    const toMD = isCalendar ? doyToMonthDay(tl.to_value) : { month: 12, day: 31 }
    setEditTLForm({
      name: tl.name,
      from_value: String(tl.from_value),
      to_value: String(tl.to_value),
      from_month: String(fromMD.month), from_day: String(fromMD.day),
      to_month: String(toMD.month), to_day: String(toMD.day),
      status: tl.status || 'ACTIVE',
    })
    setEditTLError('')
    setShowEditTL(tl)
  }

  async function handleEditTimeline(e: FormEvent) {
    e.preventDefault()
    if (!showEditTL) return
    setEditTLError('')

    const isCalendar = showEditTL.from_type === 'CALENDAR'
    let fromVal: number, toVal: number
    if (isCalendar) {
      fromVal = dayOfYear(parseInt(editTLForm.from_month), parseInt(editTLForm.from_day))
      toVal = dayOfYear(parseInt(editTLForm.to_month), parseInt(editTLForm.to_day))
      if (fromVal >= toVal) {
        setEditTLError('FROM date must be earlier than TO date in the calendar year.')
        return
      }
    } else {
      fromVal = parseInt(editTLForm.from_value)
      toVal = parseInt(editTLForm.to_value)
      if (Number.isNaN(fromVal) || Number.isNaN(toVal)) {
        setEditTLError('FROM and TO must be whole numbers.'); return
      }
      if (showEditTL.from_type === 'DAS' && fromVal >= toVal) {
        setEditTLError('For DAS, FROM (smaller) must be less than TO (larger).'); return
      }
      if (showEditTL.from_type === 'DBS' && fromVal <= toVal) {
        setEditTLError('For DBS, FROM (larger) must be greater than TO (smaller).'); return
      }
    }

    setEditingTL(true)
    try {
      const { data } = await api.put<Timeline>(
        `/client/${clientId}/packages/${packageId}/timelines/${showEditTL.id}`,
        {
          name: editTLForm.name,
          from_value: fromVal,
          to_value: toVal,
          status: editTLForm.status,
        },
      )
      setTimelines(tls => tls.map(t => t.id === data.id ? data : t))
      setShowEditTL(null)
      loadReadiness()
    } catch (err: unknown) {
      setEditTLError(extractErrorMessage(err, 'Failed to save timeline.'))
    } finally { setEditingTL(false) }
  }

  async function handleDeleteTimeline(tl: Timeline) {
    if (!confirm(`Delete timeline "${tl.name}"? All practices in it will also be deleted.`)) return
    try {
      await api.delete(`/client/${clientId}/packages/${packageId}/timelines/${tl.id}`)
      await loadTimelines()
      loadReadiness()
      if (expanded === tl.id) setExpanded(null)
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete timeline.'))
    }
  }

  async function handleDeletePractice(timelineId: string, practiceId: string) {
    if (!confirm('Delete this practice?')) return
    try {
      await api.delete(`/client/${clientId}/timelines/${timelineId}/practices/${practiceId}`)
      await loadPractices(timelineId)
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete practice.'))
    }
  }

  // ── Multi-row versioning actions ──────────────────────────────────────────

  const loadLineage = async () => {
    if (!clientId || !packageId) return
    try {
      const { data } = await api.get<LineageRow[]>(
        `/client/${clientId}/packages/${packageId}/lineage`,
      )
      setLineage(data)
    } catch {
      setLineage([])
    }
  }

  function extractErrorMessage(err: unknown, fallback: string): string {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    if (typeof detail === 'string') return detail
    const obj = detail as { code?: string; message?: string } | undefined
    if (obj?.code === 'package_not_pushed_yet') {
      return 'Not shared by your Content Manager yet.'
    }
    return obj?.message || fallback
  }

  async function handlePullNewVersion() {
    if (!pkg?.parent_global_id) return
    setPulling(true); setLineageError('')
    try {
      const { data } = await api.post<Package>(
        `/client/${clientId}/packages/${pkg.parent_global_id}/pull`,
      )
      router.push(`/advisory/${data.id}`)
    } catch (err) {
      setLineageError(extractErrorMessage(err, 'Failed to pull.'))
    } finally { setPulling(false) }
  }

  async function handleCloneToDraft() {
    setCloning(true); setLineageError('')
    try {
      const { data } = await api.post<Package>(
        `/client/${clientId}/packages/${packageId}/clone-to-draft`,
      )
      router.push(`/advisory/${data.id}`)
    } catch (err) {
      setLineageError(extractErrorMessage(err, 'Failed to start new edit.'))
    } finally { setCloning(false) }
  }

  // 2026-05-22 — companion to handleCloneToDraft for the shared
  // <VersionHistorySection>. Allows the SE to "+ Start new edit"
  // from any non-current historical (INACTIVE) row in the lineage.
  // Mirrors CA-PG / CA-SP handleMakeEditable.
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
    setMakingEditable(srcId); setLineageError('')
    try {
      const { data } = await api.post<Package>(
        `/client/${clientId}/packages/${srcId}/clone-to-draft`,
      )
      router.push(`/advisory/${data.id}`)
    } catch (err) {
      setLineageError(extractErrorMessage(err, 'Failed to make this version editable.'))
    } finally { setMakingEditable(null) }
  }


  useEffect(() => { if (pkg) loadLineage() }, [pkg?.id])

  // 2026-05-21 — gate every edit action on DRAFT status. Read-only
  // rows (ACTIVE / INACTIVE) cannot be mutated; clicking any +Add /
  // ✎Edit / Delete pops a caution modal directing the user to the
  // "+ Start new edit" button. Backend still 422s as defence-in-depth;
  // this just stops the user from filling in a form that won't save.
  // Hook lives ABOVE the early-return so Rules of Hooks hold.
  const editorReadOnly = pkg ? pkg.status !== 'DRAFT' : true
  const { tryEdit, GuardModal } = useReadOnlyGuard({
    isReadOnly: editorReadOnly,
    statusLabel: pkg?.status?.toLowerCase() || 'published',
  })

  if (!pkg) return (
    <div className="max-w-4xl mx-auto pt-20 text-center text-slate-400">Loading package…</div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Version history (Batch 39P-d, 2026-05-22 unified): one shared
          component across CA-CCA / CA-PG / CA-SP / SA-CCA / SA-PG.
          Mounted near the top of the detail page so the SE sees the
          lineage context before scrolling through Timelines /
          Practices. Replaces the prior inline panel that lived at
          the bottom of this page. */}
      <VersionHistorySection
        lineage={lineage as unknown as SharedLineageRow[]}
        rowDetailUrl={(row) => `/advisory/${row.id}`}
        makingEditable={makingEditable}
        onMakeEditable={handleMakeEditable}
        versionLabel={(row) => {
          if (row.status === 'DRAFT') {
            const otherMax = Math.max(
              0, ...lineage.filter(r => r.id !== row.id).map(r => r.version),
            )
            return `v${otherMax + 1} (draft)`
          }
          return `v${row.version}`
        }}
      />
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
            {cropName || '—'} · {pkg.package_type.toLowerCase()} · {pkg.duration_days} days · v{pkg.version}
            {readiness?.published_at && (
              <> · last published {new Date(readiness.published_at).toLocaleDateString()}</>
            )}
            {readiness && readiness.subscriber_count > 0 && (
              <> · {readiness.subscriber_count} subscriber{readiness.subscriber_count === 1 ? '' : 's'}</>
            )}
          </p>
          {pkg.description && <p className="text-slate-600 text-sm mt-1">{pkg.description}</p>}
          {parameters.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              <span className="font-semibold text-slate-600">Signature:</span>{' '}
              {parameters.map((p, i) => {
                const assignedId = packageVariables.find(pv => pv.parameter_id === p.id)?.variable_id
                const variable = assignedId
                  ? (variablesByParam[p.id] || []).find(v => v.id === assignedId)
                  : null
                return (
                  <span key={p.id}>
                    {i > 0 && <span className="text-slate-300 mx-1.5">·</span>}
                    <span className="text-slate-500">{p.name}: </span>
                    <span className={variable ? 'text-slate-700 font-medium' : 'text-slate-400 italic'}>
                      {variable ? variable.name : 'not set'}
                    </span>
                  </span>
                )
              })}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <a
            href={`/advisory/${packageId}/preview`}
            className="text-center border border-slate-300 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-50">
            👁 Preview
          </a>
          <button
            onClick={() => tryEdit(openEdit)}
            className="border border-slate-300 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-50">
            ✎ Edit details
          </button>
          <button
            onClick={() => tryEdit(() => { setShowSignature(true); setPvSaveError('') })}
            className="border border-slate-300 text-slate-700 text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-50">
            ✎ Set signature
          </button>
          {pkg.status === 'DRAFT' && (
            <button onClick={() => setShowPublishConfirm(true)}
              disabled={publishing || !readiness?.ready}
              title={!readiness?.ready ? 'Resolve the items below first' : ''}
              className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              {publishing ? 'Publishing…' : '✓ Publish'}
            </button>
          )}
          {/* Batch HH (2026-05-19) — restore a package that was
              auto-INACTIVATED because its districts were removed
              from the footprint. Same publish handler; the publish
              gate enforces "≥ 1 location" so the SE must add new
              districts via Edit Locations first. crop_removed
              packages recover via re-adding the crop in Setup,
              not via this button. */}
          {pkg.status === 'INACTIVE'
            && pkg.cascade_inactivated_reason === 'locations_cleared_by_cascade' && (
            <button onClick={() => setShowPublishConfirm(true)}
              disabled={publishing || !readiness?.ready}
              title={!readiness?.ready
                ? 'Add at least one district via Edit Locations before restoring'
                : 'Restore this package as ACTIVE'}
              className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              {publishing ? 'Restoring…' : '↻ Restore (publish)'}
            </button>
          )}
          {pkg.status === 'ACTIVE' && (
            <>
              <button onClick={handleCloneToDraft}
                disabled={cloning}
                title="Start a new edit cycle. Your live version stays untouched."
                className="text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {cloning ? 'Starting…' : '+ Start new edit'}
              </button>
              {pkg.parent_global_id && (
                <button onClick={handlePullNewVersion}
                  disabled={pulling}
                  title="Pull the latest version your Content Manager has published."
                  className="text-sm font-medium px-4 py-2 rounded-xl border disabled:opacity-50"
                  style={{ borderColor: colour, color: colour }}>
                  {pulling ? 'Pulling…' : '↻ Pull new version'}
                </button>
              )}
            </>
          )}
          {/* 2026-05-22 — regular INACTIVE rows (historical versions
              the SE opened via the version history) get the same
              "+ Start new edit" affordance as ACTIVE. The new DRAFT
              copies the INACTIVE row's content; the SE can edit
              before publishing or publish unchanged (re-publish path).
              Cascade-INACTIVE keeps its own "↻ Restore (publish)"
              above — that's a recovery flow, not a regular edit. */}
          {pkg.status === 'INACTIVE'
            && pkg.cascade_inactivated_reason !== 'locations_cleared_by_cascade' && (
            <button onClick={handleCloneToDraft}
              disabled={cloning}
              title="Start a new edit from this historical version. You can edit before publishing, or publish unchanged to make it live again."
              className="text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
              {cloning ? 'Starting…' : '+ Start new edit'}
            </button>
          )}
        </div>
      </div>
      {pubError && <p className="text-sm text-red-600">{pubError}</p>}
      {lineageError && <p className="text-sm text-red-600">{lineageError}</p>}

      {/* Batch HH (2026-05-19) — footprint/crop cascade banner.
          Variants:
            • INACTIVE + locations_cleared_by_cascade → red call-out
              with restore instruction.
            • INACTIVE + crop_removed_from_belt → red call-out
              pointing the CA to Setup → Crops to re-add the crop.
            • ACTIVE + last_cascade_at set (shrink case, reason
              already cleared on republish OR was never set because
              status didn't flip) → amber notice.
          Dismissal is per-package + per-cascade-timestamp; a new
          cascade re-surfaces. */}
      {cascadeBannerVisible && pkg.last_cascade_at && (
        <div className={`rounded-xl p-4 border ${
          pkg.cascade_inactivated_reason
            ? 'bg-red-50 border-red-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`text-lg leading-none mt-0.5 ${
              pkg.cascade_inactivated_reason ? 'text-red-600' : 'text-amber-600'
            }`}>⚠</div>
            <div className="flex-1 space-y-1">
              {pkg.cascade_inactivated_reason === 'locations_cleared_by_cascade' && (
                <>
                  <p className="text-sm font-semibold text-red-800">
                    This package was deactivated on{' '}
                    {new Date(pkg.last_cascade_at).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-red-700">
                    Every district this package served was removed from the
                    company footprint. Open <strong>Edit Locations</strong> to
                    add districts from the current footprint, then click{' '}
                    <strong>Restore (publish)</strong> to bring the package back
                    to ACTIVE.
                  </p>
                </>
              )}
              {pkg.cascade_inactivated_reason === 'crop_removed_from_belt' && (
                <>
                  <p className="text-sm font-semibold text-red-800">
                    This package was deactivated on{' '}
                    {new Date(pkg.last_cascade_at).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-red-700">
                    The crop was removed from the company&apos;s Setup → Crops list.
                    Ask the CA to re-add the crop — the package will revive
                    automatically. Adding locations alone won&apos;t recover it.
                  </p>
                </>
              )}
              {!pkg.cascade_inactivated_reason && (
                <>
                  <p className="text-sm font-semibold text-amber-800">
                    Footprint updated on{' '}
                    {new Date(pkg.last_cascade_at).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-amber-700">
                    The CA changed the company location footprint. This package&apos;s
                    location list was trimmed to stay within the footprint.
                    Review the Locations panel below and add more if you need
                    wider reach.
                  </p>
                </>
              )}
            </div>
            <button onClick={dismissCascadeBanner}
              aria-label="Dismiss notice"
              className={`text-sm hover:underline ${
                pkg.cascade_inactivated_reason ? 'text-red-600' : 'text-amber-700'
              }`}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs text-slate-600">
        Each publish creates a new version. Farmers always move to the latest published
        version automatically — the previous version is preserved as history below.
        {pkg.parent_global_id && <> Pull new versions from your Content Manager any time.</>}
      </div>

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

      {/* Locations panel — state/district pairs this package serves. */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-slate-800">
              Locations <span className="text-slate-400 font-normal text-sm">({locations.length})</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Districts this package serves. Farmers in other districts won&apos;t see it on the PWA.
            </p>
          </div>
          <button onClick={() => tryEdit(openEditLocations)}
            className="text-sm font-medium px-3 py-1.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            ✎ Edit Locations
          </button>
        </div>
        {locations.length === 0 ? (
          <p className="text-xs text-slate-400 italic">
            No locations set yet. Add at least one (state, district) pair before publishing — without it the package can&apos;t reach any farmer.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {locations.map(loc => (
              <span key={loc.id}
                className="text-xs bg-slate-50 text-slate-700 px-2.5 py-1 rounded-full border border-slate-200">
                {loc.district_name || '(unnamed district)'}
                <span className="text-slate-400"> · {loc.state_name || '(unnamed state)'}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Authors panel — Subject Experts credited on this package.
          Designation + professional profile come from User Management
          (out of scope here); PWA composes the full author tag from
          name + those fields. */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-slate-800">
              Authors <span className="text-slate-400 font-normal text-sm">({authors.length})</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Subject Experts credited on this Package. Their name, designation, and professional profile appear next to the PoP on the farmer&apos;s app.
            </p>
          </div>
          <button onClick={() => tryEdit(openEditAuthors)}
            className="text-sm font-medium px-3 py-1.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            ✎ Edit Authors
          </button>
        </div>
        {authors.length === 0 ? (
          <p className="text-xs text-slate-400 italic">
            No authors yet. Pick the Subject Experts who created this PoP.
          </p>
        ) : (
          <ol className="flex flex-wrap gap-1.5">
            {authors
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((a, i) => (
                <li key={a.id}
                  className="text-xs bg-slate-50 text-slate-700 px-2.5 py-1 rounded-full border border-slate-200">
                  <span className="text-slate-400 font-mono mr-1.5">{i + 1}.</span>
                  {a.user_name || a.user_id}
                </li>
              ))}
          </ol>
        )}
      </div>

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
            <button onClick={() => tryEdit(openAddTimeline)}
              className="text-sm font-medium px-3 py-1.5 rounded-xl border"
              style={{ borderColor: colour, color: colour }}>
              + Add
            </button>
          </div>
        </div>

        {timelines.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-dashed border-slate-200">
            <p className="text-slate-500 text-sm">No timelines yet. A timeline defines a window (e.g. Day 0–30 after sowing) and contains the practices for that window.</p>
            <button onClick={() => tryEdit(openAddTimeline)}
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
                    <p className="font-medium text-slate-800 text-sm">
                      {tl.name}
                      {tl.status === 'INACTIVE' && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Inactive</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {FROM_TYPE_LABEL[tl.from_type]} · {formatTimelineRange(tl)}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); tryEdit(() => openEditTimeline(tl)) }}
                    className="text-slate-300 hover:text-blue-500 transition-colors p-1"
                    title="Edit timeline">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button onClick={e => { e.stopPropagation(); tryEdit(() => handleDeleteTimeline(tl)) }}
                    className="text-slate-300 hover:text-red-400 transition-colors p-1"
                    title="Delete timeline">
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
                      practiceMap[tl.id].map(p => {
                        const isPExpanded = expandedPractice === p.id
                        const hasElements = (p.elements?.length || 0) > 0
                        return (
                          <div key={p.id} className="border-b border-slate-50 last:border-0">
                            <div
                              className="flex items-center gap-3 py-2 cursor-pointer hover:bg-slate-50 -mx-2 px-2 rounded"
                              onClick={() => setExpandedPractice(isPExpanded ? null : p.id)}>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${L0_COLOUR[p.l0_type]}`}>{p.l0_type}</span>
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
                              <button onClick={e => { e.stopPropagation(); tryEdit(() => handleDeletePractice(tl.id, p.id)) }}
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
                      className="text-xs font-medium mt-2"
                      style={{ color: colour }}>
                      + Add Practice
                    </button>

                    {/* Relations — shared component with SA Global CCA
                        (Batch N1, 2026-05-18). Same UX, only the
                        endpoints URLs differ (/client/{cid}/... vs
                        /advisory/global/...). Mounts once per
                        expanded Timeline. */}
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
                        pipe: 'CCA_CLIENT',
                        clientId: clientId || '',
                        parentId: packageId,
                      }}
                      onRelationsChange={(tid, rels) =>
                        setRelationsByTimeline(m => ({ ...m, [tid]: rels }))
                      }
                    />

                    {/* Conditional Questions — shared with SA. The
                        relations mirror feeds attachment labels +
                        gate eligibility. */}
                    <CQsSection
                      timelineId={tl.id}
                      timelineName={tl.name}
                      practices={(practiceMap[tl.id] || []).map(p => ({
                        id: p.id,
                        l0_type: p.l0_type,
                        l1_type: p.l1_type,
                        l2_type: p.l2_type,
                        is_special_input: p.is_special_input,
                        relation_id: p.relation_id,
                        elements: p.elements?.map(e => ({
                          element_type: e.element_type,
                          value: e.value,
                          display_value: e.display_value,
                        })),
                      }))}
                      relations={(relationsByTimeline[tl.id] || []) as never}
                      pipe={{
                        pipe: 'CCA_CLIENT',
                        clientId: clientId || '',
                        parentId: packageId,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version history previously rendered here (inline panel) —
          moved to the top of the page using the shared
          <VersionHistorySection> component (2026-05-22) for
          consistency with SA-CCA / CA-PG / CA-SP / SA-PG. */}

      {/* Edit Locations modal — state-grouped picker shared with
          Setup → Locations (components/locations/LocationPicker).
          Universe is bounded to the company's footprint by the
          backend; empty-state nudges the SE to ask the CA. */}
      {showEditLocations && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit Locations</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Pick the districts this package should serve. The list below is bounded by your company&apos;s footprint (managed in Setup &rarr; Locations).
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <LocationPicker
                universe={locationOptions}
                selected={locationsSelected}
                onChange={setLocationsSelected}
                accentColour={colour}
                emptyMessage="Your company hasn't set up any districts yet. Ask the CA to enable districts in Setup → Locations before configuring package targeting." />
              {locationsError && <p className="text-sm text-red-600 mt-3">{locationsError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3">
              <button type="button" onClick={() => { setShowEditLocations(false); setLocationsError('') }}
                className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleSaveLocations} disabled={savingLocations}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {savingLocations ? 'Saving…' : 'Save Locations'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Authors Modal — Subject Experts of this company. */}
      {showEditAuthors && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit Authors</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Pick the Subject Experts who authored this PoP. Order matters — the farmer&apos;s app lists them in this sequence.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {authorsDraft.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No authors picked yet.</p>
              ) : (
                <ol className="space-y-2">
                  {authorsDraft.map((a, i) => (
                    <li key={a.user_id}
                      className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                      <span className="text-xs text-slate-400 font-mono w-5">{i + 1}.</span>
                      <span className="flex-1 text-sm text-slate-800">{a.user_name || a.user_id}</span>
                      <button type="button" onClick={() => moveAuthorInDraft(i, -1)}
                        disabled={i === 0}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-30 p-1"
                        title="Move up">↑</button>
                      <button type="button" onClick={() => moveAuthorInDraft(i, 1)}
                        disabled={i === authorsDraft.length - 1}
                        className="text-slate-400 hover:text-slate-700 disabled:opacity-30 p-1"
                        title="Move down">↓</button>
                      <button type="button" onClick={() => removeAuthorFromDraft(a.user_id)}
                        className="text-slate-400 hover:text-red-500 p-1"
                        title="Remove author">×</button>
                    </li>
                  ))}
                </ol>
              )}

              {(() => {
                const pickedIds = new Set(authorsDraft.map(a => a.user_id))
                const choices = availableSEs.filter(u => !pickedIds.has(u.id))
                if (choices.length === 0 && availableSEs.length === 0) {
                  return (
                    <p className="text-xs text-slate-400 italic">
                      No active Subject Experts in this company yet. Add them in <strong>Users</strong> first.
                    </p>
                  )
                }
                if (choices.length === 0) {
                  return (
                    <p className="text-xs text-slate-400 italic">
                      All Subject Experts of this company are already in the list.
                    </p>
                  )
                }
                return (
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <select value={addAuthorPick}
                      onChange={e => setAddAuthorPick(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">
                      <option value="">Pick a Subject Expert to add…</option>
                      {choices.map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={addAuthorToDraft}
                      disabled={!addAuthorPick}
                      className="w-full text-sm font-semibold py-2.5 rounded-xl text-white disabled:opacity-40"
                      style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                      + Add Author
                    </button>
                  </div>
                )
              })()}

              {authorsError && <p className="text-sm text-red-600">{authorsError}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-3">
              <button type="button"
                onClick={() => { setShowEditAuthors(false); setAuthorsError('') }}
                className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={handleSaveAuthors} disabled={savingAuthors}
                className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {savingAuthors ? 'Saving…' : 'Save Authors'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Package Details Modal — mirror of SA Global CCA. */}
      {showEdit && pkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit Package Details</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Crop and type are locked — changing them would break content semantics
                on already-published versions.
              </p>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Package Name</label>
                <input value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Start Date Label</label>
                <select value={editForm.start_date_label_cosh_id}
                  onChange={e => setEditForm(f => ({ ...f, start_date_label_cosh_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 bg-white">
                  {!editForm.start_date_label_cosh_id && (
                    <option value="">— pick a label —</option>
                  )}
                  {startDateLabels.map(l => (
                    <option key={l.cosh_id} value={l.cosh_id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Duration (days)
                  {pkg.package_type === 'PERENNIAL' && (
                    <span className="text-xs text-slate-400 font-normal ml-2">(locked at 365 for Perennial)</span>
                  )}
                </label>
                <input type="number" min="1" max="365"
                  value={editForm.duration_days}
                  disabled={pkg.package_type === 'PERENNIAL'}
                  onChange={e => setEditForm(f => ({ ...f, duration_days: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 disabled:bg-slate-50 disabled:text-slate-400" />
                {pkg.package_type === 'ANNUAL' && (
                  <p className="text-[11px] text-slate-400 mt-1">1 – 365 days.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 resize-none" />
              </div>

              {/* Status toggle. DRAFT → INACTIVE allowed (discards
                  the draft); DRAFT → ACTIVE blocked server-side
                  (goes through Publish). */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <div className="flex gap-2">
                  {(['DRAFT', 'ACTIVE', 'INACTIVE'] as const).map(s => {
                    const isCurrent = editForm.status === s
                    const disabled = s === 'DRAFT'
                      || (s === 'ACTIVE' && pkg.status === 'DRAFT')
                    return (
                      <button key={s} type="button"
                        onClick={() => !disabled && setEditForm(f => ({ ...f, status: s }))}
                        disabled={disabled}
                        className={`flex-1 py-2 rounded-xl text-sm font-medium border ${
                          isCurrent
                            ? (s === 'ACTIVE'
                                ? 'bg-green-50 border-green-300 text-green-700'
                                : s === 'DRAFT'
                                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                                  : 'bg-slate-100 border-slate-300 text-slate-700')
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white'
                        }`}>
                        {s.charAt(0) + s.slice(1).toLowerCase()}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {pkg.status === 'DRAFT'
                    ? 'Use Publish to promote DRAFT → ACTIVE. You can also discard a draft by switching it to Inactive.'
                    : 'Toggle between Active and Inactive. Inactive packages exit the farmer advisory feed.'}
                </p>
              </div>

              {editError && <p className="text-sm text-red-600">{editError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowEdit(false); setEditError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingEdit}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set Signature Modal — Parameters & Variables. Mirror of SA
          Global CCA (2026-05-17). Same UX, only URL prefixes differ. */}
      {showSignature && pkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Package Signature</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Parameters &amp; Variables that distinguish this Package from siblings for the
                same crop. Farmers see only the variant that matches their context.
              </p>
              {parameters.length > 0 && (() => {
                const usedCount = parameters.filter(p => getAssignedVariableId(p.id) !== '').length
                return (
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-slate-500">
                      {usedCount} of {parameters.length} parameter{parameters.length === 1 ? '' : 's'} assigned
                    </span>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                      <input type="checkbox"
                        checked={hideUnusedParams}
                        onChange={e => setHideUnusedParams(e.target.checked)}
                        className="w-3.5 h-3.5 rounded" />
                      Hide unused
                    </label>
                  </div>
                )
              })()}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {parameters.length === 0 ? (
                <p className="text-sm text-slate-400 italic">
                  No parameters yet for {cropName || 'this crop'}.
                  Add one below (e.g. Irrigation) and give it a couple of variables
                  (e.g. Drip, Flood).
                </p>
              ) : (() => {
                const visibleParams = hideUnusedParams
                  ? parameters.filter(p => getAssignedVariableId(p.id) !== '')
                  : parameters
                if (visibleParams.length === 0) {
                  return (
                    <p className="text-sm text-slate-400 italic">
                      No parameters assigned for this Package yet. Uncheck &ldquo;Hide unused&rdquo;
                      above to see all parameters and assign variables.
                    </p>
                  )
                }
                return visibleParams.map(param => {
                  const vars = variablesByParam[param.id] || []
                  const assignedId = getAssignedVariableId(param.id)
                  const isUsed = assignedId !== ''
                  const isCustom = param.source === 'CUSTOM'
                  const isEditingThisParam = editingParamId === param.id
                  return (
                    <div key={param.id}
                      className={`py-3 last:border-0 ${isUsed ? 'border-b border-green-100 bg-green-50/40 -mx-2 px-2 rounded-lg' : 'border-b border-slate-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          {isEditingThisParam ? (
                            <input
                              value={editingParamName}
                              onChange={e => setEditingParamName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRenameParameter(param.id, editingParamName)
                                if (e.key === 'Escape') setEditingParamId(null)
                              }}
                              onBlur={() => handleRenameParameter(param.id, editingParamName)}
                              autoFocus
                              className="w-full border border-blue-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          ) : (
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-slate-700 truncate">{param.name}</p>
                              {!isCustom && (
                                <span className="text-[10px] uppercase tracking-wide bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                  Cosh
                                </span>
                              )}
                              {isUsed && (
                                <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                  Used
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <select
                          value={assignedId}
                          onChange={e => handleAssignVariable(param.id, e.target.value)}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                          <option value="">— not set —</option>
                          {vars.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                        {isCustom && !isEditingThisParam && (
                          <>
                            <button
                              onClick={() => {
                                setEditingParamId(param.id)
                                setEditingParamName(param.name)
                              }}
                              className="text-slate-400 hover:text-blue-500 p-1" title="Rename parameter">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteParameter(param.id, param.name)}
                              className="text-slate-400 hover:text-red-500 p-1" title="Delete parameter">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22" />
                              </svg>
                            </button>
                          </>
                        )}
                        {/* Batch CC (2026-05-19) — "+ Variable" is
                            now available on Cosh parameters too;
                            backend stamps client_id so the variable
                            stays per-client. Cosh-shipped variables
                            remain read-only (no x). */}
                        <button
                          onClick={() => {
                            setNewVarForParamId(newVarForParamId === param.id ? null : param.id)
                            setNewVarName('')
                          }}
                          className="text-xs text-blue-600 hover:underline">
                          {newVarForParamId === param.id ? 'Cancel' : '+ Variable'}
                        </button>
                      </div>
                      {vars.length > 0 && (() => {
                        const coshVars = vars.filter(v => v.cosh_id !== null)
                        const seVars = vars.filter(v => v.cosh_id === null)
                        return (
                          <div className="mt-1.5 ml-1 space-y-1">
                            {coshVars.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 items-center">
                                {coshVars.map(v => {
                                  const isAssigned = v.id === assignedId
                                  return (
                                    <span key={v.id}
                                      className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2.5 py-0.5 ${isAssigned ? 'bg-green-100 text-green-800 font-medium ring-1 ring-green-300' : 'bg-blue-50 text-blue-700'}`}
                                      title={isAssigned ? 'Assigned to this Package' : 'From Cosh — read-only'}>
                                      {v.name}
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                            {seVars.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {seVars.map(v => {
                                  const key = `${param.id}:${v.id}`
                                  const editingThis = editingVarKey === key
                                  const isAssigned = v.id === assignedId
                                  return editingThis ? (
                                    <input key={v.id}
                                      value={editingVarName}
                                      onChange={e => setEditingVarName(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') handleRenameVariable(param.id, v.id, editingVarName)
                                        if (e.key === 'Escape') setEditingVarKey(null)
                                      }}
                                      onBlur={() => handleRenameVariable(param.id, v.id, editingVarName)}
                                      autoFocus
                                      className="border border-blue-300 rounded-full px-2 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                  ) : (
                                    <span key={v.id}
                                      className={`inline-flex items-center gap-1 text-[11px] rounded-full pl-2.5 pr-1 py-0.5 ${isAssigned ? 'bg-green-100 text-green-800 font-medium ring-1 ring-green-300' : 'bg-slate-100 text-slate-600'}`}
                                      title={isAssigned ? 'Assigned to this Package' : undefined}>
                                      <button onClick={() => { setEditingVarKey(key); setEditingVarName(v.name) }}
                                        className={isAssigned ? 'hover:text-green-900' : 'hover:text-blue-600'}>{v.name}</button>
                                      <button onClick={() => handleDeleteVariable(param.id, v.id, v.name)}
                                        className={`ml-0.5 leading-none ${isAssigned ? 'text-green-600 hover:text-red-500' : 'text-slate-400 hover:text-red-500'}`}
                                        title="Delete variable">
                                        ×
                                      </button>
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })
              })()}

              {newVarForParamId && (
                <div className="flex items-center gap-2 pt-2">
                  <input
                    value={newVarName}
                    onChange={e => setNewVarName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddVariable(newVarForParamId) }}
                    autoFocus
                    placeholder="New variable name (e.g. Drip)"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={() => handleAddVariable(newVarForParamId)}
                    disabled={!newVarName.trim()}
                    className="text-xs font-semibold bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                    Add
                  </button>
                </div>
              )}

              <div className="pt-3 border-t border-slate-50">
                {!creatingParam ? (
                  <button onClick={openCreateParam}
                    className="w-full text-sm font-medium px-3 py-2 rounded-lg border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50">
                    + New Custom Parameter
                  </button>
                ) : (
                  <div className="border border-blue-200 rounded-xl p-4 space-y-3 bg-blue-50/30">
                    <h4 className="text-sm font-semibold text-slate-800">New Custom Parameter</h4>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                      <input
                        value={paramDraft.name}
                        onChange={e => setParamDraft(d => ({ ...d, name: e.target.value }))}
                        autoFocus
                        placeholder="e.g. Irrigation"
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Variables <span className="text-slate-400 font-normal">(at least 2 required)</span>
                      </label>
                      <div className="space-y-1.5">
                        {paramDraft.variables.map((v, i) => (
                          <div key={i} className="flex gap-1.5">
                            <input
                              value={v}
                              onChange={e => setParamDraft(d => ({
                                ...d, variables: d.variables.map((vv, ii) => ii === i ? e.target.value : vv),
                              }))}
                              placeholder={`Variable ${i + 1} (e.g. ${i === 0 ? 'Drip' : 'Flood'})`}
                              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            {paramDraft.variables.length > 2 && (
                              <button type="button"
                                onClick={() => setParamDraft(d => ({
                                  ...d, variables: d.variables.filter((_, ii) => ii !== i),
                                }))}
                                className="text-slate-400 hover:text-red-500 px-2"
                                title="Remove this variable slot">
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button"
                        onClick={() => setParamDraft(d => ({ ...d, variables: [...d.variables, ''] }))}
                        className="text-xs text-blue-600 hover:underline mt-1.5">
                        + Add another variable
                      </button>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="button"
                        onClick={() => { setCreatingParam(false); setPvSaveError('') }}
                        className="flex-1 text-sm border border-slate-200 text-slate-700 font-medium py-1.5 rounded-lg hover:bg-white">
                        Cancel
                      </button>
                      <button type="button"
                        onClick={handleCreateCustomParam}
                        disabled={
                          !paramDraft.name.trim()
                          || paramDraft.variables.filter(v => v.trim()).length < 2
                        }
                        className="flex-1 text-sm bg-blue-600 text-white font-semibold py-1.5 rounded-lg disabled:opacity-50">
                        Create
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {pvSaveError && <p className="text-xs text-red-600">{pvSaveError}</p>}
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end">
              <button onClick={() => setShowSignature(false)}
                className="text-sm font-medium text-slate-700 px-4 py-2 rounded-xl hover:bg-slate-50">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

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
              {pkg && (() => {
                const allowed = ALLOWED_FROM_TYPES_BY_PACKAGE_TYPE[pkg.package_type] || ['DAS', 'DBS', 'CALENDAR']
                return (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Reference Type
                      {allowed.length === 1 && (
                        <span className="text-xs text-slate-400 font-normal ml-2">
                          (locked — {pkg.package_type === 'PERENNIAL' ? 'Perennials use the calendar' : 'Annuals use DAS / DBS'})
                        </span>
                      )}
                    </label>
                    <select value={tlForm.from_type}
                      onChange={e => setTlForm(f => ({ ...f, from_type: e.target.value }))}
                      disabled={allowed.length === 1}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-slate-50 disabled:text-slate-500">
                      {allowed.map(t => <option key={t} value={t}>{FROM_TYPE_LABEL[t as keyof typeof FROM_TYPE_LABEL]}</option>)}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {tlForm.from_type === 'DAS' && 'Days After Sowing — FROM (smaller number) → TO (larger number). The clock runs forward.'}
                      {tlForm.from_type === 'DBS' && 'Days Before Sowing — FROM (larger number) → TO (smaller number). The countdown runs toward sowing.'}
                      {tlForm.from_type === 'CALENDAR' && 'Calendar date — FROM (earlier date) → TO (later date) within a calendar year.'}
                    </p>
                  </div>
                )
              })()}

              {tlForm.from_type === 'CALENDAR' ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Window (calendar date)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">From</label>
                      <div className="flex gap-1.5">
                        <select value={tlForm.from_month}
                          onChange={e => setTlForm(f => ({ ...f, from_month: e.target.value }))}
                          className="flex-1 border border-slate-200 rounded-xl px-2 py-2 text-sm bg-white">
                          {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                        </select>
                        <input type="number" min="1" max={MONTH_DAYS[parseInt(tlForm.from_month) - 1]}
                          value={tlForm.from_day}
                          onChange={e => setTlForm(f => ({ ...f, from_day: e.target.value }))}
                          className="w-16 border border-slate-200 rounded-xl px-2 py-2 text-sm text-center" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">To</label>
                      <div className="flex gap-1.5">
                        <select value={tlForm.to_month}
                          onChange={e => setTlForm(f => ({ ...f, to_month: e.target.value }))}
                          className="flex-1 border border-slate-200 rounded-xl px-2 py-2 text-sm bg-white">
                          {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                        </select>
                        <input type="number" min="1" max={MONTH_DAYS[parseInt(tlForm.to_month) - 1]}
                          value={tlForm.to_day}
                          onChange={e => setTlForm(f => ({ ...f, to_day: e.target.value }))}
                          className="w-16 border border-slate-200 rounded-xl px-2 py-2 text-sm text-center" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Order</label>
                    <input type="number" min="0" value={tlForm.display_order}
                      onChange={e => setTlForm(f => ({ ...f, display_order: e.target.value }))}
                      className="w-24 border border-slate-200 rounded-xl px-2 py-2 text-sm" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      From (day) {tlForm.from_type === 'DBS' && <span className="text-xs text-slate-400 font-normal">(larger)</span>}
                    </label>
                    <input type="number" value={tlForm.from_value}
                      onChange={e => setTlForm(f => ({ ...f, from_value: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      To (day) {tlForm.from_type === 'DBS' && <span className="text-xs text-slate-400 font-normal">(smaller)</span>}
                    </label>
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
              )}
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

      {/* Add / Edit Practice — shared modal with full element form
          (Phase 2 of CA-portal parity, 2026-05-17). Same component
          SA-portal CCA + PG use; mode flips by editingPractice. */}
      <PracticeFormModal
        open={!!showAddPractice && !!pkg}
        mode={editingPractice ? 'edit' : 'create'}
        timelineId={showAddPractice || ''}
        cropCoshId={pkg?.crop_cosh_id || ''}
        existingPractice={editingPractice?.practice as ExistingPractice | undefined}
        contextSubtitle={(() => {
          if (!showAddPractice) return undefined
          const tl = timelines.find(t => t.id === showAddPractice)
          if (!tl || !pkg) return undefined
          return `${pkg.package_type} · ${tl.from_type} · ${tl.name}`
        })()}
        timelineWindow={(() => {
          if (!showAddPractice) return undefined
          const tl = timelines.find(t => t.id === showAddPractice)
          if (!tl) return undefined
          return { from_value: tl.from_value, to_value: tl.to_value }
        })()}
        pipe={{ pipe: 'CCA_CLIENT', clientId: clientId || '', parentId: packageId }}
        usedCommonNames={(() => {
          if (!showAddPractice) return new Set<string>()
          const peers = practiceMap[showAddPractice] || []
          const out = new Set<string>()
          for (const p of peers) {
            if (p.l1_type !== 'PESTICIDE' && p.l1_type !== 'FERTILIZER') continue
            const cn = (p.elements || []).find(e => e.element_type === 'COMMON_NAME')?.cosh_ref
            if (cn) out.add(cn)
          }
          return out
        })()}
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

      {/* Edit Timeline Modal */}
      {showEditTL && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit Timeline</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Reference Type is locked: <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{showEditTL.from_type}</span>
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

              {showEditTL.from_type === 'CALENDAR' ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Window (calendar date)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">From</label>
                      <div className="flex gap-1.5">
                        <select value={editTLForm.from_month}
                          onChange={e => setEditTLForm(f => ({ ...f, from_month: e.target.value }))}
                          className="flex-1 border border-slate-200 rounded-xl px-2 py-2 text-sm bg-white">
                          {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                        </select>
                        <input type="number" min="1" max={MONTH_DAYS[parseInt(editTLForm.from_month) - 1]}
                          value={editTLForm.from_day}
                          onChange={e => setEditTLForm(f => ({ ...f, from_day: e.target.value }))}
                          className="w-16 border border-slate-200 rounded-xl px-2 py-2 text-sm text-center" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">To</label>
                      <div className="flex gap-1.5">
                        <select value={editTLForm.to_month}
                          onChange={e => setEditTLForm(f => ({ ...f, to_month: e.target.value }))}
                          className="flex-1 border border-slate-200 rounded-xl px-2 py-2 text-sm bg-white">
                          {MONTH_NAMES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
                        </select>
                        <input type="number" min="1" max={MONTH_DAYS[parseInt(editTLForm.to_month) - 1]}
                          value={editTLForm.to_day}
                          onChange={e => setEditTLForm(f => ({ ...f, to_day: e.target.value }))}
                          className="w-16 border border-slate-200 rounded-xl px-2 py-2 text-sm text-center" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">From (Day)</label>
                    <input type="number" value={editTLForm.from_value}
                      onChange={e => setEditTLForm(f => ({ ...f, from_value: e.target.value }))}
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">To (Day)</label>
                    <input type="number" value={editTLForm.to_value}
                      onChange={e => setEditTLForm(f => ({ ...f, to_value: e.target.value }))}
                      required
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  {showEditTL.from_type === 'DBS' && (
                    <p className="col-span-2 text-[11px] text-slate-500 -mt-1">
                      Use <span className="font-medium">To = 0</span> to close at the sowing moment (continuous with a DAS timeline starting at 0).
                    </p>
                  )}
                </div>
              )}

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

      {/* Import Timeline Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-slate-900 text-lg">Import Timeline from Another PoP</h2>
            <p className="text-xs text-slate-400">
              The imported timeline is fully independent — changes here won't affect the source, and vice versa.
              You must give it a new name.
            </p>

            {importPackages.length === 0 ? (
              <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-6 text-center">
                <p className="text-sm text-slate-500">
                  No packages have timelines yet for this crop. Create a timeline in this Package or another one first.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Source Package</label>
                <select value={importSourcePkgId}
                  onChange={e => loadImportTimelines(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none">
                  <option value="">Select a package…</option>
                  {importPackages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.id === packageId ? ' (this Package)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                      {t.name} — {FROM_TYPE_LABEL[t.from_type]} {formatTimelineRange(t)}
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
                  <>This will publish version <strong>v{pkg.version + 1}</strong>. New subscribers
                  will receive v{pkg.version + 1} from the start.</>
                )}
              </p>
              {readiness && readiness.subscriber_count > 0 && (
                <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900">
                  <strong>{readiness.subscriber_count} existing subscriber{readiness.subscriber_count === 1 ? '' : 's'}</strong>{' '}
                  on this package will switch to v{pkg.version + 1} the moment you publish.
                  V1 advisory data is in-place — there are no frozen older snapshots.
                </div>
              )}
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <p><strong>Crop:</strong> {cropName || '—'}</p>
                <p><strong>Type:</strong> {pkg.package_type.toLowerCase()} · {pkg.duration_days} days</p>
                <p><strong>Timelines:</strong> {timelines.length}</p>
                {readiness?.published_at && (
                  <p><strong>Last published:</strong> {new Date(readiness.published_at).toLocaleString()}</p>
                )}
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
