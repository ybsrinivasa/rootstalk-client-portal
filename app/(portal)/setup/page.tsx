'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'
import { LocationPicker, pairKey, unpairKey, type LocationUniverse } from '@/components/locations/LocationPicker'

interface ClientLocation {
  id: string; state_cosh_id: string; district_cosh_id: string; status: string; added_at: string
}
interface ClientCrop {
  id: string; crop_cosh_id: string; status: string; added_at: string
  crop_name_en?: string | null
}
interface AvailableCrop {
  cosh_id: string; name_en: string; status: string
}

export default function SetupPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'locations' | 'crops'>('locations')
  const [crops, setCrops] = useState<ClientCrop[]>([])
  const [available, setAvailable] = useState<AvailableCrop[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [savedHint, setSavedHint] = useState('')

  // Location picker state (2026-05-17 rebuild). `universe` is the
  // full Cosh India list; `selectedKeys` mirrors the company's
  // ACTIVE ClientLocation footprint as `${state}::${district}`
  // composite keys.
  const [universe, setUniverse] = useState<LocationUniverse>({ states: [] })
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  const [cropForm, setCropForm] = useState({ crop_cosh_id: '' })

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      api.get<LocationUniverse>('/cosh/locations/india').catch(() => ({ data: { states: [] } as LocationUniverse })),
      api.get<ClientLocation[]>(`/client/${clientId}/locations`).catch(() => ({ data: [] as ClientLocation[] })),
      api.get<ClientCrop[]>(`/client/${clientId}/crops`).catch(() => ({ data: [] as ClientCrop[] })),
      api.get<AvailableCrop[]>(`/client/${clientId}/available-crops`).catch(() => ({ data: [] as AvailableCrop[] })),
    ]).then(([uniRes, locRes, cropRes, availRes]) => {
      setUniverse(uniRes.data)
      const keys = new Set<string>()
      for (const l of locRes.data) {
        if (l.status === 'ACTIVE') keys.add(pairKey(l.state_cosh_id, l.district_cosh_id))
      }
      setSelectedKeys(keys)
      setCrops(cropRes.data)
      setAvailable(availRes.data)
    }).finally(() => setLoading(false))
  }, [clientId])

  async function saveLocations() {
    if (!clientId) return
    setSaving(true); setError(''); setSavedHint('')
    try {
      const pairs = Array.from(selectedKeys).map(k => unpairKey(k))
      await api.put(`/client/${clientId}/locations`, pairs)
      setSavedHint(`Saved ${pairs.length} district${pairs.length === 1 ? '' : 's'}.`)
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to save locations.'))
    } finally { setSaving(false) }
  }

  async function addCrop(e: FormEvent) {
    e.preventDefault()
    if (!cropForm.crop_cosh_id) return
    setSaving(true); setError('')
    try {
      const { data } = await api.post<ClientCrop>(`/client/${clientId}/crops`, cropForm)
      setCrops(prev => [...prev, data])
      setAvailable(prev => prev.filter(c => c.cosh_id !== cropForm.crop_cosh_id))
      setCropForm({ crop_cosh_id: '' })
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      // Backend 422 envelopes `{code, message}` for snapshot errors.
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail as { message?: string })?.message || 'Failed to add crop.'
      const code = (detail as { code?: string })?.code
      if (code === 'crop_missing_measure') {
        setError(
          `${msg} (Area-wise / plant-wise typing for this crop hasn't synced from Cosh yet — that ships in a separate Connect.)`,
        )
      } else {
        setError(msg)
      }
    } finally { setSaving(false) }
  }

  async function deleteCrop(id: string) {
    if (!clientId || !confirm('Remove this crop?')) return
    setDeleting(id)
    try {
      const removed = crops.find(c => c.id === id)
      await api.delete(`/client/${clientId}/crops/${id}`)
      setCrops(prev => prev.filter(c => c.id !== id))
      // Refresh the picker so the just-removed crop reappears.
      if (removed) {
        try {
          const { data } = await api.get<AvailableCrop[]>(`/client/${clientId}/available-crops`)
          setAvailable(data)
        } catch { /* picker refresh is best-effort */ }
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to remove crop.'))
    } finally { setDeleting(null) }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Setup</h1>
        <p className="text-slate-500 text-sm mt-0.5">Configure the locations and crops served by {client?.display_name}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['locations', 'crops'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setError('') }}
            className={`px-5 py-2 rounded-lg text-sm font-medium capitalize transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'locations' ? (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
              <div>
                <h3 className="font-semibold text-slate-800">Company Footprint</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Districts {client?.display_name || 'this company'} operates in. Packages can only target districts you&apos;ve enabled here.
                </p>
              </div>
              <button onClick={saveLocations} disabled={saving}
                className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {saving ? 'Saving…' : '✓ Save Locations'}
              </button>
            </div>
            <LocationPicker
              universe={universe}
              selected={selectedKeys}
              onChange={setSelectedKeys}
              accentColour={colour}
              emptyMessage="Cosh hasn't synced India locations to this server yet. Ask your RootsTalk admin to run a sync." />
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            {savedHint && <p className="text-sm text-green-700 mt-3">{savedHint}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Add Crop Form */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4">Add Crop</h3>
            <form onSubmit={addCrop} className="flex gap-3">
              <select
                value={cropForm.crop_cosh_id}
                onChange={e => setCropForm({ crop_cosh_id: e.target.value })}
                required
                disabled={available.length === 0}
                className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white">
                <option value="">
                  {available.length === 0
                    ? 'No crops left to add — every Cosh-classified crop is already on this list.'
                    : `Pick a crop (${available.length} available from Cosh)…`}
                </option>
                {available.map(c => (
                  <option key={c.cosh_id} value={c.cosh_id}>{c.name_en}</option>
                ))}
              </select>
              <button type="submit" disabled={saving || !cropForm.crop_cosh_id}
                className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {saving ? 'Adding…' : '+ Add'}
              </button>
            </form>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          {/* Crops list */}
          {crops.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-dashed border-slate-200">
              <p className="text-slate-500 text-sm">No crops configured. Add the crops this client provides advisory for.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Crop</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cosh ID</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Added</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {crops.map(crop => (
                    <tr key={crop.id}>
                      <td className="px-5 py-3 text-slate-800 font-medium">{crop.crop_name_en || '—'}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-500">{crop.crop_cosh_id}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${crop.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {crop.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{new Date(crop.added_at).toLocaleDateString()}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => deleteCrop(crop.id)}
                          disabled={deleting === crop.id}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">
                          {deleting === crop.id ? '…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
