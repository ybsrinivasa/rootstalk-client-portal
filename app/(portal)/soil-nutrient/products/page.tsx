'use client'
import { useEffect, useMemo, useState } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

type ClientCrop = { crop_cosh_id: string; crop_name_en: string | null; status: string }
type CropAssignment = { id: string; crop_cosh_id: string; status: string }

type CoshConcentration = { n: number; p: number; k: number }
type CoshFertilizer = {
  cosh_id: string
  name: string
  concentration: CoshConcentration
  water_soluble: boolean
}

type ClientProduct = {
  id: string
  client_id: string
  cosh_product_id: string
  status: 'ACTIVE' | 'DISCONTINUED'
  notes: string | null
  created_at: string
  updated_at: string
  crop_assignments: CropAssignment[]
  cosh: CoshFertilizer | null
}

type FormState = {
  id?: string
  cosh_product_id: string
  notes: string
  crop_cosh_ids: string[]
}

export default function SoilNutrientProductsPage() {
  const client = getClient()
  const clientId = client?.id

  const [tab, setTab] = useState<'global' | 'per-crop'>('global')
  const [products, setProducts] = useState<ClientProduct[]>([])
  const [coshFerts, setCoshFerts] = useState<CoshFertilizer[]>([])
  const [crops, setCrops] = useState<ClientCrop[]>([])
  const [selectedCrop, setSelectedCrop] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const [noLinkedMfrs, setNoLinkedMfrs] = useState(false)
  const [includeDiscontinued, setIncludeDiscontinued] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadAll() }, [clientId, includeDiscontinued])

  async function loadAll() {
    if (!clientId) return
    setLoading(true); setModuleDisabled(false); setError(null)
    try {
      const [p, f, cr] = await Promise.all([
        api.get(`/client/${clientId}/soil-nutrient/products`,
          { params: { include_inactive: includeDiscontinued } }),
        api.get(`/client/${clientId}/soil-nutrient/cosh-fertilizers`),
        api.get(`/client/${clientId}/crops`),
      ])
      setProducts(p.data)
      setCoshFerts(f.data)
      setNoLinkedMfrs((f.data as CoshFertilizer[]).length === 0)
      const activeCrops = (cr.data as ClientCrop[]).filter(c => c.status === 'ACTIVE')
      setCrops(activeCrops)
      if (!selectedCrop && activeCrops.length) setSelectedCrop(activeCrops[0].crop_cosh_id)
    } catch (e) {
      const code = (e as { response?: { data?: { detail?: { code?: string } } } })
        ?.response?.data?.detail?.code
      if (code === 'soil_nutrient_module_disabled') {
        setModuleDisabled(true)
      } else {
        setError(extractErrorMessage(e, 'Request failed'))
      }
    } finally {
      setLoading(false)
    }
  }

  const cropByCoshId = useMemo(() => {
    const m = new Map<string, ClientCrop>()
    for (const c of crops) m.set(c.crop_cosh_id, c)
    return m
  }, [crops])

  const linkedCoshIds = useMemo(
    () => new Set(products.map(p => p.cosh_product_id)),
    [products],
  )

  const pickerResults = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase()
    const base = coshFerts.filter(c => !linkedCoshIds.has(c.cosh_id))
    if (!q) return base.slice(0, 100)
    return base.filter(c =>
      c.name.toLowerCase().includes(q) || c.cosh_id.toLowerCase().includes(q),
    ).slice(0, 100)
  }, [coshFerts, linkedCoshIds, pickerSearch])

  const productsForSelectedCrop = useMemo(() => {
    if (!selectedCrop) return []
    return products.filter(p =>
      p.crop_assignments.some(a => a.crop_cosh_id === selectedCrop && a.status === 'ACTIVE'),
    )
  }, [products, selectedCrop])

  const productsNotForSelectedCrop = useMemo(() => {
    if (!selectedCrop) return []
    return products.filter(p =>
      p.status === 'ACTIVE'
      && !p.crop_assignments.some(a => a.crop_cosh_id === selectedCrop && a.status === 'ACTIVE'),
    )
  }, [products, selectedCrop])

  async function save() {
    if (!form || !clientId) return
    setSaving(true); setError(null)
    try {
      if (form.id) {
        await api.patch(`/client/${clientId}/soil-nutrient/products/${form.id}`, {
          notes: form.notes.trim() || null,
          crop_cosh_ids: form.crop_cosh_ids,
        })
      } else {
        await api.post(`/client/${clientId}/soil-nutrient/products`, {
          cosh_product_id: form.cosh_product_id,
          notes: form.notes.trim() || null,
          crop_cosh_ids: form.crop_cosh_ids,
        })
      }
      setForm(null)
      loadAll()
    } catch (e) {
      setError(extractErrorMessage(e, 'Request failed'))
    } finally {
      setSaving(false)
    }
  }

  async function discontinue(p: ClientProduct) {
    if (!clientId) return
    const name = p.cosh?.name || p.cosh_product_id
    if (!confirm(`Discontinue "${name}"? Existing personalisations stay as-is; the product won't participate in future runs.`)) return
    await api.delete(`/client/${clientId}/soil-nutrient/products/${p.id}`)
    loadAll()
  }

  async function reactivate(p: ClientProduct) {
    if (!clientId) return
    await api.patch(`/client/${clientId}/soil-nutrient/products/${p.id}`, { status: 'ACTIVE' })
    loadAll()
  }

  async function toggleCropAssignment(p: ClientProduct, cropCoshId: string, assign: boolean) {
    if (!clientId) return
    const next = assign
      ? Array.from(new Set([
          ...p.crop_assignments.filter(a => a.status === 'ACTIVE').map(a => a.crop_cosh_id),
          cropCoshId,
        ]))
      : p.crop_assignments.filter(a => a.status === 'ACTIVE' && a.crop_cosh_id !== cropCoshId).map(a => a.crop_cosh_id)
    await api.patch(
      `/client/${clientId}/soil-nutrient/products/${p.id}`,
      { crop_cosh_ids: next },
    )
    loadAll()
  }

  function pickCoshFert(c: CoshFertilizer) {
    setPickerOpen(false)
    setPickerSearch('')
    setError(null)
    setForm({
      cosh_product_id: c.cosh_id,
      notes: '',
      crop_cosh_ids: [],
    })
  }

  function openEdit(p: ClientProduct) {
    setError(null)
    setForm({
      id: p.id,
      cosh_product_id: p.cosh_product_id,
      notes: p.notes || '',
      crop_cosh_ids: p.crop_assignments
        .filter(a => a.status === 'ACTIVE').map(a => a.crop_cosh_id),
    })
  }

  if (moduleDisabled) {
    return (
      <div className="max-w-3xl mx-auto mt-16 text-center">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8">
          <h1 className="text-xl font-bold text-amber-800">Soil Nutrient Management is not enabled</h1>
          <p className="text-sm text-amber-700 mt-2">
            Please ask your Super Admin to enable the Soil Nutrient Module for {client?.display_name || 'your company'}.
          </p>
        </div>
      </div>
    )
  }

  const formCosh = form
    ? coshFerts.find(c => c.cosh_id === form.cosh_product_id)
      ?? (form.id ? products.find(p => p.id === form.id)?.cosh ?? null : null)
    : null

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Soil-Nutrient Products</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Your Global Product List drives Tier 1 of soil-based personalisation.
            Products are picked from Cosh, filtered by your linked Manufacturer(s).
          </p>
        </div>
        {tab === 'global' && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={includeDiscontinued}
                onChange={e => setIncludeDiscontinued(e.target.checked)}
                className="rounded border-slate-300" />
              Show discontinued
            </label>
            <button
              onClick={() => { setError(null); setPickerOpen(true); setPickerSearch('') }}
              disabled={coshFerts.length === 0}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              + Add from Cosh
            </button>
          </div>
        )}
      </div>

      {noLinkedMfrs && !loading && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Your company isn't linked to any Cosh Manufacturers yet, so the picker is empty.
          Ask your Super Admin to link your Manufacturer(s) from the Company edit modal in the SA Portal.
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-5">
        <div className="flex gap-6">
          <button onClick={() => setTab('global')}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === 'global' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            Global Product List
          </button>
          <button onClick={() => setTab('per-crop')}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${tab === 'per-crop' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            Per-Crop Assignments
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{error}</p>
      )}

      {loading ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : tab === 'global' ? (
        products.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm">No products yet.</p>
            <p className="text-xs mt-1">Click <strong>+ Add from Cosh</strong> to start your catalogue.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {products.map(p => {
              const assignedCrops = p.crop_assignments
                .filter(a => a.status === 'ACTIVE')
                .map(a => cropByCoshId.get(a.crop_cosh_id)?.crop_name_en || a.crop_cosh_id)
              return (
                <div key={p.id}
                  className={`flex items-start justify-between px-5 py-3.5 border-b border-slate-100 last:border-0 ${p.status !== 'ACTIVE' ? 'bg-slate-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <p className="font-medium text-slate-800 text-sm">
                        {p.cosh?.name || <span className="text-amber-600">Unknown Cosh product</span>}
                        {p.status !== 'ACTIVE' && (
                          <span className="ml-2 text-xs text-slate-400 italic">(discontinued)</span>
                        )}
                      </p>
                      <span className="text-[10px] font-mono text-slate-400">
                        {p.cosh_product_id}
                      </span>
                      {p.cosh?.water_soluble && (
                        <span className="text-[10px] bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded">water-soluble</span>
                      )}
                    </div>
                    {p.cosh && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <ConcPill label="N" v={p.cosh.concentration.n} />
                        <ConcPill label="P2O5" v={p.cosh.concentration.p} />
                        <ConcPill label="K2O" v={p.cosh.concentration.k} />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {assignedCrops.length > 0 ? (
                        <span className="text-[10px] text-slate-500">
                          crops: {assignedCrops.slice(0, 3).join(', ')}
                          {assignedCrops.length > 3 && ` +${assignedCrops.length - 3}`}
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-600 italic">⚠ not assigned to any crop</span>
                      )}
                      {p.notes && (
                        <span className="text-[10px] text-slate-500">· {p.notes}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <button onClick={() => openEdit(p)}
                      className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 hover:border-slate-300">
                      Edit
                    </button>
                    {p.status === 'ACTIVE' ? (
                      <button onClick={() => discontinue(p)}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:border-red-300">
                        Discontinue
                      </button>
                    ) : (
                      <button onClick={() => reactivate(p)}
                        className="text-xs text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded border border-emerald-200 hover:border-emerald-300">
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div>
          {/* Per-Crop tab */}
          <div className="mb-4 flex items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Crop:</label>
            <select value={selectedCrop} onChange={e => setSelectedCrop(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white">
              {crops.length === 0 && <option value="">(no active crops)</option>}
              {crops.map(c => (
                <option key={c.crop_cosh_id} value={c.crop_cosh_id}>
                  {c.crop_name_en || c.crop_cosh_id}
                </option>
              ))}
            </select>
          </div>

          {selectedCrop && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-2">
                  Assigned · {productsForSelectedCrop.length}
                </h3>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {productsForSelectedCrop.length === 0 ? (
                    <p className="px-5 py-6 text-center text-xs text-slate-400">
                      No products assigned to this crop yet.
                    </p>
                  ) : productsForSelectedCrop.map(p => (
                    <div key={p.id} className="flex items-start justify-between px-4 py-2.5 border-b border-slate-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">
                          {p.cosh?.name || p.cosh_product_id}
                        </p>
                      </div>
                      <button onClick={() => toggleCropAssignment(p, selectedCrop, false)}
                        className="text-xs text-red-500 hover:text-red-700 flex-shrink-0 ml-2">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
                  Not assigned · {productsNotForSelectedCrop.length}
                </h3>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {productsNotForSelectedCrop.length === 0 ? (
                    <p className="px-5 py-6 text-center text-xs text-slate-400">
                      All active products are assigned to this crop.
                    </p>
                  ) : productsNotForSelectedCrop.map(p => (
                    <div key={p.id} className="flex items-start justify-between px-4 py-2.5 border-b border-slate-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">
                          {p.cosh?.name || p.cosh_product_id}
                        </p>
                      </div>
                      <button onClick={() => toggleCropAssignment(p, selectedCrop, true)}
                        className="text-xs text-emerald-600 hover:text-emerald-700 flex-shrink-0 ml-2">
                        + Assign
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cosh picker modal */}
      {pickerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setPickerOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold">Add Product from Cosh</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Products made by your linked Manufacturer(s). Already-added products aren't shown.
              </p>
              <input type="text" value={pickerSearch} autoFocus
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Search by name or Cosh id…"
                className="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="overflow-y-auto flex-1">
              {pickerResults.length === 0 ? (
                <p className="text-center py-10 text-sm text-slate-400">
                  {pickerSearch.trim()
                    ? 'No matches.'
                    : 'All available Cosh products are already in your catalogue.'}
                </p>
              ) : pickerResults.map(c => (
                <button key={c.cosh_id} type="button"
                  onClick={() => pickCoshFert(c)}
                  className="w-full text-left px-5 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <span className="text-[10px] font-mono text-slate-400">{c.cosh_id}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <ConcPill label="N" v={c.concentration.n} />
                    <ConcPill label="P2O5" v={c.concentration.p} />
                    <ConcPill label="K2O" v={c.concentration.k} />
                    {c.water_soluble && (
                      <span className="text-[10px] bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded">water-soluble</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-slate-200 flex justify-end">
              <button onClick={() => setPickerOpen(false)}
                className="text-sm text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal — edit linkage or finalize a newly picked one */}
      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !saving && setForm(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold">
                {form.id ? 'Edit Product' : 'Add Product'}
              </h2>
              {formCosh && (
                <div className="mt-2">
                  <p className="text-sm text-slate-700">{formCosh.name}</p>
                  <span className="text-[10px] font-mono text-slate-400">{formCosh.cosh_id}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <ConcPill label="N" v={formCosh.concentration.n} />
                    <ConcPill label="P2O5" v={formCosh.concentration.p} />
                    <ConcPill label="K2O" v={formCosh.concentration.k} />
                  </div>
                </div>
              )}
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Notes <span className="text-slate-400">(optional)</span>
                </label>
                <textarea value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Short note or caveat"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-1">Crops</p>
                <p className="text-[11px] text-slate-500 mb-2">
                  Pick the crops this product participates in. (Can also be edited in the Per-Crop Assignments tab.)
                </p>
                <div className="flex flex-wrap gap-2">
                  {crops.map(c => {
                    const on = form.crop_cosh_ids.includes(c.crop_cosh_id)
                    return (
                      <button key={c.crop_cosh_id} type="button"
                        onClick={() => setForm({
                          ...form,
                          crop_cosh_ids: on
                            ? form.crop_cosh_ids.filter(x => x !== c.crop_cosh_id)
                            : [...form.crop_cosh_ids, c.crop_cosh_id],
                        })}
                        className={`text-xs px-2 py-1 rounded border ${on ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-white border-slate-300 text-slate-600'}`}>
                        {c.crop_name_en || c.crop_cosh_id}
                      </button>
                    )
                  })}
                </div>
                {crops.length === 0 && (
                  <p className="text-xs text-amber-600">
                    No active crops configured for this client — add crops in the Company Profile first.
                  </p>
                )}
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
              <button onClick={() => setForm(null)} disabled={saving}
                className="text-sm text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : form.id ? 'Save' : 'Add to Catalogue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ConcPill({ label, v }: { label: string; v: number }) {
  if (!v) return null
  return (
    <span className="text-[10px] font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
      {label}: {v}
    </span>
  )
}
