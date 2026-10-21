'use client'
/**
 * Decision W (2026-10-17) rewrite — Package editor section for Soil
 * Range configuration.
 *
 * Each Package picks a `soil_range_template_id` (geography-based,
 * client-level library). The template supplies bounds per parameter;
 * this section lets the SE:
 *   1. Pick / change / clear the template binding (writes to
 *      PUT /client/{cid}/packages/{pid}).
 *   2. Author Package-level overrides — any mix of bounds override
 *      (operator + low + high) and Decision V adjustments (Low Adj /
 *      High Adj %), per parameter.
 *
 * Shown table columns:
 *   Parameter | Source | Operator | Low | High | Low Adj % | High Adj %
 *     | Unit | Action
 *
 * Source badge values:
 *   - "template"       → bounds come from the template row untouched
 *   - "package"        → operator/low/high set on this Package (override)
 *   - "package-adj"    → inherit bounds; only adjustments overridden
 *   - "none"           → neither template nor Package row — not classified
 */
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

interface TemplateRow {
  parameter_id: string
  operator: Operator
  low_value: number | null
  high_value: number | null
}

interface Template {
  id: string
  name: string
  description: string | null
  status: 'ACTIVE' | 'INACTIVE'
  rows: TemplateRow[]
}

interface OverrideRow {
  id?: string
  parameter_id: string
  operator: Operator | null
  low_value: number | null
  high_value: number | null
  low_pct_adjustment: number
  high_pct_adjustment: number
}

type EffectiveSource = 'template' | 'package' | 'package-adj' | 'none'

interface RowState {
  parameter_id: string
  operator: Operator | ''
  low: string
  high: string
  low_pct: string
  high_pct: string
  source: EffectiveSource
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

function stringify(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v)
}

export default function PackageSoilNormalRangesSection({
  packageId,
  initialTemplateId,
}: {
  packageId: string
  initialTemplateId: string | null
}) {
  const client = getClient()
  const clientId = client?.id
  const enabled = !!client?.soil_nutrient_module_enabled

  const [parameters, setParameters] = useState<SoilParameter[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(initialTemplateId)
  const [overrides, setOverrides] = useState<Record<string, OverrideRow>>({})
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingTpl, setSavingTpl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => { if (expanded && enabled) load() }, [expanded, enabled, selectedTemplateId])

  async function load() {
    if (!clientId) return
    setLoading(true); setError(null)
    try {
      const [paramsRes, tplsRes, ovsRes] = await Promise.all([
        api.get(`/client/${clientId}/soil-nutrient/parameters`),
        api.get(`/client/${clientId}/soil-nutrient/templates`),
        api.get(`/client/${clientId}/soil-nutrient/packages/${packageId}/overrides`),
      ])
      const params = (paramsRes.data as SoilParameter[])
        .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
      setParameters(params)
      setTemplates(tplsRes.data as Template[])
      const ovs = ovsRes.data as OverrideRow[]
      const ovMap: Record<string, OverrideRow> = {}
      for (const r of ovs) ovMap[r.parameter_id] = r
      setOverrides(ovMap)

      // Resolve the active template rows (if any).
      const tplRows: Record<string, TemplateRow> = {}
      if (selectedTemplateId) {
        const tpl = (tplsRes.data as Template[]).find(t => t.id === selectedTemplateId)
        if (tpl) for (const r of tpl.rows) tplRows[r.parameter_id] = r
      }

      // Build row state: Package override takes precedence; else
      // template; else blank.
      const next: Record<string, RowState> = {}
      for (const param of params) {
        const ov = ovMap[param.id]
        const tplRow = tplRows[param.id]
        if (ov) {
          const inheritingBounds = ov.operator === null
          next[param.id] = {
            parameter_id: param.id,
            operator: inheritingBounds ? (tplRow?.operator ?? '') : ov.operator!,
            low: inheritingBounds ? stringify(tplRow?.low_value) : stringify(ov.low_value),
            high: inheritingBounds ? stringify(tplRow?.high_value) : stringify(ov.high_value),
            low_pct: String(ov.low_pct_adjustment),
            high_pct: String(ov.high_pct_adjustment),
            source: inheritingBounds ? 'package-adj' : 'package',
            dirty: false,
          }
        } else if (tplRow) {
          next[param.id] = {
            parameter_id: param.id,
            operator: tplRow.operator,
            low: stringify(tplRow.low_value),
            high: stringify(tplRow.high_value),
            low_pct: '0',
            high_pct: '0',
            source: 'template',
            dirty: false,
          }
        } else {
          next[param.id] = {
            parameter_id: param.id,
            operator: '',
            low: '',
            high: '',
            low_pct: '0',
            high_pct: '0',
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
        [parameterId]: { ...current, ...patch, source: 'package', dirty: true },
      }
    })
  }

  function updateAdjustments(parameterId: string, patch: { low_pct?: string; high_pct?: string }) {
    setRows(prev => {
      const current = prev[parameterId]
      // Pure adjustment edits don't change the bounds-source. If bounds
      // currently come from template, source becomes 'package-adj'; if
      // bounds already overridden, source stays 'package'.
      const newSource: EffectiveSource =
        current.source === 'package' ? 'package' : 'package-adj'
      return {
        ...prev,
        [parameterId]: { ...current, ...patch, source: newSource, dirty: true },
      }
    })
  }

  async function resetRow(parameterId: string) {
    if (!clientId) return
    const current = rows[parameterId]
    if (!current) return
    const hadBackendOverride = !!overrides[parameterId]
    if (hadBackendOverride) {
      try {
        await api.delete(
          `/client/${clientId}/soil-nutrient/packages/${packageId}/overrides/${parameterId}`,
        )
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
    // Reset local row to template bounds (or blank if no template row).
    const tpl = templates.find(t => t.id === selectedTemplateId)
    const tplRow = tpl?.rows.find(r => r.parameter_id === parameterId)
    setRows(prev => ({
      ...prev,
      [parameterId]: tplRow
        ? {
            parameter_id: parameterId,
            operator: tplRow.operator,
            low: stringify(tplRow.low_value),
            high: stringify(tplRow.high_value),
            low_pct: '0',
            high_pct: '0',
            source: 'template',
            dirty: false,
          }
        : {
            parameter_id: parameterId,
            operator: '',
            low: '',
            high: '',
            low_pct: '0',
            high_pct: '0',
            source: 'none',
            dirty: false,
          },
    }))
    setSavedMsg(null)
  }

  async function changeTemplate(newId: string | null) {
    if (!clientId) return
    setSavingTpl(true); setError(null); setSavedMsg(null)
    try {
      await api.put(`/client/${clientId}/packages/${packageId}`, {
        soil_range_template_id: newId,
      })
      setSelectedTemplateId(newId)
      setSavedMsg(newId ? 'Template changed.' : 'Template cleared.')
    } catch (e) {
      setError(extractErrorMessage(e, 'Template change failed'))
    } finally {
      setSavingTpl(false)
    }
  }

  async function saveOverrides() {
    if (!clientId) return
    setSaving(true); setError(null); setSavedMsg(null)
    try {
      // Build the payload. For each dirty row, decide whether it
      // carries a bounds-override (operator was set by the user AND
      // differs from the template bounds — simplest approximation:
      // source==='package') or only adjustments (source==='package-adj'
      // or operator inherits).
      const tpl = templates.find(t => t.id === selectedTemplateId)
      const tplRowByParam: Record<string, TemplateRow> = {}
      if (tpl) for (const r of tpl.rows) tplRowByParam[r.parameter_id] = r

      const dirty = Object.values(rows).filter(r => r.dirty)
      if (dirty.length === 0) {
        setSavedMsg('No changes to save.')
        setSaving(false)
        return
      }

      // Decision V-amend (2026-10-21) — index parameter category_group
      // so the save path can zero-out adjustments for non-dosable rows,
      // regardless of what the (disabled) input holds.
      const paramById: Record<string, SoilParameter> = {}
      for (const p of parameters) paramById[p.id] = p
      const NON_DOSABLE: CategoryGroup[] = ['BASE', 'OTHER', 'RATIO']

      const payloadRows = dirty.map(r => {
        const tplRow = tplRowByParam[r.parameter_id]
        const op = r.operator as Operator | ''
        // Decide bounds-override vs inherit:
        // - If the user has no template row to inherit from, must send
        //   their own operator + bounds.
        // - If the user's operator / low / high differ from the
        //   template row's, send as override.
        // - Otherwise (matches template), send operator=null to inherit.
        const matchesTemplate =
          !!tplRow
          && op === tplRow.operator
          && parseFloatOrNull(r.low) === tplRow.low_value
          && parseFloatOrNull(r.high) === tplRow.high_value
        const inheritBounds = matchesTemplate
        const effectiveOp = inheritBounds ? null : (op || null)
        if (effectiveOp === null && !inheritBounds) {
          // Pure adjustment, no template to inherit from — must declare
          // an operator or we can't apply the adjustment. Caller
          // enforcement: a row with operator='' and no template row is
          // not classifiable; we'll skip saving it as an override.
          return null
        }
        const param = paramById[r.parameter_id]
        const nonDosable = !!param && NON_DOSABLE.includes(param.category_group)
        const lowPct = nonDosable
          ? 0
          : effectiveOp === 'UPPER_BOUND'
            ? 0 : (parseFloatOrNull(r.low_pct) ?? 0)
        const highPct = nonDosable
          ? 0
          : effectiveOp === 'LOWER_BOUND'
            ? 0 : (parseFloatOrNull(r.high_pct) ?? 0)
        return {
          parameter_id: r.parameter_id,
          operator: effectiveOp,
          low_value: inheritBounds ? null : parseFloatOrNull(r.low),
          high_value: inheritBounds ? null : parseFloatOrNull(r.high),
          low_pct_adjustment: lowPct,
          high_pct_adjustment: highPct,
        }
      }).filter((x): x is NonNullable<typeof x> => x !== null)

      if (payloadRows.length === 0) {
        setSavedMsg('Nothing to save — set an operator or pick a template with bounds first.')
        setSaving(false)
        return
      }

      await api.put(
        `/client/${clientId}/soil-nutrient/packages/${packageId}/overrides`,
        { rows: payloadRows },
      )
      setSavedMsg(`Saved ${payloadRows.length} row${payloadRows.length === 1 ? '' : 's'}.`)
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

  const activeTemplates = useMemo(
    () => templates.filter(t => t.status === 'ACTIVE'),
    [templates],
  )
  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  )

  const dirtyCount = Object.values(rows).filter(r => r.dirty).length

  if (!enabled) return null

  return (
    <div className="mb-6">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
        <div className="text-left">
          <p className="text-sm font-semibold text-slate-800">
            Soil Range (Template + Package overrides)
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {expanded
              ? 'Click to collapse'
              : selectedTemplate
                ? `Using template: ${selectedTemplate.name}`
                : 'No template picked — click to configure'}
          </p>
        </div>
        <span className="text-slate-400 text-sm">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-5">
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
          {savedMsg && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{savedMsg}</p>
          )}

          {/* Template picker */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Soil Range Template
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={selectedTemplateId || ''}
                disabled={savingTpl}
                onChange={e => changeTemplate(e.target.value || null)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white flex-1 min-w-[200px]">
                <option value="">— no template —</option>
                {activeTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {savingTpl && <span className="text-xs text-slate-500">saving…</span>}
            </div>
            {selectedTemplate?.description && (
              <p className="text-[11px] text-slate-500 mt-1.5">{selectedTemplate.description}</p>
            )}
            <p className="text-[11px] text-slate-500 mt-2">
              Templates are managed on the <strong>Soil Range Templates</strong> page.
              Decision V % adjustments are per-Package (edited in the table below).
            </p>
          </div>

          {loading ? (
            <p className="text-center py-8 text-slate-400">Loading…</p>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <p className="text-xs text-slate-500">
                  {dirtyCount > 0 ? `${dirtyCount} change${dirtyCount === 1 ? '' : 's'} to save` : 'No unsaved changes'}
                </p>
                <button onClick={saveOverrides} disabled={saving || dirtyCount === 0}
                  className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving…' : `Save${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
                </button>
              </div>

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
                          <th className="text-right px-2 py-2 font-medium">Low Adj %</th>
                          <th className="text-right px-2 py-2 font-medium">High Adj %</th>
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
                          // Decision V-amend (2026-10-21) — BASE / OTHER / RATIO
                          // parameters classify fine but have no dose-shift
                          // semantics (you can't "shift pH target by 20%").
                          // Disable Adj % cells and surface a tooltip.
                          const isDosable = !['BASE', 'OTHER', 'RATIO'].includes(p.category_group)
                          const nonDosableTooltip = isDosable
                            ? undefined
                            : `${p.name} isn't a dosable parameter — the engine can't shift its target via a fertilizer product. Classification still works (Low / Optimum / High in Section 2 of the Mock Report).`
                          const sourceLabel =
                            row.source === 'template' ? 'template'
                            : row.source === 'package' ? 'overridden'
                            : row.source === 'package-adj' ? 'adj-only'
                            : 'not set'
                          const sourceColor =
                            row.source === 'template' ? 'bg-slate-100 text-slate-600'
                            : row.source === 'package' ? 'bg-amber-100 text-amber-800'
                            : row.source === 'package-adj' ? 'bg-sky-100 text-sky-700'
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
                              <td className="px-2 py-2">
                                {!isDosable ? (
                                  <div className="w-20 px-2 py-1 text-xs font-mono text-right text-slate-400 italic"
                                    title={nonDosableTooltip}>
                                    n/a
                                  </div>
                                ) : (
                                  <input type="text" inputMode="decimal"
                                    disabled={!needsLow}
                                    value={needsLow ? row.low_pct : ''}
                                    onChange={e => updateAdjustments(p.id, { low_pct: e.target.value })}
                                    placeholder={needsLow ? '0' : '—'}
                                    className="w-20 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                                )}
                              </td>
                              <td className="px-2 py-2">
                                {!isDosable ? (
                                  <div className="w-20 px-2 py-1 text-xs font-mono text-right text-slate-400 italic"
                                    title={nonDosableTooltip}>
                                    n/a
                                  </div>
                                ) : (
                                  <input type="text" inputMode="decimal"
                                    disabled={!needsHigh}
                                    value={needsHigh ? row.high_pct : ''}
                                    onChange={e => updateAdjustments(p.id, { high_pct: e.target.value })}
                                    placeholder={needsHigh ? '0' : '—'}
                                    className="w-20 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-300" />
                                )}
                              </td>
                              <td className="px-2 py-2 text-xs text-slate-500">{p.unit || '—'}</td>
                              <td className="px-3 py-2 text-right">
                                {(row.source === 'package' || row.source === 'package-adj' || row.dirty) && (
                                  <button onClick={() => resetRow(p.id)}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}
