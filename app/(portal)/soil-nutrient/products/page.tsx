'use client'
import { useEffect, useMemo, useState } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

type CategoryField = {
  id: string
  category_id: string
  field_key: string
  field_label: string
  field_type: 'TEXT' | 'NUMBER' | 'ENUM' | 'MULTI_SELECT'
  required: boolean
  unit: string | null
  enum_values_json: { options?: string[] } | null
  display_order: number
  status: 'ACTIVE' | 'INACTIVE'
}

type Category = {
  id: string
  name: string
  scope: string
  display_order: number
  status: string
  fields: CategoryField[]
}

type ClientCrop = { crop_cosh_id: string; crop_name_en: string | null; status: string }
type CropAssignment = { id: string; crop_cosh_id: string; status: string }

type ClientProduct = {
  id: string
  client_id: string
  category_id: string
  display_name: string
  manufacturer: string | null
  grade: string | null
  formulation: string | null
  n_pct: number | null
  p2o5_pct: number | null
  k2o_pct: number | null
  ca_pct: number | null
  mg_pct: number | null
  s_pct: number | null
  zn_pct: number | null
  fe_pct: number | null
  mn_pct: number | null
  cu_pct: number | null
  b_pct: number | null
  application_methods: string[] | null
  data_json: Record<string, unknown> | null
  status: 'ACTIVE' | 'DISCONTINUED'
  created_at: string
  updated_at: string
  crop_assignments: CropAssignment[]
}

type FormState = {
  id?: string
  category_id: string
  display_name: string
  manufacturer: string
  grade: string
  formulation: string
  n_pct: string
  p2o5_pct: string
  k2o_pct: string
  ca_pct: string
  mg_pct: string
  s_pct: string
  zn_pct: string
  fe_pct: string
  mn_pct: string
  cu_pct: string
  b_pct: string
  application_methods: string[]
  notes: string
  crop_cosh_ids: string[]
}

const HOT_NUMERIC: Record<string, string> = {
  n_pct: 'N', p2o5_pct: 'P2O5', k2o_pct: 'K2O',
  ca_pct: 'Ca', mg_pct: 'Mg', s_pct: 'S',
  zn_pct: 'Zn', fe_pct: 'Fe', mn_pct: 'Mn',
  cu_pct: 'Cu', b_pct: 'B',
}

function emptyForm(categoryId: string = ''): FormState {
  return {
    category_id: categoryId,
    display_name: '', manufacturer: '', grade: '', formulation: '',
    n_pct: '', p2o5_pct: '', k2o_pct: '', ca_pct: '', mg_pct: '',
    s_pct: '', zn_pct: '', fe_pct: '', mn_pct: '', cu_pct: '', b_pct: '',
    application_methods: [], notes: '',
    crop_cosh_ids: [],
  }
}

function parseFloatOrNull(s: string): number | null {
  if (!s.trim()) return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export default function SoilNutrientProductsPage() {
  const client = getClient()
  const clientId = client?.id

  const [tab, setTab] = useState<'global' | 'per-crop'>('global')
  const [products, setProducts] = useState<ClientProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [crops, setCrops] = useState<ClientCrop[]>([])
  const [selectedCrop, setSelectedCrop] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const [filterCat, setFilterCat] = useState('')
  const [includeDiscontinued, setIncludeDiscontinued] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadAll() }, [clientId, includeDiscontinued])

  async function loadAll() {
    if (!clientId) return
    setLoading(true); setModuleDisabled(false)
    try {
      const [p, c, cr] = await Promise.all([
        api.get(`/client/${clientId}/soil-nutrient/products`,
          { params: { include_inactive: includeDiscontinued } }),
        api.get(`/client/${clientId}/soil-nutrient/product-categories`),
        api.get(`/client/${clientId}/crops`),
      ])
      setProducts(p.data)
      setCategories(c.data)
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

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  const cropByCoshId = useMemo(() => {
    const m = new Map<string, ClientCrop>()
    for (const c of crops) m.set(c.crop_cosh_id, c)
    return m
  }, [crops])

  const groupedByCat = useMemo(() => {
    const out: { cat: Category; items: ClientProduct[] }[] = []
    for (const cat of categories) {
      const items = products.filter(p =>
        p.category_id === cat.id && (!filterCat || p.category_id === filterCat),
      )
      if (items.length) out.push({ cat, items })
    }
    return out
  }, [products, categories, filterCat])

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
      const payload = {
        category_id: form.category_id,
        display_name: form.display_name.trim(),
        manufacturer: form.manufacturer.trim() || null,
        grade: form.grade.trim() || null,
        formulation: form.formulation.trim() || null,
        n_pct: parseFloatOrNull(form.n_pct),
        p2o5_pct: parseFloatOrNull(form.p2o5_pct),
        k2o_pct: parseFloatOrNull(form.k2o_pct),
        ca_pct: parseFloatOrNull(form.ca_pct),
        mg_pct: parseFloatOrNull(form.mg_pct),
        s_pct: parseFloatOrNull(form.s_pct),
        zn_pct: parseFloatOrNull(form.zn_pct),
        fe_pct: parseFloatOrNull(form.fe_pct),
        mn_pct: parseFloatOrNull(form.mn_pct),
        cu_pct: parseFloatOrNull(form.cu_pct),
        b_pct: parseFloatOrNull(form.b_pct),
        application_methods: form.application_methods.length ? form.application_methods : null,
        data_json: form.notes.trim() ? { notes: form.notes.trim() } : null,
        crop_cosh_ids: form.crop_cosh_ids,
      }
      if (form.id) {
        await api.patch(
          `/client/${clientId}/soil-nutrient/products/${form.id}`, payload)
      } else {
        await api.post(`/client/${clientId}/soil-nutrient/products`, payload)
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
    if (!confirm(`Discontinue "${p.display_name}"? Existing personalisations stay as-is; the product won't participate in future runs.`)) return
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

  function openEdit(p: ClientProduct) {
    setError(null)
    const notes = (p.data_json?.notes as string) || ''
    setForm({
      id: p.id,
      category_id: p.category_id,
      display_name: p.display_name,
      manufacturer: p.manufacturer || '',
      grade: p.grade || '',
      formulation: p.formulation || '',
      n_pct: p.n_pct !== null ? String(p.n_pct) : '',
      p2o5_pct: p.p2o5_pct !== null ? String(p.p2o5_pct) : '',
      k2o_pct: p.k2o_pct !== null ? String(p.k2o_pct) : '',
      ca_pct: p.ca_pct !== null ? String(p.ca_pct) : '',
      mg_pct: p.mg_pct !== null ? String(p.mg_pct) : '',
      s_pct: p.s_pct !== null ? String(p.s_pct) : '',
      zn_pct: p.zn_pct !== null ? String(p.zn_pct) : '',
      fe_pct: p.fe_pct !== null ? String(p.fe_pct) : '',
      mn_pct: p.mn_pct !== null ? String(p.mn_pct) : '',
      cu_pct: p.cu_pct !== null ? String(p.cu_pct) : '',
      b_pct: p.b_pct !== null ? String(p.b_pct) : '',
      application_methods: p.application_methods || [],
      notes,
      crop_cosh_ids: p.crop_assignments
        .filter(a => a.status === 'ACTIVE').map(a => a.crop_cosh_id),
    })
  }

  const formCategory = form?.category_id ? categoryById.get(form.category_id) : null
  const formulationOptions = formCategory?.fields.find(f => f.field_key === 'formulation')?.enum_values_json?.options || []
  const applicationOptions = formCategory?.fields.find(f => f.field_key === 'application_methods')?.enum_values_json?.options || []

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

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Soil-Nutrient Products</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Your Global Product List drives Tier 1 of soil-based personalisation.
          </p>
        </div>
        {tab === 'global' && (
          <div className="flex items-center gap-3">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white">
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={includeDiscontinued}
                onChange={e => setIncludeDiscontinued(e.target.checked)}
                className="rounded border-slate-300" />
              Show discontinued
            </label>
            <button
              onClick={() => { setError(null); setForm(emptyForm(categories[0]?.id || '')) }}
              disabled={categories.length === 0}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              + Add Product
            </button>
          </div>
        )}
      </div>

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
        groupedByCat.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm">No products yet.</p>
            <p className="text-xs mt-1">Click <strong>+ Add Product</strong> to start your catalogue.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedByCat.map(({ cat, items }) => (
              <div key={cat.id}>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
                  {cat.name} <span className="text-slate-400 font-normal">· {items.length}</span>
                </h2>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {items.map(p => {
                    const assignedCrops = p.crop_assignments
                      .filter(a => a.status === 'ACTIVE')
                      .map(a => cropByCoshId.get(a.crop_cosh_id)?.crop_name_en || a.crop_cosh_id)
                    return (
                      <div key={p.id}
                        className={`flex items-start justify-between px-5 py-3.5 border-b border-slate-100 last:border-0 ${p.status !== 'ACTIVE' ? 'bg-slate-50' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-3 flex-wrap">
                            <p className="font-medium text-slate-800 text-sm">
                              {p.display_name}
                              {p.status !== 'ACTIVE' && (
                                <span className="ml-2 text-xs text-slate-400 italic">(discontinued)</span>
                              )}
                            </p>
                            {p.manufacturer && (
                              <span className="text-xs text-slate-500">by {p.manufacturer}</span>
                            )}
                            {p.grade && (
                              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{p.grade}</span>
                            )}
                            {p.formulation && (
                              <span className="text-xs text-slate-500 italic">{p.formulation}</span>
                            )}
                          </div>
                          <NutrientPills p={p} />
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {p.application_methods?.map(m => (
                              <span key={m} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{m}</span>
                            ))}
                            {assignedCrops.length > 0 ? (
                              <span className="text-[10px] text-slate-500">
                                crops: {assignedCrops.slice(0, 3).join(', ')}
                                {assignedCrops.length > 3 && ` +${assignedCrops.length - 3}`}
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-600 italic">⚠ not assigned to any crop</span>
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
              </div>
            ))}
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
                        <p className="text-sm text-slate-800 truncate">{p.display_name}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {categoryById.get(p.category_id)?.name}
                          {p.grade && ` · ${p.grade}`}
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
                        <p className="text-sm text-slate-800 truncate">{p.display_name}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {categoryById.get(p.category_id)?.name}
                          {p.grade && ` · ${p.grade}`}
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

      {/* Form modal */}
      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !saving && setForm(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold">
                {form.id ? 'Edit Product' : 'New Product'}
              </h2>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Category</label>
                  <select value={form.category_id}
                    onChange={e => setForm({ ...form, category_id: e.target.value, formulation: '', application_methods: [] })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Display Name</label>
                  <input type="text" value={form.display_name}
                    onChange={e => setForm({ ...form, display_name: e.target.value })}
                    placeholder="e.g., Nutri-Gold 19:19:19"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Manufacturer</label>
                  <input type="text" value={form.manufacturer}
                    onChange={e => setForm({ ...form, manufacturer: e.target.value })}
                    placeholder="e.g., Nutri Agro Ltd"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Grade</label>
                  <input type="text" value={form.grade}
                    onChange={e => setForm({ ...form, grade: e.target.value })}
                    placeholder="e.g., 19:19:19"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Formulation</label>
                  <select value={form.formulation}
                    onChange={e => setForm({ ...form, formulation: e.target.value })}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">—</option>
                    {formulationOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Application Methods</label>
                  <div className="flex flex-wrap gap-2 border border-slate-300 rounded-lg px-3 py-2 min-h-[38px]">
                    {applicationOptions.map(o => {
                      const on = form.application_methods.includes(o)
                      return (
                        <button key={o} type="button"
                          onClick={() => setForm({
                            ...form,
                            application_methods: on
                              ? form.application_methods.filter(x => x !== o)
                              : [...form.application_methods, o],
                          })}
                          className={`text-xs px-2 py-0.5 rounded border ${on ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`}>
                          {o}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Nutrient Content (%)</p>
                <div className="grid grid-cols-6 gap-2">
                  {Object.entries(HOT_NUMERIC).map(([k, label]) => (
                    <div key={k}>
                      <label className="text-[10px] font-mono text-slate-500 block mb-0.5">{label}</label>
                      <input type="text" inputMode="decimal"
                        value={form[k as keyof FormState] as string}
                        onChange={e => setForm({ ...form, [k]: e.target.value })}
                        className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Notes <span className="text-slate-400">(optional)</span></label>
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
              <button onClick={save}
                disabled={saving || !form.display_name.trim() || !form.category_id}
                className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : form.id ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NutrientPills({ p }: { p: ClientProduct }) {
  const items: { label: string; v: number }[] = []
  const fields: [string, number | null][] = [
    ['N', p.n_pct], ['P2O5', p.p2o5_pct], ['K2O', p.k2o_pct],
    ['Ca', p.ca_pct], ['Mg', p.mg_pct], ['S', p.s_pct],
    ['Zn', p.zn_pct], ['Fe', p.fe_pct], ['Mn', p.mn_pct],
    ['Cu', p.cu_pct], ['B', p.b_pct],
  ]
  for (const [label, v] of fields) if (v !== null && v !== 0) items.push({ label, v })
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map(({ label, v }) => (
        <span key={label}
          className="text-[10px] font-mono bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
          {label}: {v}%
        </span>
      ))}
    </div>
  )
}
