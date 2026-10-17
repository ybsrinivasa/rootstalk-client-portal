'use client'
import { useEffect, useMemo, useState } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import ReportMarkdown from '@/components/soil-nutrient/ReportMarkdown'

type CategoryGroup = 'BASE' | 'PRIMARY' | 'SECONDARY' | 'MICRO' | 'OTHER' | 'RATIO'

type SoilParameter = {
  id: string
  name: string
  unit: string | null
  category_group: CategoryGroup
  display_order: number
}

type Preset = {
  id: string
  name: string
  description: string | null
  values_json: Record<string, number | string>
}

type CcaPackage = {
  id: string
  name: string
  crop_cosh_id: string
  crop_name_en: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
}

type ReportSection = { heading: string; body_md: string }
type Report = {
  is_mock: boolean
  generated_at: string
  client_id: string
  package_id: string
  crop_cosh_id: string
  sections: ReportSection[]
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

type InputMode = 'preset' | 'manual'

function parseFloatOrNull(s: string): number | null {
  if (!s.trim()) return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export default function SoilNutrientMockPage() {
  const client = getClient()
  const clientId = client?.id

  const [parameters, setParameters] = useState<SoilParameter[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [packages, setPackages] = useState<CcaPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [moduleDisabled, setModuleDisabled] = useState(false)

  const [packageId, setPackageId] = useState('')
  const [inputMode, setInputMode] = useState<InputMode>('preset')
  const [presetId, setPresetId] = useState('')
  // Keyed by parameter_id, stored as raw user string so blank stays blank.
  const [manualValues, setManualValues] = useState<Record<string, string>>({})

  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  useEffect(() => { loadAll() }, [clientId])

  async function loadAll() {
    if (!clientId) return
    setLoading(true); setError(null); setModuleDisabled(false)
    try {
      const [p, pr, pk] = await Promise.all([
        api.get(`/client/${clientId}/soil-nutrient/parameters`),
        api.get(`/client/${clientId}/soil-nutrient/preset-profiles`),
        api.get(`/client/${clientId}/cca/packages`),
      ])
      const params = (p.data as SoilParameter[])
        .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
      setParameters(params)
      setPresets(pr.data)
      // Only ACTIVE Packages are meaningful for Mock runs — but keep
      // DRAFT visible so a CA building a new Package can test as they
      // go. INACTIVE hidden by default.
      setPackages((pk.data as CcaPackage[]).filter(p => p.status !== 'INACTIVE'))
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

  const groupedParams = useMemo(() => {
    const out: { group: CategoryGroup; items: SoilParameter[] }[] = []
    for (const g of GROUP_ORDER) {
      const items = parameters.filter(p => p.category_group === g)
      if (items.length) out.push({ group: g, items })
    }
    return out
  }, [parameters])

  function loadFromPreset(preset: Preset) {
    // Preset values_json is keyed by parameter *name* (per the
    // seed shape). Map to parameter_id for the manual-values store so
    // switching to Manual pre-fills from the chosen preset.
    const next: Record<string, string> = {}
    for (const p of parameters) {
      const v = preset.values_json[p.name]
      if (v !== undefined && v !== null) next[p.id] = String(v)
    }
    setManualValues(next)
  }

  function onPresetChange(id: string) {
    setPresetId(id)
    const found = presets.find(p => p.id === id)
    if (found) loadFromPreset(found)
  }

  async function runMock() {
    if (!clientId || !packageId) return
    setRunning(true); setError(null); setReport(null)
    try {
      const payload: Record<string, unknown> = { package_id: packageId }
      if (inputMode === 'preset') {
        if (!presetId) {
          setError('Pick a preset or switch to Manual.')
          setRunning(false)
          return
        }
        payload.preset_id = presetId
      } else {
        const nums: Record<string, number> = {}
        for (const [pid, raw] of Object.entries(manualValues)) {
          const v = parseFloatOrNull(raw)
          if (v !== null) nums[pid] = v
        }
        if (Object.keys(nums).length === 0) {
          setError('Enter at least one soil value or pick a preset.')
          setRunning(false)
          return
        }
        payload.soil_values = nums
      }
      const { data } = await api.post(
        `/client/${clientId}/soil-nutrient/mock/run`, payload,
      )
      setReport(data)
    } catch (e) {
      setError(extractErrorMessage(e, 'Mock run failed'))
    } finally {
      setRunning(false)
    }
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

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            Soil Nutrient Mock
            <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
              Sandbox
            </span>
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Simulate the engine against a hypothetical soil state for one of your Packages.
            Nothing is written to farmer subscriptions.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{error}</p>
      )}

      {loading ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[380px,1fr] gap-6">
          {/* ── Left: input form ── */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Package</label>
                <select value={packageId}
                  onChange={e => setPackageId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">— pick a Package —</option>
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.crop_name_en || p.crop_cosh_id} · v{p.version} ({p.status})
                    </option>
                  ))}
                </select>
                {packages.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">
                    No Packages found. Build one in CCA first.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Soil values</label>
                <div className="flex gap-2 mb-2">
                  <button type="button"
                    onClick={() => setInputMode('preset')}
                    className={`text-xs px-3 py-1.5 rounded border ${inputMode === 'preset' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`}>
                    Preset
                  </button>
                  <button type="button"
                    onClick={() => setInputMode('manual')}
                    className={`text-xs px-3 py-1.5 rounded border ${inputMode === 'manual' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-600'}`}>
                    Manual
                  </button>
                </div>
                {inputMode === 'preset' ? (
                  <>
                    <select value={presetId}
                      onChange={e => onPresetChange(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">— pick a preset —</option>
                      {presets.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {presetId && (() => {
                      const p = presets.find(x => x.id === presetId)
                      return p?.description
                        ? <p className="text-[11px] text-slate-500 mt-1">{p.description}</p>
                        : null
                    })()}
                    {presets.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        No presets configured. Ask your Super Admin to add some, or use Manual.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {groupedParams.map(({ group, items }) => (
                      <div key={group}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                          {GROUP_LABEL[group]}
                        </p>
                        <div className="space-y-1">
                          {items.map(p => (
                            <div key={p.id} className="flex items-center gap-2">
                              <label className="text-xs text-slate-700 flex-1 min-w-0 truncate">{p.name}</label>
                              <input type="text" inputMode="decimal"
                                value={manualValues[p.id] || ''}
                                onChange={e => setManualValues(prev => ({ ...prev, [p.id]: e.target.value }))}
                                placeholder="—"
                                className="w-20 border border-slate-300 rounded px-2 py-1 text-xs font-mono text-right" />
                              {p.unit && <span className="text-[10px] text-slate-400 w-8">{p.unit}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={runMock}
                disabled={running || !packageId}
                className="w-full bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {running ? 'Running…' : report ? 'Re-run' : 'Run Mock'}
              </button>
            </div>

            <div className="text-[11px] text-slate-500 leading-relaxed">
              Mock output is a projection of what the real engine would do.
              Nothing is written to any farmer subscription, no notifications fire.
              The <strong>Rules Applied</strong> section surfaces the per-parameter
              target shifts configured on your <strong>Normal Ranges</strong> page.
            </div>
          </div>

          {/* ── Right: report ── */}
          <div>
            {report ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <div className="flex items-start justify-between mb-4 pb-3 border-b border-slate-100">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Decision Report</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Generated {new Date(report.generated_at).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                    Sandbox
                  </span>
                </div>
                <div className="space-y-4">
                  {report.sections.map((s, i) => (
                    <ReportMarkdown key={i} body={s.body_md} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-10 text-center text-sm text-slate-400">
                Pick a Package and soil values, then click <strong>Run Mock</strong> to see the engine&apos;s six-section Decision Report.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
