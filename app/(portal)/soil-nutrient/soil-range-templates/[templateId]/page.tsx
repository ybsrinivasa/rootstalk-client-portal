'use client'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
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
  display_order: number
}

type TemplateRow = {
  id: string
  parameter_id: string
  operator: Operator
  low_value: number | null
  high_value: number | null
}

type Template = {
  id: string
  name: string
  description: string | null
  status: 'ACTIVE' | 'INACTIVE'
  rows: TemplateRow[]
}

type RowState = {
  parameter_id: string
  operator: Operator | ''
  low: string
  high: string
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

export default function SoilRangeTemplateEditorPage() {
  const client = getClient()
  const clientId = client?.id
  const params = useParams()
  const templateId = params.templateId as string
  const router = useRouter()

  const [tpl, setTpl] = useState<Template | null>(null)
  const [parameters, setParameters] = useState<SoilParameter[]>([])
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [metaDirty, setMetaDirty] = useState(false)

  useEffect(() => { load() }, [clientId, templateId])

  async function load() {
    if (!clientId || !templateId) return
    setLoading(true); setError(null)
    try {
      const [tplRes, paramsRes] = await Promise.all([
        // List endpoint hydrates rows; filter by id client-side.
        api.get(`/client/${clientId}/soil-nutrient/templates`, {
          params: { include_inactive: true },
        }),
        api.get(`/client/${clientId}/soil-nutrient/parameters`),
      ])
      const found = (tplRes.data as Template[]).find(t => t.id === templateId)
      if (!found) {
        setError('Template not found.')
        setTpl(null)
        return
      }
      setTpl(found)
      setName(found.name)
      setDescription(found.description || '')
      setMetaDirty(false)

      const paramsList = (paramsRes.data as SoilParameter[])
        .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
      setParameters(paramsList)

      const byParam: Record<string, TemplateRow> = {}
      for (const r of found.rows) byParam[r.parameter_id] = r
      const next: Record<string, RowState> = {}
      for (const p of paramsList) {
        const r = byParam[p.id]
        next[p.id] = {
          parameter_id: p.id,
          operator: r ? r.operator : '',
          low: r && r.low_value !== null ? String(r.low_value) : '',
          high: r && r.high_value !== null ? String(r.high_value) : '',
          dirty: false,
        }
      }
      setRows(next)
    } catch (e) {
      setError(extractErrorMessage(e, 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }

  function updateRow(parameterId: string, patch: Partial<RowState>) {
    setRows(prev => ({
      ...prev,
      [parameterId]: { ...prev[parameterId], ...patch, dirty: true },
    }))
  }

  async function clearRow(parameterId: string) {
    if (!clientId || !templateId) return
    const current = rows[parameterId]
    if (current && current.operator === '' && !current.dirty) return
    try {
      await api.delete(
        `/client/${clientId}/soil-nutrient/templates/${templateId}/rows/${parameterId}`,
      )
      updateRow(parameterId, { operator: '', low: '', high: '', dirty: false })
      setSavedMsg(null)
    } catch (e) {
      setError(extractErrorMessage(e, 'Clear failed'))
    }
  }

  async function saveMeta() {
    if (!clientId || !templateId) return
    setSaving(true); setError(null); setSavedMsg(null)
    try {
      await api.patch(`/client/${clientId}/soil-nutrient/templates/${templateId}`, {
        name: name.trim(),
        description: description.trim() || null,
      })
      setMetaDirty(false)
      setSavedMsg('Name / description saved.')
      load()
    } catch (e) {
      setError(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  async function saveRows() {
    if (!clientId || !templateId) return
    setSaving(true); setError(null); setSavedMsg(null)
    try {
      const payload = {
        rows: Object.values(rows)
          .filter(r => r.dirty && r.operator !== '')
          .map(r => {
            const op = r.operator as Operator
            // Strip the field the operator doesn't need. The UI hides
            // the input but the row state may still hold a stale value
            // left over from before the user switched operators —
            // sending that value trips the backend's per-operator
            // invariant with an unfriendly "parameter <uuid>" error.
            return {
              parameter_id: r.parameter_id,
              operator: op,
              low_value: op === 'UPPER_BOUND' ? null : parseFloatOrNull(r.low),
              high_value: op === 'LOWER_BOUND' ? null : parseFloatOrNull(r.high),
            }
          }),
      }
      if (payload.rows.length === 0) {
        setSavedMsg('No row changes to save.')
        setSaving(false)
        return
      }
      await api.put(
        `/client/${clientId}/soil-nutrient/templates/${templateId}/rows`,
        payload,
      )
      setSavedMsg(`Saved ${payload.rows.length} row${payload.rows.length === 1 ? '' : 's'}.`)
      load()
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

  const dirtyRowCount = Object.values(rows).filter(r => r.dirty && r.operator !== '').length

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/soil-nutrient/soil-range-templates"
            className="text-xs text-slate-500 hover:text-slate-700">
            ← All templates
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            {tpl ? tpl.name : 'Template'}
          </h1>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{error}</p>
      )}
      {savedMsg && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 mb-4">{savedMsg}</p>
      )}

      {loading ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : !tpl ? (
        null
      ) : (
        <div className="space-y-5">
          {/* Meta */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr] gap-3 items-start">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Name</label>
                <input type="text" value={name}
                  onChange={e => { setName(e.target.value); setMetaDirty(true) }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Description <span className="text-slate-400">(optional)</span>
                </label>
                <input type="text" value={description}
                  onChange={e => { setDescription(e.target.value); setMetaDirty(true) }}
                  placeholder="Short note about where this applies"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            {metaDirty && (
              <div className="mt-3 flex justify-end">
                <button onClick={saveMeta} disabled={saving || !name.trim()}
                  className="bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save name / description'}
                </button>
              </div>
            )}
          </div>

          {/* Help */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
            <p>
              Author bounds per parameter.
              {' '}<strong>RANGE</strong> (e.g. pH 6.5–7.5),
              {' '}<strong>UPPER_BOUND</strong> (e.g. EC &lt; 1.0),
              {' '}<strong>LOWER_BOUND</strong> (e.g. OC &gt; 1.0).
              Partial authoring is fine — parameters you leave blank aren't classified for Packages that use this template.
            </p>
            <p className="mt-1.5">
              <strong>Decision V % adjustments</strong> are set per-Package (Advisory → Package → Soil Range section), not here —
              they're crop-sensitive, and the template is crop-independent.
            </p>
          </div>

          {/* Rows */}
          <div className="flex justify-between items-center">
            <p className="text-xs text-slate-500">
              {dirtyRowCount > 0 ? `${dirtyRowCount} row change${dirtyRowCount === 1 ? '' : 's'} to save` : 'No unsaved row changes'}
            </p>
            <button onClick={saveRows} disabled={saving || dirtyRowCount === 0}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : `Save rows${dirtyRowCount > 0 ? ` (${dirtyRowCount})` : ''}`}
            </button>
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
                      <th className="text-left px-4 py-2 font-medium w-[40%]">Parameter</th>
                      <th className="text-left px-2 py-2 font-medium w-[18%]">Operator</th>
                      <th className="text-right px-2 py-2 font-medium w-[14%]">Low</th>
                      <th className="text-right px-2 py-2 font-medium w-[14%]">High</th>
                      <th className="text-left px-2 py-2 font-medium w-[10%]">Unit</th>
                      <th className="text-right px-4 py-2 font-medium w-[4%]">Action</th>
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
