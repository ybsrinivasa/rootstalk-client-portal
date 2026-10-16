'use client'
// Phase 5a (2026-10-16) — Package-level Normal Range overrides inside the
// Package editor. Shows the 22 platform soil parameters with each row's
// effective range (Package override if present, else Client crop default).
// Hides itself when soil_nutrient_module_enabled is false on the Client.
//
// Backend endpoints (Phase 4a):
//   GET  /client/{cid}/soil-nutrient/parameters      — 22-row canon
//   GET  /client/{cid}/soil-nutrient/normal-ranges?crop_cosh_id=X — crop defaults
//   GET  /client/{cid}/soil-nutrient/packages/{pid}/overrides     — overrides
//   PUT  /client/{cid}/soil-nutrient/packages/{pid}/overrides     — bulk upsert
//   DELETE /client/{cid}/soil-nutrient/packages/{pid}/overrides/{param_id}

import { useEffect, useMemo, useState } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

type Operator = 'RANGE' | 'UPPER_BOUND' | 'LOWER_BOUND'
type CategoryGroup = 'BASE' | 'PRIMARY' | 'SECONDARY' | 'MICRO' | 'OTHER' | 'RATIO'

interface SoilParameter {
  id: string
  name: string
  unit: string | null
  category_group: CategoryGroup
  formula: string | null
  display_order: number
}

interface NormalRangeRow {
  id?: string
  parameter_id: string
  operator: Operator
  low_value: number | null
  high_value: number | null
}

type EffectiveSource = 'package' | 'crop' | 'none'

interface RowState {
  parameter_id: string
  operator: Operator | ''
  low: string
  high: string
  source: EffectiveSource  // where the current displayed value comes from
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

function stringify(v: number | null): string {
  return v === null ? '' : String(v)
}


export default function PackageSoilNormalRangesSection({
  packageId, cropCoshId,
}: {
  packageId: string
  cropCoshId: string
}) {
  const client = getClient()
  const clientId = client?.id
  const enabled = !!client?.soil_nutrient_module_enabled

  const [parameters, setParameters] = useState<SoilParameter[]>([])
  const [cropDefaults, setCropDefaults] = useState<Record<string, NormalRangeRow>>({})
  const [overrides, setOverrides] = useState<Record<string, NormalRangeRow>>({})
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!enabled || !clientId) { setLoading(false); return }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientId, packageId, cropCoshId])

  async function load() {
    if (!clientId) return
    setLoading(true); setError(null); setSavedMsg(null)
    try {
      const [p, defaults, ovs] = await Promise.all([
        api.get<SoilParameter[]>(`/client/${clientId}/soil-nutrient/parameters`),
        api.get<NormalRangeRow[]>(
          `/client/${clientId}/soil-nutrient/normal-ranges`,
          { params: { crop_cosh_id: cropCoshId } },
        ),
        api.get<NormalRangeRow[]>(
          `/client/${clientId}/soil-nutrient/packages/${packageId}/overrides`,
        ),
      ])
      setParameters(p.data)
      const defMap: Record<string, NormalRangeRow> = {}
      for (const r of defaults.data) defMap[r.parameter_id] = r
      setCropDefaults(defMap)
      const ovMap: Record<string, NormalRangeRow> = {}
      for (const r of ovs.data) ovMap[r.parameter_id] = r
      setOverrides(ovMap)
      // Build the row state: Package override wins, else crop default,
      // else blank (not classified by the engine).
      const next: Record<string, RowState> = {}
      for (const param of p.data) {
        const ov = ovMap[param.id]
        const def = defMap[param.id]
        if (ov) {
          next[param.id] = {
            parameter_id: param.id,
            operator: ov.operator,
            low: stringify(ov.low_value),
            high: stringify(ov.high_value),
            source: 'package',
            dirty: false,
          }
        } else if (def) {
          next[param.id] = {
            parameter_id: param.id,
            operator: def.operator,
            low: stringify(def.low_value),
            high: stringify(def.high_value),
            source: 'crop',
            dirty: false,
          }
        } else {
          next[param.id] = {
            parameter_id: param.id,
            operator: '',
            low: '',
            high: '',
            source: 'none',
            dirty: false,
          }
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
    setRows(prev => {
      const current = prev[parameterId]
      return {
        ...prev,
        [parameterId]: {
          ...current,
          ...patch,
          // Any user edit becomes a Package override (source=package)
          // and is dirty until saved. Reset button handles the
          // revert-to-crop-default case separately.
          source: 'package',
          dirty: true,
        },
      }
    })
  }

  async function resetToDefault(parameterId: string) {
    if (!clientId) return
    const current = rows[parameterId]
    if (!current) return
    // If the override was never persisted on backend, just revert the
    // local row to the crop default without a DELETE.
    const hadBackendOverride = !!overrides[parameterId]
    if (hadBackendOverride) {
      try {
        await api.delete(
          `/client/${clientId}/soil-nutrient/packages/${packageId}/overrides/${parameterId}`,
        )
        // Drop the override from local cache so re-render reflects crop default
        setOverrides(prev => {
          const next = { ...prev }
          delete next[parameterId]
          return next
        })
      } catch (e) {
        setError(extractErrorMessage(e, 'Clear failed'))
        return
      }
    }
    // Reset the local row to crop default (or blank if no default exists)
    const def = cropDefaults[parameterId]
    setRows(prev => ({
      ...prev,
      [parameterId]: def
        ? {
            parameter_id: parameterId,
            operator: def.operator,
            low: stringify(def.low_value),
            high: stringify(def.high_value),
            source: 'crop',
            dirty: false,
          }
        : {
            parameter_id: parameterId,
            operator: '',
            low: '',
            high: '',
            source: 'none',
            dirty: false,
          },
    }))
    setSavedMsg(null)
  }

  async function saveAll() {
    if (!clientId) return
    setSaving(true); setError(null); setSavedMsg(null)
    try {
      const dirtyRows = Object.values(rows).filter(r => r.dirty && r.operator !== '')
      if (dirtyRows.length === 0) {
        setSavedMsg('No changes to save.')
        setSaving(false)
        return
      }
      await api.put(
        `/client/${clientId}/soil-nutrient/packages/${packageId}/overrides`,
        {
          rows: dirtyRows.map(r => ({
            parameter_id: r.parameter_id,
            operator: r.operator,
            low_value: parseFloatOrNull(r.low),
            high_value: parseFloatOrNull(r.high),
          })),
        },
      )
      setSavedMsg(`Saved ${dirtyRows.length} override${dirtyRows.length === 1 ? '' : 's'}.`)
      await load()
    } catch (e) {
      setError(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  const grouped = useMemo(() => {
    const out: { group: CategoryGroup; items: SoilParameter[] }[] = []
    for (const g of GROUP_ORDER) {
      const items = parameters.filter(p => p.category_group === g)
      if (items.length) out.push({ group: g, items })
    }
    return out
  }, [parameters])

  const overrideCount = Object.values(rows).filter(r => r.source === 'package' && !r.dirty).length
  const dirtyCount = Object.values(rows).filter(r => r.dirty && r.operator !== '').length

  if (!enabled) return null  // Hide section entirely for non-enabled Clients

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold text-slate-800">
            Soil Normal Range Overrides
            {' '}
            <span className="text-slate-400 font-normal text-sm">
              ({overrideCount} override{overrideCount === 1 ? '' : 's'})
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tweak soil thresholds for this specific Package. Rows inherit from your crop defaults unless you change them here.
          </p>
        </div>
        <button onClick={() => setExpanded(!expanded)}
          className="text-sm font-medium px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50">
          {expanded ? 'Collapse' : 'Open'}
        </button>
      </div>

      {!expanded && (
        <p className="text-xs text-slate-500">
          {overrideCount === 0
            ? 'All 22 parameters inherit from your crop defaults.'
            : `${overrideCount} of 22 parameters have been overridden for this Package.`}
        </p>
      )}

      {expanded && (
        <div>
          {loading ? (
            <p className="text-center py-12 text-slate-400">Loading…</p>
          ) : (
            <>
              {savedMsg && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 mb-3">
                  {savedMsg}
                </p>
              )}
              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end mb-3">
                <button onClick={saveAll} disabled={saving || dirtyCount === 0}
                  className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {saving ? 'Saving…' : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
                </button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800 mb-4">
                Rows showing <strong>crop default</strong> inherit from Portal → Normal Ranges.
                Change the operator or Low/High to override just for this Package.
                Use <strong>Reset</strong> to revert a row to the crop default.
              </div>

              <div className="space-y-5">
                {grouped.map(({ group, items }) => (
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
                            <th className="text-left px-3 py-2 font-medium">Parameter</th>
                            <th className="text-left px-2 py-2 font-medium">Source</th>
                            <th className="text-left px-2 py-2 font-medium">Operator</th>
                            <th className="text-right px-2 py-2 font-medium">Low</th>
                            <th className="text-right px-2 py-2 font-medium">High</th>
                            <th className="text-left px-2 py-2 font-medium">Unit</th>
                            <th className="text-right px-3 py-2 font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(p => {
                            const row = rows[p.id]
                            if (!row) return null
                            const op = row.operator
                            const needsLow = op === 'RANGE' || op === 'LOWER_BOUND'
                            const needsHigh = op === 'RANGE' || op === 'UPPER_BOUND'
                            const sourceLabel =
                              row.source === 'package' ? 'this Package'
                              : row.source === 'crop' ? 'crop default'
                              : 'not set'
                            const sourceColor =
                              row.source === 'package' ? 'bg-amber-100 text-amber-800'
                              : row.source === 'crop' ? 'bg-slate-100 text-slate-600'
                              : 'bg-slate-50 text-slate-400 italic'
                            return (
                              <tr key={p.id}
                                className={`border-b border-slate-100 last:border-0 ${row.dirty ? 'bg-amber-50' : ''}`}>
                                <td className="px-3 py-2">
                                  <div className="font-medium text-slate-800">{p.name}</div>
                                  {p.formula && (
                                    <div className="text-[10px] font-mono text-slate-400">= {p.formula}</div>
                                  )}
                                </td>
                                <td className="px-2 py-2">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${sourceColor}`}>
                                    {sourceLabel}
                                  </span>
                                </td>
                                <td className="px-2 py-2">
                                  <select value={op}
                                    onChange={e => updateRow(p.id, { operator: e.target.value as Operator | '' })}
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs bg-white">
                                    <option value="">—</option>
                                    <option value="RANGE">[a–b]</option>
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
                                    className="w-20 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                                </td>
                                <td className="px-2 py-2">
                                  <input type="text" inputMode="decimal"
                                    disabled={!needsHigh}
                                    value={needsHigh ? row.high : ''}
                                    onChange={e => updateRow(p.id, { high: e.target.value })}
                                    placeholder={needsHigh ? '…' : '—'}
                                    className="w-20 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                                </td>
                                <td className="px-2 py-2 text-xs text-slate-500">{p.unit || '—'}</td>
                                <td className="px-3 py-2 text-right">
                                  {(row.source === 'package' || row.dirty) && (
                                    <button onClick={() => resetToDefault(p.id)}
                                      className="text-xs text-slate-600 hover:text-slate-900">
                                      Reset
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
