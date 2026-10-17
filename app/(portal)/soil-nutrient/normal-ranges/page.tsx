'use client'
import { useEffect, useMemo, useState } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

type Operator = 'RANGE' | 'UPPER_BOUND' | 'LOWER_BOUND'
type CategoryGroup = 'BASE' | 'PRIMARY' | 'SECONDARY' | 'MICRO' | 'OTHER' | 'RATIO'

type SoilParameter = {
  id: string
  name: string
  unit: string | null
  category_group: CategoryGroup
  formula: string | null
  measurement_method_note: string | null
  display_order: number
}

type NormalRange = {
  id: string
  parameter_id: string
  operator: Operator
  low_value: number | null
  high_value: number | null
  low_pct_adjustment: number
  high_pct_adjustment: number
}

type ClientCrop = { crop_cosh_id: string; crop_name_en: string | null; status: string }

type RowState = {
  parameter_id: string
  operator: Operator | ''  // empty means "not authored"
  low: string
  high: string
  // Decision V — per-parameter target adjustment when the farmer's
  // value falls below Low (low_pct) or above High (high_pct). Stored
  // as a signed percentage: +X% raises the target, -X% lowers it.
  low_pct: string
  high_pct: string
  dirty: boolean
}

const GROUP_ORDER: CategoryGroup[] = ['BASE', 'PRIMARY', 'SECONDARY', 'MICRO', 'OTHER', 'RATIO']
const GROUP_LABEL: Record<CategoryGroup, string> = {
  BASE: 'Base soil chemistry',
  PRIMARY: 'Primary nutrients',
  SECONDARY: 'Secondary nutrients',
  MICRO: 'Micronutrients',
  OTHER: 'Other',
  RATIO: 'Derived ratios',
}
const GROUP_COLOR: Record<CategoryGroup, string> = {
  BASE: 'bg-slate-100 text-slate-700',
  PRIMARY: 'bg-emerald-100 text-emerald-700',
  SECONDARY: 'bg-blue-100 text-blue-700',
  MICRO: 'bg-amber-100 text-amber-700',
  OTHER: 'bg-purple-100 text-purple-700',
  RATIO: 'bg-pink-100 text-pink-700',
}

function parseFloatOrNull(s: string): number | null {
  if (!s.trim()) return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export default function NormalRangesPage() {
  const client = getClient()
  const clientId = client?.id

  const [parameters, setParameters] = useState<SoilParameter[]>([])
  const [crops, setCrops] = useState<ClientCrop[]>([])
  const [selectedCrop, setSelectedCrop] = useState<string>('')
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  // Load parameters + crops once
  useEffect(() => { loadStatic() }, [clientId])

  async function loadStatic() {
    if (!clientId) return
    setLoading(true); setModuleDisabled(false)
    try {
      const [p, cr] = await Promise.all([
        api.get(`/client/${clientId}/soil-nutrient/parameters`),
        api.get(`/client/${clientId}/crops`),
      ])
      setParameters(p.data)
      const activeCrops = (cr.data as ClientCrop[]).filter(c => c.status === 'ACTIVE')
      setCrops(activeCrops)
      if (!selectedCrop && activeCrops.length) setSelectedCrop(activeCrops[0].crop_cosh_id)
    } catch (e) {
      const code = (e as { response?: { data?: { detail?: { code?: string } } } })
        ?.response?.data?.detail?.code
      if (code === 'soil_nutrient_module_disabled') {
        setModuleDisabled(true)
      } else {
        setError(extractErrorMessage(e, 'Failed to load'))
      }
    } finally {
      setLoading(false)
    }
  }

  // Load ranges whenever crop changes
  useEffect(() => {
    if (clientId && selectedCrop) loadRanges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCrop])

  async function loadRanges() {
    if (!clientId || !selectedCrop) return
    try {
      setSavedMessage(null); setError(null)
      const { data } = await api.get(
        `/client/${clientId}/soil-nutrient/normal-ranges`,
        { params: { crop_cosh_id: selectedCrop } },
      )
      const byParam: Record<string, NormalRange> = {}
      for (const r of data as NormalRange[]) byParam[r.parameter_id] = r
      const next: Record<string, RowState> = {}
      for (const p of parameters) {
        const r = byParam[p.id]
        next[p.id] = {
          parameter_id: p.id,
          operator: r ? r.operator : '',
          low: r && r.low_value !== null ? String(r.low_value) : '',
          high: r && r.high_value !== null ? String(r.high_value) : '',
          low_pct: r ? String(r.low_pct_adjustment) : '0',
          high_pct: r ? String(r.high_pct_adjustment) : '0',
          dirty: false,
        }
      }
      setRows(next)
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to load ranges'))
    }
  }

  function updateRow(parameterId: string, patch: Partial<RowState>) {
    setRows(prev => ({
      ...prev,
      [parameterId]: { ...prev[parameterId], ...patch, dirty: true },
    }))
  }

  async function clearRow(parameterId: string) {
    if (!clientId || !selectedCrop) return
    const current = rows[parameterId]
    // If row was never saved to backend (no persisted operator → just a local draft)
    // just reset the local form fields.
    if (current && current.operator === '' && !current.dirty) return
    try {
      await api.delete(
        `/client/${clientId}/soil-nutrient/normal-ranges/${parameterId}`,
        { params: { crop_cosh_id: selectedCrop } },
      )
      updateRow(parameterId, { operator: '', low: '', high: '', low_pct: '0', high_pct: '0', dirty: false })
      setSavedMessage(null)
    } catch (e) {
      setError(extractErrorMessage(e, 'Clear failed'))
    }
  }

  async function saveAll() {
    if (!clientId || !selectedCrop) return
    setSaving(true); setError(null); setSavedMessage(null)
    try {
      // Collect only rows the user has edited and that have a valid operator.
      const payload = {
        rows: Object.values(rows)
          .filter(r => r.dirty && r.operator !== '')
          .map(r => {
            const op = r.operator as Operator
            // Operator-gated adjustments (also enforced server-side).
            // UPPER_BOUND has no Low classification → low_pct is 0;
            // LOWER_BOUND has no High classification → high_pct is 0.
            const lowPct = op === 'UPPER_BOUND' ? 0 : (parseFloatOrNull(r.low_pct) ?? 0)
            const highPct = op === 'LOWER_BOUND' ? 0 : (parseFloatOrNull(r.high_pct) ?? 0)
            return {
              parameter_id: r.parameter_id,
              operator: op,
              low_value: parseFloatOrNull(r.low),
              high_value: parseFloatOrNull(r.high),
              low_pct_adjustment: lowPct,
              high_pct_adjustment: highPct,
            }
          }),
      }
      if (payload.rows.length === 0) {
        setSavedMessage('Nothing to save.')
        setSaving(false)
        return
      }
      await api.put(
        `/client/${clientId}/soil-nutrient/normal-ranges`,
        payload,
        { params: { crop_cosh_id: selectedCrop } },
      )
      setSavedMessage(`Saved ${payload.rows.length} range${payload.rows.length === 1 ? '' : 's'}.`)
      loadRanges()
    } catch (e) {
      setError(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const groupedParams = useMemo(() => {
    const out: { group: CategoryGroup; items: SoilParameter[] }[] = []
    for (const g of GROUP_ORDER) {
      const items = parameters.filter(p => p.category_group === g)
      if (items.length) out.push({ group: g, items })
    }
    return out
  }, [parameters])

  const dirtyCount = Object.values(rows).filter(r => r.dirty && r.operator !== '').length

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
          <h1 className="text-2xl font-bold text-slate-900">Soil Normal Ranges</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Per-crop defaults. The engine classifies farmer soil values against these at personalisation time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-600">Crop:</label>
          <select value={selectedCrop} onChange={e => setSelectedCrop(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white min-w-[160px]">
            {crops.length === 0 && <option value="">(no active crops)</option>}
            {crops.map(c => (
              <option key={c.crop_cosh_id} value={c.crop_cosh_id}>
                {c.crop_name_en || c.crop_cosh_id}
              </option>
            ))}
          </select>
          <button onClick={saveAll} disabled={saving || dirtyCount === 0}
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
          </button>
        </div>
      </div>

      {savedMessage && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 mb-4">
          {savedMessage}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {loading || !selectedCrop ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
            <p>
              Three operator shapes available:
              {' '}<strong>RANGE</strong> (e.g. pH 6.5–7.5),
              {' '}<strong>UPPER_BOUND</strong> (e.g. EC &lt; 1.0),
              {' '}<strong>LOWER_BOUND</strong> (e.g. OC &gt; 1.0).
              Partial authoring is fine — a parameter you leave blank simply won&apos;t be classified by the engine for this crop.
            </p>
            <p className="mt-1.5">
              <strong>Low Adj % / High Adj %</strong> (Decision V): when a farmer&apos;s value is below Low or above High, the engine shifts the recommendation target by this signed percentage. Example: <code>N Low Adj = +20</code> means &quot;raise the N target by 20% when the farmer&apos;s N is Low&quot;. Leave at 0 if you don&apos;t want a numeric adjustment.
            </p>
          </div>

          {groupedParams.map(({ group, items }) => (
            <div key={group}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded ${GROUP_COLOR[group]}`}>
                  {GROUP_LABEL[group]}
                </span>
                <span className="text-xs text-slate-400">{items.length}</span>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-200">
                      <th className="text-left px-4 py-2 font-medium w-[22%]">Parameter</th>
                      <th className="text-left px-2 py-2 font-medium w-[14%]">Operator</th>
                      <th className="text-right px-2 py-2 font-medium w-[10%]">Low</th>
                      <th className="text-right px-2 py-2 font-medium w-[10%]">High</th>
                      <th className="text-right px-2 py-2 font-medium w-[11%]" title="If measured value is below Low, raise the target by this % (Decision V).">Low Adj %</th>
                      <th className="text-right px-2 py-2 font-medium w-[11%]" title="If measured value is above High, change the target by this % (Decision V, usually negative).">High Adj %</th>
                      <th className="text-left px-2 py-2 font-medium w-[8%]">Unit</th>
                      <th className="text-right px-4 py-2 font-medium w-[14%]">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(p => {
                      const row = rows[p.id]
                      if (!row) return null
                      const op = row.operator
                      const needsLow = op === 'RANGE' || op === 'LOWER_BOUND'
                      const needsHigh = op === 'RANGE' || op === 'UPPER_BOUND'
                      const authored = op !== ''
                      return (
                        <tr key={p.id} className={`border-b border-slate-100 last:border-0 ${row.dirty ? 'bg-amber-50' : ''}`}>
                          <td className="px-4 py-2">
                            <div className="font-medium text-slate-800">{p.name}</div>
                            {p.formula && (
                              <div className="text-[10px] font-mono text-slate-400">= {p.formula}</div>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <select value={op}
                              onChange={e => updateRow(p.id, { operator: e.target.value as Operator | '' })}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white">
                              <option value="">—</option>
                              <option value="RANGE">RANGE [a–b]</option>
                              <option value="UPPER_BOUND">&lt; x</option>
                              <option value="LOWER_BOUND">&gt; x</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" inputMode="decimal"
                              disabled={!needsLow}
                              value={needsLow ? row.low : ''}
                              onChange={e => updateRow(p.id, { low: e.target.value })}
                              placeholder={needsLow ? '…' : '—'}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" inputMode="decimal"
                              disabled={!needsHigh}
                              value={needsHigh ? row.high : ''}
                              onChange={e => updateRow(p.id, { high: e.target.value })}
                              placeholder={needsHigh ? '…' : '—'}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" inputMode="decimal"
                              disabled={!needsLow}
                              value={needsLow ? row.low_pct : ''}
                              onChange={e => updateRow(p.id, { low_pct: e.target.value })}
                              placeholder={needsLow ? '0' : '—'}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="text" inputMode="decimal"
                              disabled={!needsHigh}
                              value={needsHigh ? row.high_pct : ''}
                              onChange={e => updateRow(p.id, { high_pct: e.target.value })}
                              placeholder={needsHigh ? '0' : '—'}
                              className="w-full border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">{p.unit || '—'}</td>
                          <td className="px-4 py-2 text-right">
                            {authored && (
                              <button onClick={() => clearRow(p.id)}
                                className="text-xs text-red-500 hover:text-red-700">
                                Clear
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
