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

interface DusCharacter {
  part: string
  sub_part: string
  character: string
  descriptor: string
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
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    if (!clientId || !cropCoshId) return
    const [vrRes, pkgRes, cropsRes] = await Promise.all([
      api.get<Variety[]>(`/client/${clientId}/varieties?crop_cosh_id=${encodeURIComponent(cropCoshId)}`),
      api.get<Package[]>(`/client/${clientId}/packages`).catch(() => ({ data: [] as Package[] })),
      api.get<ClientCrop[]>(`/client/${clientId}/crops`).catch(() => ({ data: [] as ClientCrop[] })),
    ])
    setVarieties(vrRes.data)
    // Only show packages of the same crop in the PoP-assign chips.
    setPackages(pkgRes.data.filter(p => p.crop_cosh_id === cropCoshId))
    const matched = cropsRes.data.find(c => c.crop_cosh_id === cropCoshId)
    setCropName(matched?.crop_name_en || '')
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
    setForm(f => ({ ...f, dus_characters: [...f.dus_characters, { part: '', sub_part: '', character: '', descriptor: '' }] }))
  }
  function setDusField(i: number, field: keyof DusCharacter, v: string) {
    setForm(f => {
      const chars = [...f.dus_characters]
      chars[i] = { ...chars[i], [field]: v }
      return { ...f, dus_characters: chars }
    })
  }
  function removeDusRow(i: number) {
    setForm(f => ({ ...f, dus_characters: f.dus_characters.filter((_, idx) => idx !== i) }))
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
    if (!clientId || !form.name.trim() || !form.crop_cosh_id.trim()) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        description_points: form.description_points.filter(p => p.trim()),
        dus_characters: form.dus_characters.filter(d => d.part.trim() && d.character.trim()),
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
          <button onClick={() => { setShowCreate(true); setSelected(null); setForm(emptyForm(cropCoshId)) }}
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

                {/* DUS Characters */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-medium text-slate-600">DUS Characters</label>
                    <button onClick={addDusRow}
                      className="text-xs text-blue-600 font-medium hover:underline">
                      + Add Row
                    </button>
                  </div>
                  {form.dus_characters.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No DUS characters added. Click &ldquo;+ Add Row&rdquo; to begin.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border border-slate-100 rounded-lg overflow-hidden">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Part *</th>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Sub-Part</th>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Character *</th>
                            <th className="text-left px-2 py-2 font-medium text-slate-500">Descriptor</th>
                            <th className="px-2 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {form.dus_characters.map((d, i) => (
                            <tr key={i}>
                              <td className="px-1 py-1">
                                <input value={d.part} onChange={e => setDusField(i, 'part', e.target.value)}
                                  placeholder="e.g. Leaf"
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
                              </td>
                              <td className="px-1 py-1">
                                <input value={d.sub_part} onChange={e => setDusField(i, 'sub_part', e.target.value)}
                                  placeholder="Optional"
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
                              </td>
                              <td className="px-1 py-1">
                                <input value={d.character} onChange={e => setDusField(i, 'character', e.target.value)}
                                  placeholder="e.g. Colour"
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
                              </td>
                              <td className="px-1 py-1">
                                <input value={d.descriptor} onChange={e => setDusField(i, 'descriptor', e.target.value)}
                                  placeholder="e.g. Green"
                                  className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-400" />
                              </td>
                              <td className="px-1 py-1">
                                <button onClick={() => removeDusRow(i)}
                                  className="text-slate-300 hover:text-red-400 px-1">✕</button>
                              </td>
                            </tr>
                          ))}
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

                <div className="flex gap-3 pt-2">
                  <button onClick={save} disabled={saving || !form.name.trim()}
                    className="flex-1 py-3 text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {saving ? 'Saving…' : selected ? 'Update Variety' : 'Create Variety'}
                  </button>
                  <button onClick={() => { setShowCreate(false); setSelected(null) }}
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
