'use client'

// Batch 39P-e (2026-05-16) — shared Add/Edit Practice modal.
//
// The single deepest piece of UCAT authoring surface: cascading
// L0 → L1 → L2 dropdowns over the practice taxonomy, plus a per-L2
// element form driven by `/practice-taxonomy/elements/{l2}`. Element
// inputs render as text / textarea / number / cosh dropdown / media
// upload / hyperlink preview / auto-calculated stub depending on the
// rule book's `source` string. The Common Name → Manufacturer ↔
// Trade Name brand cascade runs through `/cosh/options/*`. Brand
// Lock + frequency_days are persisted on the Practice row.
//
// CCA Global + CHA-PG Global both mount this component. Endpoints
// are derived from the pipe context via `practiceEndpoints(ctx)`.
//
// Lifted nearly verbatim from CCA's inline implementation (Batches
// 20 / 24 / 27 / 28 / 30 / 31 / 32 / 33 / 34 / 36 / 39C / 39D /
// 39H / 39I-a) — the prop shape and URL plumbing are the only
// material changes.

import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { practiceEndpoints, type PipeContext } from '@/lib/advisory-pipe'

// ── Types ──────────────────────────────────────────────────────────────

interface CoshOption { cosh_id: string; name: string }

interface TaxonomyL2 { id: string; label: string }
interface TaxonomyL1 { id: string; label: string; l2: TaxonomyL2[] }
interface TaxonomyL0 { id: string; label: string; l1: TaxonomyL1[] }

export interface L2ElementField {
  name: string
  label: string
  source: string
  mandatory: boolean
  mandatory_if_set: string[]
  cascade_from: string[]
  auto_selected: boolean
  is_interval?: boolean
}

interface PracticeElement {
  element_type: string
  cosh_ref?: string | null
  value?: string | null
  unit_cosh_id?: string | null
}

export interface ExistingPractice {
  id: string
  l0_type: string
  l1_type: string | null
  l2_type: string | null
  display_order: number
  is_special_input: boolean
  is_brand_locked?: boolean
  elements?: PracticeElement[]
}

const UNIT_TYPE_SLUGS = new Set([
  'dosage_unit', 'volume_unit', 'temperature_unit', 'distance_unit',
  'time_unit', 'number_unit', 'irrigation_unit', 'size_unit', 'depth_unit',
])

function isCoshDropdownSource(source: string): boolean {
  if (source === 'cosh_core:common_name') return true
  if (source === 'cosh_core:application_method') return true
  if (source === 'cosh_core:formulation') return true
  if (source === 'cosh_core:planting_material') return true
  if (source === 'cosh_core:itk_name') return true
  if (source === 'cosh_core:maturity_index') return true
  if (source.startsWith('cosh_core:')) {
    return UNIT_TYPE_SLUGS.has(source.slice(10))
  }
  if (source === 'cosh_cascade:manufacturers_for_common_name') return true
  if (source === 'cosh_cascade:brands_for_common_name_and_manufacturer') return true
  if (source === 'cosh_cascade:formulation_for_brand') return true
  if (source === 'cosh_cascade:ai_concentration_for_brand') return true
  return false
}

function elementInputVariant(source: string): 'text' | 'textarea' | 'number' | 'media' | 'hyperlink' | 'auto' | 'select' {
  if (source === 'auto_calculated') return 'auto'
  if (source === 'hyperlink') return 'hyperlink'
  if (source.startsWith('media_')) return 'media'
  if (source.startsWith('number_')) return 'number'
  if (source === 'text_area') return 'textarea'
  if (isCoshDropdownSource(source)) return 'select'
  return 'text'
}

function coshHint(source: string): string {
  if (source.startsWith('cosh_core:')) return ` (Cosh: ${source.slice(10)})`
  if (source.startsWith('cosh_cascade:')) return ` (Cosh cascade: ${source.slice(13)})`
  return ''
}

function previewFromUrl(url: string): { kind: 'youtube' | 'vimeo' | 'generic'; thumb: string | null; host: string } {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    let ytId: string | null = null
    if (host === 'youtu.be') ytId = u.pathname.slice(1).split('/')[0] || null
    else if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) ytId = v
      else {
        const m = u.pathname.match(/^\/(embed|shorts)\/([^/?#]+)/)
        if (m) ytId = m[2]
      }
    }
    if (ytId && /^[A-Za-z0-9_-]{6,15}$/.test(ytId)) {
      return { kind: 'youtube', thumb: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`, host }
    }
    if (host.endsWith('vimeo.com')) {
      const m = u.pathname.match(/^\/(\d{5,})/)
      if (m) return { kind: 'vimeo', thumb: null, host }
    }
    return { kind: 'generic', thumb: null, host }
  } catch {
    return { kind: 'generic', thumb: null, host: '' }
  }
}

function HyperlinkPreview({ url }: { url: string }) {
  if (!url.trim()) return null
  const p = previewFromUrl(url.trim())
  if (p.kind === 'youtube' && p.thumb) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-3 border border-slate-200 rounded-xl overflow-hidden hover:border-blue-400 transition-colors max-w-sm">
        <div className="relative w-32 aspect-video bg-slate-100 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.thumb} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
              <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="py-2 pr-3 min-w-0">
          <p className="text-xs font-medium text-slate-700 truncate">YouTube video</p>
          <p className="text-[11px] text-slate-400 truncate">{p.host}</p>
        </div>
      </a>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 hover:border-blue-400 transition-colors text-xs text-slate-600">
      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span className="truncate max-w-[220px]">{p.host || url}</span>
    </a>
  )
}

// ── Component ──────────────────────────────────────────────────────────

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  timelineId: string
  /** Optional subtitle showing the timeline + parent context. CCA
   *  passes "Annual · DAS · 120d" style; PG passes
   *  "Day N → M after detection". */
  contextSubtitle?: string
  /** Timeline window — drives the live "N applications (first on
   *  Day X, then every Y days)" indicator next to
   *  NUMBER_OF_APPLICATIONS on frequency-based L2s. Restored Batch
   *  BB (2026-05-19) after the original implementation in Batch 34
   *  was lost when the modal was extracted into this shared
   *  component (Batch 39P-e). When omitted the field falls back to
   *  the "auto-calculated server-side" stub. */
  timelineWindow?: { from_value: number; to_value: number }
  cropCoshId: string
  /** PG / CHA-SP authoring: practice isn't crop-bound but the
   *  parent recommendation carries area_or_plant — pass it so the
   *  element form picks up VOLUME_PER_PLANT + VOLUME_PER_PLANT_UNIT
   *  on plant-wise PGs. Ignored when cropCoshId is set (CCA path
   *  derives measure from the crop). 2026-05-30 */
  areaOrPlant?: 'AREA_WISE' | 'PLANT_WISE' | null
  existingPractice?: ExistingPractice
  pipe: PipeContext
  /** Rule 1 (2026-05-22): Common Name cosh_ids already used by peer
   *  Practices in this same Timeline. The modal greys out these
   *  options in the COMMON_NAME dropdown when l1_type is PESTICIDE
   *  or FERTILIZER, pre-empting the backend's
   *  `common_name_duplicate_in_timeline` 422. Callers compute this
   *  from their loaded practiceMap; omit / empty Set when peers are
   *  unknown — the backend still catches it. The edit-in-place case
   *  is handled internally (the row's own CN is never greyed). */
  usedCommonNames?: Set<string>
  /** L0 buckets to hide from the create-mode selector. Used by
   *  QA "Common to all crops" SRs to suppress INPUT — INPUTs are
   *  inherently crop-specific (dose, brand, timing). Edit mode
   *  always shows the existing row's L0 so old data can be cleaned
   *  up; only the create flow is gated. */
  hiddenL0Types?: string[]
  onClose: () => void
  onSaved: () => void
}

export function PracticeFormModal({
  open, mode, timelineId, contextSubtitle, timelineWindow, cropCoshId,
  areaOrPlant, existingPractice, pipe, usedCommonNames, hiddenL0Types,
  onClose, onSaved,
}: Props) {
  const endpoints = practiceEndpoints(pipe)

  const [taxonomy, setTaxonomy] = useState<TaxonomyL0[]>([])
  const [practiceForm, setPracticeForm] = useState({
    l0_type: 'INPUT', l1_type: '', l2_type: '', display_order: '0',
    is_special_input: false, is_brand_locked: false,
  })
  const [l2Spec, setL2Spec] = useState<L2ElementField[]>([])
  const [l2Meta, setL2Meta] = useState<{ is_special_input: boolean; frequency_based: boolean }>({
    is_special_input: false, frequency_based: false,
  })
  const [elementValues, setElementValues] = useState<Record<string, string>>({})
  const [optionsByField, setOptionsByField] = useState<Record<string, CoshOption[]>>({})
  const [uploadingByField, setUploadingByField] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load taxonomy on mount.
  useEffect(() => {
    api.get<TaxonomyL0[]>('/practice-taxonomy')
      .then(r => setTaxonomy(r.data))
      .catch(() => setTaxonomy([]))
  }, [])

  // Reset / seed form when modal opens.
  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && existingPractice) {
      setPracticeForm({
        l0_type: existingPractice.l0_type,
        l1_type: existingPractice.l1_type || '',
        l2_type: existingPractice.l2_type || '',
        display_order: String(existingPractice.display_order),
        is_special_input: existingPractice.is_special_input,
        is_brand_locked: !!existingPractice.is_brand_locked,
      })
    } else {
      // Pick the first non-hidden L0 from the loaded taxonomy as the
      // create-mode default. Falls back to 'INPUT' when taxonomy
      // hasn't loaded yet; a second effect (below) corrects the
      // selection once the taxonomy resolves and INPUT is hidden.
      const hidden = new Set(hiddenL0Types || [])
      const defaultL0 = taxonomy.find(l0 => !hidden.has(l0.id))?.id
        || (hidden.has('INPUT') ? 'NON_INPUT' : 'INPUT')
      setPracticeForm({
        l0_type: defaultL0, l1_type: '', l2_type: '', display_order: '0',
        is_special_input: false, is_brand_locked: false,
      })
      setL2Spec([]); setElementValues({}); setOptionsByField({})
      setL2Meta({ is_special_input: false, frequency_based: false })
    }
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, existingPractice, taxonomy.length, (hiddenL0Types || []).join(',')])

  const currentL0 = taxonomy.find(l0 => l0.id === practiceForm.l0_type)
  const currentL1 = currentL0?.l1.find(l1 => l1.id === practiceForm.l1_type)

  // Per-L2 spec fetch.
  //
  // crop_cosh_id is optional on the backend (only affects whether
  // plant-wise extras like VOLUME_PER_PLANT are appended). The
  // SA-portal PG editor passes cropCoshId='' because PG isn't
  // crop-bound; without this fetch, the element form never renders
  // and Add Practice fails server-side with MISSING_MANDATORY.
  useEffect(() => {
    if (!practiceForm.l2_type) {
      setL2Spec([]); setElementValues({}); setOptionsByField({})
      setL2Meta({ is_special_input: false, frequency_based: false })
      return
    }
    const qs = new URLSearchParams()
    if (cropCoshId) qs.set('crop_cosh_id', cropCoshId)
    if (!cropCoshId && areaOrPlant) qs.set('area_or_plant', areaOrPlant)
    const suffix = qs.toString() ? `?${qs}` : ''
    api.get<{ elements: L2ElementField[]; is_special_input?: boolean; frequency_based?: boolean }>(
      `/practice-taxonomy/elements/${encodeURIComponent(practiceForm.l2_type)}${suffix}`,
    )
      .then(r => {
        setL2Spec(r.data.elements)
        const fresh: Record<string, string> = {}
        const existing = existingPractice?.elements || []
        for (const f of r.data.elements) {
          const match = existing.find(e => e.element_type === f.name)
          fresh[f.name] = match?.cosh_ref || match?.value || ''
        }
        setElementValues(fresh)
        setOptionsByField({})
        const newMeta = {
          is_special_input: !!r.data.is_special_input,
          frequency_based: !!r.data.frequency_based,
        }
        setL2Meta(newMeta)
        setPracticeForm(prev => ({
          ...prev,
          is_special_input: mode === 'edit' && existingPractice
            ? existingPractice.is_special_input
            : newMeta.is_special_input,
        }))
      })
      .catch(() => {
        setL2Spec([]); setElementValues({}); setOptionsByField({})
        setL2Meta({ is_special_input: false, frequency_based: false })
      })
  }, [practiceForm.l2_type, cropCoshId, areaOrPlant, existingPractice, mode])

  // L2-level dropdowns (no cascade parent).
  useEffect(() => {
    if (!practiceForm.l2_type || l2Spec.length === 0) return
    const l2 = practiceForm.l2_type
    const fetched: Record<string, CoshOption[]> = {}
    const pending: Promise<unknown>[] = []
    for (const f of l2Spec) {
      if (f.cascade_from.length > 0) continue
      if (f.source === 'cosh_core:common_name') {
        pending.push(api.get<CoshOption[]>(
          `/cosh/options/common-names?l2=${encodeURIComponent(l2)}`,
        ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
      } else if (f.source === 'cosh_core:application_method') {
        pending.push(api.get<CoshOption[]>(
          `/cosh/options/application-methods?l2=${encodeURIComponent(l2)}`,
        ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
      } else if (f.source.startsWith('cosh_core:') && UNIT_TYPE_SLUGS.has(f.source.slice(10))) {
        const slug = f.source.slice(10)
        pending.push(api.get<CoshOption[]>(
          `/cosh/options/units?l2=${encodeURIComponent(l2)}&unit_type=${encodeURIComponent(slug)}`,
        ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
      } else if (f.source === 'cosh_core:planting_material') {
        pending.push(api.get<CoshOption[]>(
          `/cosh/options/planting-materials`,
        ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
      } else if (f.source === 'cosh_core:itk_name') {
        pending.push(api.get<CoshOption[]>(
          `/cosh/options/itks`,
        ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
      } else if (f.source === 'cosh_core:maturity_index') {
        if (cropCoshId) {
          pending.push(api.get<CoshOption[]>(
            `/cosh/options/maturity-indices?crop=${encodeURIComponent(cropCoshId)}`,
          ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
        } else {
          fetched[f.name] = []
        }
      } else if (f.source === 'cosh_core:formulation') {
        // 2026-05-22 — NPK Dosages L2s have no Common Name on the
        // Practice, so the brand-cascade effect below (gated on
        // commonName) never fires. The backend's `list_formulations`
        // detects NPK L2s and routes through the `formulations_L2_npk`
        // Connect instead. For other L2s with `cosh_core:formulation`
        // + no cascade, this also fires harmlessly (returns the
        // brand-cascade default for that L2).
        pending.push(api.get<CoshOption[]>(
          `/cosh/options/formulations?l2=${encodeURIComponent(l2)}`,
        ).then(r => { fetched[f.name] = r.data }).catch(() => { fetched[f.name] = [] }))
      }
    }
    if (pending.length === 0) return
    Promise.all(pending).then(() => setOptionsByField(prev => ({ ...prev, ...fetched })))
  }, [practiceForm.l2_type, l2Spec, cropCoshId])

  // Brand cascade — Common Name → MFR / TN bidirectional + F / a.i.
  const commonName = elementValues['COMMON_NAME'] || ''
  const manufacturer = elementValues['MANUFACTURER'] || ''
  const brandName = elementValues['BRAND_NAME'] || ''

  useEffect(() => {
    if (l2Spec.length === 0) return
    if (!commonName) return
    const cnEnc = encodeURIComponent(commonName)
    const tnSuffix = brandName ? `&trade_name=${encodeURIComponent(brandName)}` : ''
    const l2Suffix = practiceForm.l2_type ? `&l2=${encodeURIComponent(practiceForm.l2_type)}` : ''
    const url_form = `/cosh/options/formulations?common_name=${cnEnc}${tnSuffix}${l2Suffix}`
    const url_ai = `/cosh/options/ai-concentrations?common_name=${cnEnc}${tnSuffix}${l2Suffix}`
    const fetched: Record<string, CoshOption[]> = {}
    const pending: Promise<unknown>[] = []
    for (const f of l2Spec) {
      if (f.source === 'cosh_cascade:formulation_for_brand') {
        pending.push(api.get<CoshOption[]>(url_form)
          .then(r => { fetched[f.name] = r.data })
          .catch(() => { fetched[f.name] = [] }))
      } else if (f.source === 'cosh_cascade:ai_concentration_for_brand') {
        pending.push(api.get<CoshOption[]>(url_ai)
          .then(r => { fetched[f.name] = r.data })
          .catch(() => { fetched[f.name] = [] }))
      } else if (f.source === 'cosh_core:formulation' && f.cascade_from.length === 0) {
        pending.push(api.get<CoshOption[]>(url_form)
          .then(r => { fetched[f.name] = r.data })
          .catch(() => { fetched[f.name] = [] }))
      }
    }
    if (pending.length === 0) return
    Promise.all(pending).then(() => setOptionsByField(prev => ({ ...prev, ...fetched })))
  }, [commonName, brandName, l2Spec, practiceForm.l2_type])

  // MFR list refresh (bidirectional with TN).
  useEffect(() => {
    if (l2Spec.length === 0) return
    if (!commonName) return
    const mfrField = l2Spec.find(f => f.source === 'cosh_cascade:manufacturers_for_common_name')
    if (!mfrField) return
    const cnEnc = encodeURIComponent(commonName)
    const tnSuffix = brandName ? `&trade_name=${encodeURIComponent(brandName)}` : ''
    const l2Suffix = practiceForm.l2_type ? `&l2=${encodeURIComponent(practiceForm.l2_type)}` : ''
    api.get<CoshOption[]>(`/cosh/options/manufacturers?common_name=${cnEnc}${tnSuffix}${l2Suffix}`)
      .then(r => {
        setOptionsByField(prev => ({ ...prev, [mfrField.name]: r.data }))
        setElementValues(prev => {
          const cur = prev[mfrField.name] || ''
          if (cur && !r.data.some(o => o.cosh_id === cur)) {
            return { ...prev, [mfrField.name]: '' }
          }
          return prev
        })
      })
      .catch(() => {})
  }, [commonName, brandName, l2Spec, practiceForm.l2_type])

  // TN list refresh (bidirectional with MFR).
  useEffect(() => {
    if (l2Spec.length === 0) return
    if (!commonName) return
    const tnField = l2Spec.find(f => f.source === 'cosh_cascade:brands_for_common_name_and_manufacturer')
    if (!tnField) return
    const cnEnc = encodeURIComponent(commonName)
    const mfrSuffix = manufacturer ? `&manufacturer=${encodeURIComponent(manufacturer)}` : ''
    const l2Suffix = practiceForm.l2_type ? `&l2=${encodeURIComponent(practiceForm.l2_type)}` : ''
    api.get<CoshOption[]>(`/cosh/options/trade-names?common_name=${cnEnc}${mfrSuffix}${l2Suffix}`)
      .then(r => {
        setOptionsByField(prev => ({ ...prev, [tnField.name]: r.data }))
        setElementValues(prev => {
          const cur = prev[tnField.name] || ''
          if (cur && !r.data.some(o => o.cosh_id === cur)) {
            return { ...prev, [tnField.name]: '' }
          }
          return prev
        })
      })
      .catch(() => {})
  }, [commonName, manufacturer, l2Spec, practiceForm.l2_type])

  function setElementValue(fieldName: string, value: string) {
    const cascadeValuesToClear: Record<string, string[]> = {
      COMMON_NAME:      ['MANUFACTURER', 'BRAND_NAME', 'FORMULATION', 'AI_CONCENTRATION', 'APPLICATION_METHOD', 'DOSAGE', 'DOSAGE_UNIT'],
      MANUFACTURER:     ['FORMULATION', 'AI_CONCENTRATION', 'APPLICATION_METHOD', 'DOSAGE', 'DOSAGE_UNIT'],
      BRAND_NAME:       ['FORMULATION', 'AI_CONCENTRATION', 'APPLICATION_METHOD', 'DOSAGE', 'DOSAGE_UNIT'],
      FORMULATION:      ['AI_CONCENTRATION', 'DOSAGE', 'DOSAGE_UNIT'],
      AI_CONCENTRATION: ['DOSAGE', 'DOSAGE_UNIT'],
    }
    const cnDrivenOptions = ['MANUFACTURER', 'BRAND_NAME', 'FORMULATION', 'AI_CONCENTRATION']
    const valuesToClear = cascadeValuesToClear[fieldName] || []
    setElementValues(prev => {
      const next = { ...prev, [fieldName]: value }
      for (const c of valuesToClear) if (c in next) next[c] = ''
      return next
    })
    if (valuesToClear.length > 0 && !value) {
      setOptionsByField(prev => {
        const next = { ...prev }
        for (const c of cnDrivenOptions) {
          if (valuesToClear.includes(c)) delete next[c]
        }
        return next
      })
    }
  }

  async function uploadMediaFile(fieldName: string, file: File, folder: string): Promise<void> {
    setUploadingByField(s => ({ ...s, [fieldName]: true }))
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', folder)
      const { data } = await api.post<{ url: string; key: string }>('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setElementValue(fieldName, data.url)
    } finally {
      setUploadingByField(s => ({ ...s, [fieldName]: false }))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')

    const elements: { element_type: string; value?: string; cosh_ref?: string; unit_cosh_id?: string }[] = []
    for (const field of l2Spec) {
      const variant = elementInputVariant(field.source)
      if (variant === 'auto') continue
      const raw = elementValues[field.name]
      if (raw === undefined || raw.trim() === '') continue
      if (variant === 'select') {
        elements.push({ element_type: field.name, cosh_ref: raw.trim() })
      } else {
        elements.push({ element_type: field.name, value: raw.trim() })
      }
    }

    let frequency_days: number | null = null
    const intervalField = l2Spec.find(f => f.name.endsWith('_INTERVAL') && f.source === 'number_2dec')
    if (intervalField) {
      const raw = elementValues[intervalField.name]
      const parsed = raw ? parseInt(raw, 10) : NaN
      if (!Number.isNaN(parsed)) frequency_days = parsed
    }

    const hasBrandElement = elements.some(
      el => el.element_type === 'BRAND_NAME' && (el.cosh_ref || '').trim(),
    )
    const body = {
      l0_type: practiceForm.l0_type,
      l1_type: practiceForm.l1_type || null,
      l2_type: practiceForm.l2_type || null,
      display_order: parseInt(practiceForm.display_order),
      is_special_input: practiceForm.is_special_input,
      is_brand_locked: practiceForm.is_brand_locked && hasBrandElement,
      frequency_days,
      elements,
    }

    try {
      if (mode === 'edit' && existingPractice) {
        await api.put(endpoints.update(timelineId, existingPractice.id), body)
      } else {
        await api.post(endpoints.create(timelineId), body)
      }
      onSaved()
      onClose()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, mode === 'edit' ? 'Failed to update practice.' : 'Failed to add practice.'))
    } finally { setSaving(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">
            {mode === 'edit' ? 'Edit Practice' : 'Add Practice'}
          </h2>
          {contextSubtitle && (
            <p className="text-xs text-slate-500 mt-1">{contextSubtitle}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {/* L0 / L1 / L2 cascade */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Type (L0)</label>
            <select value={practiceForm.l0_type}
              onChange={e => setPracticeForm(f => ({
                ...f, l0_type: e.target.value, l1_type: '', l2_type: '',
              }))}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {taxonomy.length === 0 && <option value="INPUT">INPUT</option>}
              {taxonomy
                .filter(l0 => {
                  if (!hiddenL0Types?.includes(l0.id)) return true
                  // Edit mode: keep the existing L0 visible so an
                  // earlier-authored INPUT row can still be opened
                  // and cleaned up. Hidden only applies to the
                  // create-new flow.
                  return mode === 'edit' && existingPractice?.l0_type === l0.id
                })
                .map(l0 => (
                  <option key={l0.id} value={l0.id}>{l0.label}</option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">L1</label>
            <select value={practiceForm.l1_type}
              onChange={e => setPracticeForm(f => ({ ...f, l1_type: e.target.value, l2_type: '' }))}
              disabled={!currentL0}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
              <option value="">— pick L1 —</option>
              {(currentL0?.l1 || []).map(l1 => (
                <option key={l1.id} value={l1.id}>{l1.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">L2</label>
            <select value={practiceForm.l2_type}
              onChange={e => setPracticeForm(f => ({ ...f, l2_type: e.target.value }))}
              disabled={!currentL1}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
              <option value="">— pick L2 —</option>
              {(currentL1?.l2 || []).map(l2 => (
                <option key={l2.id} value={l2.id}>{l2.label}</option>
              ))}
            </select>
          </div>

          {/* Special Input checkbox (L2-driven) */}
          {l2Meta.is_special_input && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
              <input type="checkbox" checked={practiceForm.is_special_input}
                onChange={e => setPracticeForm(f => ({ ...f, is_special_input: e.target.checked }))}
                className="w-4 h-4 rounded" />
              Special input (never suppressed by Relations / CQ)
            </label>
          )}

          {/* Per-L2 element form */}
          {l2Spec.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                Element values
              </p>
              {l2Spec.map(field => {
                const variant = elementInputVariant(field.source)
                if (variant === 'auto') {
                  // Batch BB (2026-05-19) — live "N applications
                  // (first on Day X, then every Y days)" indicator
                  // restored. Same formula as backend's Batch 34
                  // calc: applications across the timeline window
                  // = floor((duration - 1) / interval) + 1, with
                  // first application on Day from_value + 1.
                  // Falls back to the legacy "auto-calculated
                  // server-side" stub when no timelineWindow is
                  // passed (callers that haven't been updated yet).
                  const intervalF = l2Spec.find(f =>
                    f.name.endsWith('_INTERVAL') && f.source === 'number_2dec',
                  )
                  const rawInterval = intervalF ? (elementValues[intervalF.name] || '') : ''
                  const interval = rawInterval ? parseInt(rawInterval, 10) : NaN
                  let n = 0
                  if (timelineWindow && !Number.isNaN(interval) && interval > 0) {
                    const duration = timelineWindow.to_value - timelineWindow.from_value + 1
                    if (duration >= 1) n = Math.floor((duration - 1) / interval) + 1
                  }
                  const firstDay = timelineWindow ? timelineWindow.from_value + 1 : null
                  return (
                    <div key={field.name} className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {field.label || field.name}:
                      </span>{' '}
                      {!timelineWindow ? (
                        <span className="italic text-slate-400">auto-calculated server-side</span>
                      ) : Number.isNaN(interval) || interval <= 0 ? (
                        // 2026-05-22 — interval blank ⇒ one-shot. Indicator
                        // reflects what the farmer sees: a single application
                        // somewhere in the window, no fixed cadence.
                        <span className="text-slate-600">
                          <span className="font-semibold">1 application</span>
                          {' '}
                          <span className="text-slate-400">— at any time during this timeline</span>
                        </span>
                      ) : n < 2 ? (
                        <span className="text-amber-700">
                          Interval too long for this timeline — frequency
                          practices repeat at least twice. Shorten the
                          interval or leave it blank for a one-time
                          application.
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold text-slate-900">
                            {n} application{n === 1 ? '' : 's'}
                          </span>{' '}
                          <span className="text-slate-400">
                            (first on Day {firstDay}, then every {interval} day{interval === 1 ? '' : 's'})
                          </span>
                        </>
                      )}
                    </div>
                  )
                }
                const value = elementValues[field.name] || ''
                const opts = optionsByField[field.name] || []
                // Rule 1 pre-emption: when the field is COMMON_NAME and
                // l1_type is PESTICIDE/FERTILIZER, grey out any cosh_id
                // already used by a peer practice. Never grey out the
                // row's own current CN (so edit-in-place still works).
                const isCnGated = field.name === 'COMMON_NAME'
                  && (practiceForm.l1_type === 'PESTICIDE' || practiceForm.l1_type === 'FERTILIZER')
                  && usedCommonNames !== undefined
                return (
                  <div key={field.name}>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {field.label || field.name}
                      {field.mandatory && <span className="text-red-500 ml-0.5">*</span>}
                      <span className="text-[10px] text-slate-400 font-normal">
                        {coshHint(field.source)}
                      </span>
                    </label>
                    {variant === 'select' ? (
                      <select value={value}
                        onChange={e => setElementValue(field.name, e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">— select —</option>
                        {opts.map(o => {
                          const usedElsewhere = isCnGated
                            && usedCommonNames!.has(o.cosh_id)
                            && o.cosh_id !== value
                          return (
                            <option key={o.cosh_id} value={o.cosh_id} disabled={usedElsewhere}>
                              {o.name}{usedElsewhere ? ' — already used in this Timeline' : ''}
                            </option>
                          )
                        })}
                      </select>
                    ) : variant === 'textarea' ? (
                      <textarea value={value}
                        onChange={e => setElementValue(field.name, e.target.value)}
                        rows={2}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                    ) : variant === 'number' ? (
                      <>
                        <input type="number" value={value}
                          step={field.source === 'number_4dec' ? '0.0001' : field.source === 'number_2dec' ? '0.01' : '1'}
                          placeholder={field.is_interval ? 'leave blank for one-time application' : undefined}
                          onChange={e => setElementValue(field.name, e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        {field.is_interval && (
                          // 2026-05-22 — interval is non-mandatory. Blank ⇒
                          // "apply once at any time during this timeline"
                          // (one-shot path); the farmer's advisory surfaces
                          // it the same way a non-frequency practice does.
                          <p className="text-[11px] text-slate-400 mt-1">
                            Leave blank if this practice is to be applied
                            once at any time during the timeline.
                          </p>
                        )}
                      </>
                    ) : variant === 'media' ? (
                      <div>
                        {value && (
                          <a href={value} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline break-all">
                            {value}
                          </a>
                        )}
                        <input type="file"
                          accept={field.source === 'media_image' ? 'image/*' : field.source === 'media_audio' ? 'audio/*' : undefined}
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) uploadMediaFile(field.name, file, field.source === 'media_image' ? 'practice-images' : 'practice-audio')
                          }}
                          disabled={!!uploadingByField[field.name]}
                          className="mt-1 block text-xs" />
                        {uploadingByField[field.name] && <p className="text-[11px] text-slate-400 mt-1">Uploading…</p>}
                      </div>
                    ) : variant === 'hyperlink' ? (
                      <div>
                        <input type="url" value={value}
                          onChange={e => setElementValue(field.name, e.target.value)}
                          placeholder="https://..."
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <HyperlinkPreview url={value} />
                      </div>
                    ) : (
                      <input type="text" value={value}
                        onChange={e => setElementValue(field.name, e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Brand Lock checkbox — only when L2 has a BRAND_NAME field. */}
          {l2Spec.some(f => f.name === 'BRAND_NAME') && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 pt-2 border-t border-slate-100">
              <input type="checkbox" checked={practiceForm.is_brand_locked}
                onChange={e => setPracticeForm(f => ({ ...f, is_brand_locked: e.target.checked }))}
                disabled={!elementValues['BRAND_NAME']}
                title={!elementValues['BRAND_NAME'] ? 'Pick a Brand first to enable Brand Lock.' : ''}
                className="w-4 h-4 rounded" />
              🔒 Lock Brand
              <span className="text-[11px] text-slate-400">
                (restricts purchase to this exact brand)
              </span>
            </label>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm">Cancel</button>
            <button type="submit"
              disabled={saving || !practiceForm.l2_type}
              className="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
              {saving
                ? (mode === 'edit' ? 'Saving…' : 'Adding…')
                : (mode === 'edit' ? 'Save Changes' : 'Add Practice')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
