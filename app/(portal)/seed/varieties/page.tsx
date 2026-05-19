'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient, getToken } from '@/lib/auth'

// Crop-scoped variety management (Batch O+, 2026-05-18). The crop
// is picked on the parent /seed page; this page receives it via the
// `?crop=<cosh_id>` query param and locks it in the Add/Edit modal.
// CCA-style nested flow per user 2026-05-18.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'

// Batch W (2026-05-19) — DUS picker now reads Cosh's
// `dus_characters_descriptors` Connect. Each row stores the
// cosh_ids of every level so we can re-render the picker on edit,
// plus a name snapshot so display stays stable if Cosh translations
// drift later. `part` / `character` / etc. are kept as optional
// strings purely for backward compat — legacy free-text rows
// authored before Batch W will render as read-only text.
interface DusCharacter {
  part_cosh_id?: string
  part_name_en?: string
  subpart_cosh_id?: string
  subpart_name_en?: string
  character_cosh_id?: string
  character_name_en?: string
  descriptor_cosh_id?: string
  descriptor_name_en?: string
  // Legacy free-text fields (pre-Batch W).
  part?: string
  sub_part?: string
  character?: string
  descriptor?: string
}

interface DusOptionDescriptor {
  descriptor_cosh_id: string
  descriptor_name_en: string
}
interface DusOptionCharacter {
  character_cosh_id: string
  character_name_en: string
  descriptors: DusOptionDescriptor[]
}
interface DusOptionSubpart {
  // null cosh_id + null name = BLANK BOX in Cosh → "not applicable"
  // at the subpart level for this branch (Batch W-1, 2026-05-19).
  // Frontend skips the subpart dropdown when this is the only
  // entry for a part; otherwise surfaces as "— not applicable —".
  subpart_cosh_id: string | null
  subpart_name_en: string | null
  characters: DusOptionCharacter[]
}
interface DusOptionPart {
  part_cosh_id: string
  part_name_en: string
  subparts: DusOptionSubpart[]
}

interface Variety {
  id: string; name: string; crop_cosh_id: string; variety_type: string
  description_points: string[]; photos: string[]; status: string
  dus_characters: DusCharacter[]
  pop_assignments: { package_id: string; status: string }[]
}

interface Package { id: string; name: string; crop_cosh_id?: string }

interface ClientCrop {
  crop_cosh_id: string
  crop_name_en?: string | null
}

const VARIETY_TYPES = ['SEED', 'SEEDLING', 'CUTTING', 'SAPLING']

const emptyForm = (cropCoshId: string) => ({
  name: '',
  crop_cosh_id: cropCoshId,
  variety_type: 'SEED',
  description_points: [''],
  photos: [] as string[],
  dus_characters: [] as DusCharacter[],
})

function SeedVarietiesContent() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'
  const params = useSearchParams()
  const cropCoshId = params?.get('crop') || ''

  const [varieties, setVarieties] = useState<Variety[]>([])
  const [packages, setPackages] = useState<Package[]>([])
  const [cropName, setCropName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Variety | null>(null)
  const [form, setForm] = useState(emptyForm(cropCoshId))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // DUS taxonomy tree for the current crop — fetched once per crop.
  const [dusOptions, setDusOptions] = useState<DusOptionPart[]>([])

  const load = async () => {
    if (!clientId || !cropCoshId) return
    const [vrRes, pkgRes, cropsRes, dusRes] = await Promise.all([
      api.get<Variety[]>(`/client/${clientId}/varieties?crop_cosh_id=${encodeURIComponent(cropCoshId)}`),
      api.get<Package[]>(`/client/${clientId}/packages`).catch(() => ({ data: [] as Package[] })),
      api.get<ClientCrop[]>(`/client/${clientId}/crops`).catch(() => ({ data: [] as ClientCrop[] })),
      api.get<DusOptionPart[]>(`/client/${clientId}/seed/dus-options?crop_cosh_id=${encodeURIComponent(cropCoshId)}`)
        .catch(() => ({ data: [] as DusOptionPart[] })),
    ])
    setVarieties(vrRes.data)
    setPackages(pkgRes.data.filter(p => p.crop_cosh_id === cropCoshId))
    const matched = cropsRes.data.find(c => c.crop_cosh_id === cropCoshId)
    setCropName(matched?.crop_name_en || '')
    setDusOptions(dusRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId, cropCoshId])

  function addDescPoint() { setForm(f => ({ ...f, description_points: [...f.description_points, ''] })) }
  function setDescPoint(i: number, v: string) {
    setForm(f => { const pts = [...f.description_points]; pts[i] = v; return { ...f, description_points: pts } })
  }
  function removeDescPoint(i: number) {
    setForm(f => ({ ...f, description_points: f.description_points.filter((_, idx) => idx !== i) }))
  }

  function addDusRow() {
    setForm(f => ({ ...f, dus_characters: [...f.dus_characters, {} as DusCharacter] }))
  }
  function removeDusRow(i: number) {
    setForm(f => ({ ...f, dus_characters: f.dus_characters.filter((_, idx) => idx !== i) }))
  }

  // Batch W (2026-05-19) — cascading DUS dropdowns. Picking a level
  // clears every dependent level so we never end up with a Sub-Part
  // that doesn't belong to the new Part. Persist cosh_id + name
  // snapshot so the row renders correctly even if Cosh later
  // changes the display name.
  //
  // Batch W-1: subpart can be null when Cosh's row has BLANK BOX at
  // that position. If a part's only subpart is null, the picker
  // auto-selects null and hides the subpart dropdown.
  function pickDusPart(i: number, partCoshId: string) {
    const part = dusOptions.find(p => p.part_cosh_id === partCoshId)
    const onlySubpart = part && part.subparts.length === 1 ? part.subparts[0] : null
    setForm(f => {
      const chars = [...f.dus_characters]
      chars[i] = {
        part_cosh_id: partCoshId,
        part_name_en: part?.part_name_en,
        // Auto-fill the subpart slot when the only option is the
        // BLANK BOX "(not applicable)" entry. Otherwise leave the
        // subpart unset so the SE has to pick.
        ...(onlySubpart && onlySubpart.subpart_cosh_id === null
          ? { subpart_cosh_id: undefined, subpart_name_en: undefined }
          : {}),
      }
      return { ...f, dus_characters: chars }
    })
  }
  function pickDusSubpart(i: number, subpartCoshIdOrEmpty: string) {
    // The dropdown emits an empty string when the user picks
    // "— not applicable —"; map that back to null in stored form.
    const subpartCoshId = subpartCoshIdOrEmpty === '__NA__' ? null : subpartCoshIdOrEmpty
    setForm(f => {
      const chars = [...f.dus_characters]
      const cur = chars[i]
      const part = dusOptions.find(p => p.part_cosh_id === cur.part_cosh_id)
      const subpart = part?.subparts.find(s => s.subpart_cosh_id === subpartCoshId)
      chars[i] = {
        part_cosh_id: cur.part_cosh_id,
        part_name_en: cur.part_name_en,
        subpart_cosh_id: subpart?.subpart_cosh_id ?? undefined,
        subpart_name_en: subpart?.subpart_name_en ?? undefined,
      }
      return { ...f, dus_characters: chars }
    })
  }
  function pickDusCharacter(i: number, characterCoshId: string) {
    setForm(f => {
      const chars = [...f.dus_characters]
      const cur = chars[i]
      const part = dusOptions.find(p => p.part_cosh_id === cur.part_cosh_id)
      const subpart = part?.subparts.find(s =>
        (s.subpart_cosh_id ?? null) === (cur.subpart_cosh_id ?? null),
      )
      const character = subpart?.characters.find(c => c.character_cosh_id === characterCoshId)
      chars[i] = {
        part_cosh_id: cur.part_cosh_id,
        part_name_en: cur.part_name_en,
        subpart_cosh_id: cur.subpart_cosh_id,
        subpart_name_en: cur.subpart_name_en,
        character_cosh_id: characterCoshId,
        character_name_en: character?.character_name_en,
      }
      return { ...f, dus_characters: chars }
    })
  }
  function pickDusDescriptor(i: number, descriptorCoshId: string) {
    setForm(f => {
      const chars = [...f.dus_characters]
      const cur = chars[i]
      const part = dusOptions.find(p => p.part_cosh_id === cur.part_cosh_id)
      const subpart = part?.subparts.find(s =>
        (s.subpart_cosh_id ?? null) === (cur.subpart_cosh_id ?? null),
      )
      const character = subpart?.characters.find(c => c.character_cosh_id === cur.character_cosh_id)
      const descriptor = character?.descriptors.find(d => d.descriptor_cosh_id === descriptorCoshId)
      chars[i] = {
        ...cur,
        descriptor_cosh_id: descriptorCoshId,
        descriptor_name_en: descriptor?.descriptor_name_en,
      }
      return { ...f, dus_characters: chars }
    })
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !clientId) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'varieties')
      const token = getToken()
      const res = await fetch(`${API_URL}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const url: string = data.url || data.file_url || data.path
      setForm(f => ({ ...f, photos: [...f.photos, url] }))
    } catch {
      alert('Image upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removePhoto(i: number) {
    setForm(f => ({ ...f, photos: f.photos.filter((_, idx) => idx !== i) }))
  }

  async function save() {
    setSaveError('')
    if (!clientId) {
      setSaveError('Client context missing — please reload the page.')
      return
    }
    if (!form.name.trim()) {
      setSaveError('Name is required.')
      return
    }
    if (!form.crop_cosh_id.trim()) {
      setSaveError('Crop is required. Open this page from /seed and pick a crop first.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        description_points: form.description_points.filter(p => p.trim()),
        // Keep rows that EITHER carry the new cosh_id shape (post
        // Batch W) OR a legacy free-text part+character pair.
        dus_characters: form.dus_characters.filter(d =>
          (d.part_cosh_id && d.character_cosh_id)
          || ((d.part?.trim() && d.character?.trim())),
        ),
      }
      if (selected) {
        await api.put(`/client/${clientId}/varieties/${selected.id}`, payload)
      } else {
        await api.post(`/client/${clientId}/varieties`, payload)
      }
      setShowCreate(false)
      setSelected(null)
      setForm(emptyForm(cropCoshId))
      load()
    } catch (e: unknown) {
      // Batch W-2 (2026-05-19) — surface backend errors. Common
      // codes: `sdm_or_ca_only` (logged in as SE / FM / Report),
      // `not_a_seed_company`, generic 4xx / 5xx.
      const res = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response
      const detail = res?.data?.detail as { code?: string; message?: string } | string | undefined
      if (typeof detail === 'object' && detail?.code === 'sdm_or_ca_only') {
        setSaveError(`${detail.message || 'Only the CA or a Seed Data Manager can add varieties.'} Ask the CA to assign you the Seed Data Manager role, or log in as the CA.`)
      } else if (typeof detail === 'object' && detail?.code === 'not_a_seed_company') {
        setSaveError(`${detail.message || 'This company is not onboarded as a Seed Company.'} Ask the SA to add the Seed Company organisation type to this client.`)
      } else if (typeof detail === 'object' && detail?.message) {
        setSaveError(detail.message)
      } else if (typeof detail === 'string') {
        setSaveError(detail)
      } else {
        setSaveError('Failed to save the variety. Please try again.')
      }
    } finally { setSaving(false) }
  }

  async function deactivate(id: string) {
    if (!clientId || !confirm('Deactivate this variety?')) return
    await api.delete(`/client/${clientId}/varieties/${id}`)
    load()
  }

  async function togglePop(variety: Variety, pkg: Package) {
    if (!clientId) return
    const assigned = variety.pop_assignments.find(a => a.package_id === pkg.id && a.status === 'ACTIVE')
    if (assigned) {
      await api.delete(`/client/${clientId}/varieties/${variety.id}/pop-assignments/${pkg.id}`)
    } else {
      await api.post(`/client/${clientId}/varieties/${variety.id}/pop-assignments`, { package_id: pkg.id })
    }
    load()
  }

  function editVariety(v: Variety) {
    setSelected(v)
    setForm({
      name: v.name,
      crop_cosh_id: v.crop_cosh_id,
      variety_type: v.variety_type,
      description_points: v.description_points.length > 0 ? v.description_points : [''],
      photos: v.photos,
      dus_characters: v.dus_characters || [],
    })
    setSaveError('')
    setShowCreate(true)
  }

  if (!cropCoshId) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 text-center">
        <p className="text-slate-500 mb-3">No crop selected.</p>
        <Link href="/seed" className="text-sm font-medium text-green-700 hover:underline">← Back to crops</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/seed" className="text-xs text-slate-400 hover:text-slate-600">← Back to crops</Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {cropName || '(loading…)'} — Varieties
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">Seed varieties available to farmers for this crop</p>
          </div>
          <button onClick={() => { setShowCreate(true); setSelected(null); setForm(emptyForm(cropCoshId)); setSaveError('') }}
            className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            + Add Variety
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : varieties.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-slate-100">
          <p className="text-4xl mb-3">🌱</p>
          <p className="text-slate-500 font-medium">No varieties added yet</p>
          <p className="text-sm text-slate-400 mt-1">Add seed varieties that farmers can browse and order</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {varieties.map(v => (
            <div key={v.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              {v.photos.length > 0 ? (
                <img src={v.photos[0]} alt={v.name}
                  className="w-full h-36 object-cover" />
              ) : (
                <div className="w-full h-24 bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center">
                  <span className="text-4xl">🌾</span>
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-900">{v.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{v.variety_type}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${v.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {v.status}
                  </span>
                </div>

                {v.description_points.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {v.description_points.slice(0, 2).map((pt, i) => (
                      <li key={i} className="text-xs text-slate-600 flex items-start gap-1">
                        <span className="text-green-500 mt-0.5">•</span>{pt}
                      </li>
                    ))}
                    {v.description_points.length > 2 && (
                      <li className="text-xs text-slate-400">+{v.description_points.length - 2} more</li>
                    )}
                  </ul>
                )}

                {v.dus_characters && v.dus_characters.length > 0 && (
                  <p className="text-xs text-blue-500 mt-1.5">{v.dus_characters.length} DUS character{v.dus_characters.length !== 1 ? 's' : ''}</p>
                )}

                {/* PoP assignments — same-crop packages only. */}
                {packages.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-50">
                    <p className="text-xs text-slate-400 mb-1.5">Assigned to PoPs:</p>
                    <div className="flex flex-wrap gap-1">
                      {packages.map(pkg => {
                        const assigned = v.pop_assignments.find(a => a.package_id === pkg.id && a.status === 'ACTIVE')
                        return (
                          <button key={pkg.id}
                            onClick={() => togglePop(v, pkg)}
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                              assigned ? 'bg-green-100 border-green-200 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-400 hover:border-green-300'
                            }`}>
                            {assigned ? '✓ ' : ''}{pkg.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  <button onClick={() => editVariety(v)}
                    className="flex-1 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg py-2 hover:bg-slate-100">
                    Edit
                  </button>
                  <button onClick={() => deactivate(v.id)}
                    className="flex-1 text-xs font-medium text-red-500 bg-red-50 rounded-lg py-2 hover:bg-red-100">
                    Deactivate
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal — crop is read-only (locked to the parent
          crop the SDM picked on /seed). */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6">
              <h2 className="text-lg font-bold text-slate-900 mb-1">
                {selected ? 'Edit Variety' : 'Add New Variety'}
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                For crop: <span className="font-medium text-slate-700">{cropName || '—'}</span>
              </p>
              <div className="space-y-5">
                {/* Basic info */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Variety Name *</label>
                  <input value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                  <select value={form.variety_type}
                    onChange={e => setForm(f => ({ ...f, variety_type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none bg-white">
                    {VARIETY_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>

                {/* Description Points */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Description Points</label>
                  <div className="space-y-2">
                    {form.description_points.map((pt, i) => (
                      <div key={i} className="flex gap-2">
                        <input value={pt}
                          onChange={e => setDescPoint(i, e.target.value)}
                          placeholder={`Point ${i + 1}`}
                          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                        {form.description_points.length > 1 && (
                          <button onClick={() => removeDescPoint(i)}
                            className="text-slate-400 hover:text-red-400 px-2">✕</button>
                        )}
                      </div>
                    ))}
                    <button onClick={addDescPoint}
                      className="text-xs text-green-600 font-medium hover:underline">
                      + Add point
                    </button>
                  </div>
                </div>

                {/* DUS Characters — cascading dropdowns from Cosh
                    (Batch W, 2026-05-19). Pickers are filtered at each
                    level by the previous selection. Legacy free-text
                    rows authored before this batch render as read-only
                    grey rows so history is preserved. */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-slate-600">DUS Characters</label>
                    <button onClick={addDusRow}
                      disabled={dusOptions.length === 0}
                      title={dusOptions.length === 0 ? 'No DUS taxonomy for this crop in Cosh yet.' : ''}
                      className="text-xs text-blue-600 font-medium hover:underline disabled:opacity-40 disabled:cursor-not-allowed">
                      + Add Row
                    </button>
                  </div>
                  {dusOptions.length === 0 && (
                    <p className="text-xs text-amber-600 mb-2">
                      No DUS taxonomy for this crop is in Cosh yet. Once Cosh
                      adds characters for this crop, new rows can be picked here.
                    </p>
                  )}
                  {form.dus_characters.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No DUS characters added.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border border-slate-100 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Plant Part *</th>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Sub-Part</th>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Character *</th>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Descriptor</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {form.dus_characters.map((d, i) => {
                            // Legacy free-text row (pre Batch W) — show
                            // the stored strings read-only with a small
                            // hint and a Remove button. SE can delete
                            // and re-add from the Cosh picker.
                            if (!d.part_cosh_id && (d.part || d.character)) {
                              return (
                                <tr key={i} className="bg-slate-50">
                                  <td className="px-2 py-1 text-slate-600">{d.part}</td>
                                  <td className="px-2 py-1 text-slate-500">{d.sub_part}</td>
                                  <td className="px-2 py-1 text-slate-600">{d.character}</td>
                                  <td className="px-2 py-1 text-slate-500">{d.descriptor}</td>
                                  <td className="px-1 py-1 text-right">
                                    <span className="text-[10px] text-slate-400 italic mr-2">legacy</span>
                                    <button onClick={() => removeDusRow(i)}
                                      className="text-slate-300 hover:text-red-400 px-1">✕</button>
                                  </td>
                                </tr>
                              )
                            }
                            const partOpt = dusOptions.find(p => p.part_cosh_id === d.part_cosh_id)
                            // Batch W-1: a subpart entry may have
                            // subpart_cosh_id=null (Cosh BLANK BOX).
                            // Auto-pick semantics: if the part has
                            // exactly one subpart and it's null, the
                            // dropdown is omitted entirely; the row's
                            // subpart slot stays undefined and the
                            // character dropdown unlocks immediately.
                            const subparts = partOpt?.subparts ?? []
                            const onlySubpartIsNa = subparts.length === 1 && subparts[0].subpart_cosh_id === null
                            const selectedSubpart = subparts.find(s =>
                              (s.subpart_cosh_id ?? null) === (d.subpart_cosh_id ?? null),
                            ) || (onlySubpartIsNa ? subparts[0] : undefined)
                            const charOpt = selectedSubpart?.characters.find(c => c.character_cosh_id === d.character_cosh_id)
                            // The character dropdown unlocks when
                            // EITHER the SE has explicitly picked a
                            // subpart OR the only subpart is the BLANK
                            // BOX "(not applicable)" entry.
                            const charDropdownReady = !!selectedSubpart
                            return (
                              <tr key={i}>
                                <td className="px-1 py-1">
                                  <select value={d.part_cosh_id || ''}
                                    onChange={e => pickDusPart(i, e.target.value)}
                                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400 bg-white">
                                    <option value="">— pick —</option>
                                    {dusOptions.map(p => (
                                      <option key={p.part_cosh_id} value={p.part_cosh_id}>{p.part_name_en}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-1 py-1">
                                  {onlySubpartIsNa ? (
                                    <span className="text-xs text-slate-400 italic px-2">
                                      not applicable
                                    </span>
                                  ) : (
                                    <select
                                      value={
                                        d.subpart_cosh_id
                                          ? d.subpart_cosh_id
                                          : (selectedSubpart && selectedSubpart.subpart_cosh_id === null ? '__NA__' : '')
                                      }
                                      disabled={!partOpt}
                                      onChange={e => pickDusSubpart(i, e.target.value)}
                                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400 bg-white disabled:bg-slate-50">
                                      <option value="">— pick —</option>
                                      {subparts.map(s => (
                                        s.subpart_cosh_id === null ? (
                                          <option key="__NA__" value="__NA__">— not applicable —</option>
                                        ) : (
                                          <option key={s.subpart_cosh_id} value={s.subpart_cosh_id}>{s.subpart_name_en}</option>
                                        )
                                      ))}
                                    </select>
                                  )}
                                </td>
                                <td className="px-1 py-1">
                                  <select value={d.character_cosh_id || ''}
                                    disabled={!charDropdownReady}
                                    onChange={e => pickDusCharacter(i, e.target.value)}
                                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400 bg-white disabled:bg-slate-50">
                                    <option value="">— pick —</option>
                                    {selectedSubpart?.characters.map(c => (
                                      <option key={c.character_cosh_id} value={c.character_cosh_id}>{c.character_name_en}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-1 py-1">
                                  <select value={d.descriptor_cosh_id || ''}
                                    disabled={!charOpt}
                                    onChange={e => pickDusDescriptor(i, e.target.value)}
                                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400 bg-white disabled:bg-slate-50">
                                    <option value="">— pick —</option>
                                    {charOpt?.descriptors.map(de => (
                                      <option key={de.descriptor_cosh_id} value={de.descriptor_cosh_id}>{de.descriptor_name_en}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-1 py-1">
                                  <button onClick={() => removeDusRow(i)}
                                    className="text-slate-300 hover:text-red-400 px-1">✕</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Image Upload */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Photos</label>
                  {form.photos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {form.photos.map((url, i) => (
                        <div key={i} className="relative group">
                          <img src={url} alt={`Photo ${i + 1}`}
                            className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                          <button
                            onClick={() => removePhoto(i)}
                            className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="photo-upload"
                  />
                  <label
                    htmlFor="photo-upload"
                    className={`inline-flex items-center gap-2 text-xs font-medium text-slate-600 border border-dashed border-slate-300 rounded-lg px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploading ? 'Uploading…' : '+ Upload Photo'}
                  </label>
                  <p className="text-xs text-slate-400 mt-1">First photo will appear as thumbnail in the variety list.</p>
                </div>

                {saveError && (
                  <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    {saveError}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={save} disabled={saving || !form.name.trim()}
                    className="flex-1 py-3 text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {saving ? 'Saving…' : selected ? 'Update Variety' : 'Create Variety'}
                  </button>
                  <button onClick={() => { setShowCreate(false); setSelected(null); setSaveError('') }}
                    className="px-5 rounded-xl border border-slate-200 text-slate-600 text-sm hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SeedVarietiesPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <SeedVarietiesContent />
    </Suspense>
  )
}
