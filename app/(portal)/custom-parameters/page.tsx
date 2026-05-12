'use client'
import { useState, useEffect } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

interface Parameter {
  id: string; name: string; crop_cosh_id: string; source: string; status: string
  variables: Variable[]
  translations?: Translation[]
}
interface Variable {
  id: string; name: string; status: string
  translations?: Translation[]
}
interface Translation { language_code: string; name: string; status: string }
interface EnabledLanguage { language_code: string; language_name_en: string; status: string }
interface ClientCrop { crop_cosh_id: string; status: string }

export default function CustomParametersPage() {
  const client = getClient()
  const clientId = client?.id

  const [crops, setCrops] = useState<ClientCrop[]>([])
  const [selectedCrop, setSelectedCrop] = useState('')
  const [parameters, setParameters] = useState<Parameter[]>([])
  const [languages, setLanguages] = useState<EnabledLanguage[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedParam, setExpandedParam] = useState<string | null>(null)
  const [expandedTranslation, setExpandedTranslation] = useState<string | null>(null)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newParamName, setNewParamName] = useState('')
  const [newVariables, setNewVariables] = useState(['', ''])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Edit variable
  const [editingVar, setEditingVar] = useState<{ paramId: string; varId: string; text: string } | null>(null)

  useEffect(() => {
    if (!clientId) return
    api.get<EnabledLanguage[]>('/platform/languages').then(r => setLanguages(r.data.filter(l => l.status === 'ACTIVE')))
    api.get<ClientCrop[]>(`/client/${clientId}/crops`).then(r => {
      const active = r.data.filter((c: ClientCrop) => c.status === 'ACTIVE')
      setCrops(active)
      if (active.length > 0) setSelectedCrop(active[0].crop_cosh_id)
    }).catch(() => {})
  }, [clientId])

  useEffect(() => {
    if (!clientId || !selectedCrop) return
    loadParameters()
  }, [clientId, selectedCrop])

  async function loadParameters() {
    if (!clientId || !selectedCrop) return
    setLoading(true)
    try {
      const { data } = await api.get<Parameter[]>(`/client/${clientId}/parameters?crop_cosh_id=${selectedCrop}`)
      const customParams = data.filter(p => p.source === 'CUSTOM')
      // Load variables and translations for each
      const enriched = await Promise.all(customParams.map(async p => {
        const varsRes = await api.get<Variable[]>(`/client/${clientId}/parameters/${p.id}/variables`).catch(() => ({ data: [] }))
        const transRes = await api.get<Translation[]>(`/client/${clientId}/parameters/${p.id}/translations`).catch(() => ({ data: [] }))
        return { ...p, variables: varsRes.data, translations: transRes.data }
      }))
      setParameters(enriched)
    } finally { setLoading(false) }
  }

  async function createParameter() {
    if (!clientId || !newParamName.trim() || !selectedCrop) return
    const validVars = newVariables.filter(v => v.trim())
    if (validVars.length < 2) { setCreateError('At least 2 variables required'); return }
    setCreating(true); setCreateError('')
    try {
      const { data: param } = await api.post(`/client/${clientId}/parameters`, {
        name: newParamName.trim(),
        crop_cosh_id: selectedCrop,
        source: 'CUSTOM',
        display_order: 0,
      })
      for (const v of validVars) {
        await api.post(`/client/${clientId}/parameters/${param.id}/variables`, { name: v.trim() })
      }
      setShowCreate(false)
      setNewParamName('')
      setNewVariables(['', ''])
      loadParameters()
    } catch (err: unknown) {
      setCreateError(extractErrorMessage(err, 'Failed to create parameter'))
    } finally { setCreating(false) }
  }

  async function addVariable(paramId: string, name: string) {
    if (!clientId || !name.trim()) return
    await api.post(`/client/${clientId}/parameters/${paramId}/variables`, { name: name.trim() })
    loadParameters()
  }

  async function saveVariableEdit() {
    if (!editingVar || !clientId) return
    await api.put(`/client/${clientId}/parameters/${editingVar.paramId}/variables/${editingVar.varId}`, { name: editingVar.text })
    setEditingVar(null)
    loadParameters()
  }

  async function toggleVariableStatus(paramId: string, varId: string, current: string) {
    if (!clientId) return
    await api.put(`/client/${clientId}/parameters/${paramId}/variables/${varId}/status`, {
      status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    })
    loadParameters()
  }

  async function toggleParamStatus(paramId: string, current: string) {
    if (!clientId) return
    await api.put(`/client/${clientId}/parameters/${paramId}/status`, {
      status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    })
    loadParameters()
  }

  async function approveTranslation(paramId: string, langCode: string, name: string) {
    if (!clientId) return
    await api.put(`/client/${clientId}/parameters/${paramId}/translations/${langCode}`, { name })
    loadParameters()
  }

  async function approveVariableTranslation(paramId: string, varId: string, langCode: string, name: string) {
    if (!clientId) return
    await api.put(`/client/${clientId}/parameters/${paramId}/variables/${varId}/translations/${langCode}`, { name })
    loadParameters()
  }

  const STATUS_COLOUR: Record<string, string> = { ACTIVE: 'bg-green-100 text-green-700', INACTIVE: 'bg-slate-100 text-slate-500' }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Custom Parameters</h1>
            <p className="text-sm text-gray-500 mt-1">Add guided elimination questions beyond the Cosh-sourced list</p>
          </div>
          <button onClick={() => { setShowCreate(true); setCreateError('') }}
            className="px-4 py-2 bg-green-700 text-white text-sm font-semibold rounded-lg hover:bg-green-800">
            + Add Parameter
          </button>
        </div>

        {/* Crop selector */}
        {crops.length > 1 && (
          <div className="mb-4 flex gap-2 flex-wrap">
            {crops.map(c => (
              <button key={c.crop_cosh_id} onClick={() => setSelectedCrop(c.crop_cosh_id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedCrop === c.crop_cosh_id ? 'bg-green-700 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}>
                {c.crop_cosh_id}
              </button>
            ))}
          </div>
        )}

        {!selectedCrop ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <p className="text-gray-400">No crops assigned to this company yet. Add crops in Setup.</p>
          </div>
        ) : loading ? (
          <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : parameters.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
            <p className="text-3xl mb-3">❓</p>
            <p className="text-gray-500 font-medium">No custom parameters yet for {selectedCrop}</p>
            <p className="text-sm text-gray-400 mt-1">Custom parameters appear in guided elimination alongside Cosh-sourced ones</p>
          </div>
        ) : (
          <div className="space-y-4">
            {parameters.map(param => (
              <div key={param.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Parameter header */}
                <div className="px-5 py-4 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-gray-900">{param.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[param.status]}`}>{param.status}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{param.variables.length} variable{param.variables.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex gap-2 items-center ml-3">
                    <button onClick={() => setExpandedTranslation(expandedTranslation === param.id ? null : param.id)}
                      className="text-xs text-blue-600 font-medium px-2 py-1 rounded-lg hover:bg-blue-50">
                      Translations
                    </button>
                    <button onClick={() => toggleParamStatus(param.id, param.status)}
                      className={`text-xs px-2 py-1 rounded-lg font-medium ${param.status === 'ACTIVE' ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                      {param.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => setExpandedParam(expandedParam === param.id ? null : param.id)}
                      className="text-gray-400 text-lg">{expandedParam === param.id ? '▲' : '▼'}</button>
                  </div>
                </div>

                {/* Variables */}
                {expandedParam === param.id && (
                  <div className="border-t border-gray-50 bg-gray-50 px-5 py-4">
                    <p className="text-xs font-semibold text-gray-500 mb-3">Variables (answer options)</p>
                    <div className="space-y-2">
                      {param.variables.map(v => (
                        <div key={v.id} className="flex items-center gap-2">
                          {editingVar?.varId === v.id ? (
                            <input value={editingVar.text}
                              onChange={e => setEditingVar({ ...editingVar, text: e.target.value })}
                              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white"
                              autoFocus />
                          ) : (
                            <p className={`flex-1 text-sm ${v.status === 'INACTIVE' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                              {v.name}
                            </p>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOUR[v.status]}`}>{v.status}</span>
                          {editingVar?.varId === v.id ? (
                            <>
                              <button onClick={saveVariableEdit} className="text-xs text-green-600 font-medium px-2 py-1 rounded hover:bg-green-50">Save</button>
                              <button onClick={() => setEditingVar(null)} className="text-xs text-gray-400 px-2 py-1 rounded hover:bg-gray-100">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setEditingVar({ paramId: param.id, varId: v.id, text: v.name })}
                                className="text-xs text-blue-500 font-medium px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                              <button onClick={() => toggleVariableStatus(param.id, v.id, v.status)}
                                className={`text-xs px-2 py-1 rounded font-medium ${v.status === 'ACTIVE' ? 'text-red-400 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}>
                                {v.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Add variable */}
                    <AddVariableRow onAdd={(name) => addVariable(param.id, name)} />
                  </div>
                )}

                {/* Translations panel */}
                {expandedTranslation === param.id && (
                  <div className="border-t border-blue-50 bg-blue-50 px-5 py-4">
                    <p className="text-xs font-semibold text-blue-700 mb-3">Parameter Translations</p>
                    {languages.length === 0 ? (
                      <p className="text-xs text-blue-500">No languages enabled. Enable languages in Settings.</p>
                    ) : (
                      <div className="space-y-2">
                        {languages.filter(l => l.language_code !== 'en').map(lang => {
                          const trans = param.translations?.find(t => t.language_code === lang.language_code)
                          return (
                            <TranslationRow
                              key={lang.language_code}
                              languageCode={lang.language_code}
                              languageName={lang.language_name_en}
                              currentText={trans?.name || ''}
                              status={trans?.status || 'PENDING'}
                              onApprove={(text) => approveTranslation(param.id, lang.language_code, text)}
                            />
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create parameter modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Add Custom Parameter</h2>
            <p className="text-xs text-gray-400 mb-4">Will be available across all PoPs for {selectedCrop}</p>
            {createError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{createError}</p>}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Parameter Name *</label>
                <input value={newParamName}
                  onChange={e => setNewParamName(e.target.value)}
                  placeholder="e.g. Soil type, Irrigation method"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Variables (min 2) *</label>
                <div className="space-y-2">
                  {newVariables.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={v}
                        onChange={e => { const arr = [...newVariables]; arr[i] = e.target.value; setNewVariables(arr) }}
                        placeholder={`Option ${i + 1}`}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      {newVariables.length > 2 && (
                        <button onClick={() => setNewVariables(newVariables.filter((_, idx) => idx !== i))}
                          className="text-gray-400 hover:text-red-400 px-2">✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setNewVariables([...newVariables, ''])}
                    className="text-xs text-green-600 font-medium hover:underline">+ Add option</button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={createParameter} disabled={creating || !newParamName.trim()}
                className="flex-1 py-3 bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-green-800">
                {creating ? 'Creating…' : 'Create Parameter'}
              </button>
              <button onClick={() => { setShowCreate(false); setCreateError('') }}
                className="px-5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AddVariableRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  async function submit() {
    if (!text.trim()) return
    setAdding(true)
    try { await onAdd(text.trim()); setText('') } finally { setAdding(false) }
  }
  return (
    <div className="flex gap-2 mt-3">
      <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Add another variable…"
        className="flex-1 border border-dashed border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white" />
      <button onClick={submit} disabled={adding || !text.trim()}
        className="text-xs text-green-700 font-semibold px-3 py-1.5 rounded-lg bg-green-50 hover:bg-green-100 disabled:opacity-40">
        {adding ? '…' : 'Add'}
      </button>
    </div>
  )
}

function TranslationRow({
  languageCode, languageName, currentText, status, onApprove,
}: {
  languageCode: string; languageName: string; currentText: string
  status: string; onApprove: (text: string) => void
}) {
  const [text, setText] = useState(currentText)
  const [saving, setSaving] = useState(false)
  const approved = status === 'EXPERT_VALIDATED'
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs text-blue-700 w-20 font-medium shrink-0">{languageName}</p>
      <input value={text} onChange={e => setText(e.target.value)}
        className="flex-1 border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" />
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${approved ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
        {approved ? '✓' : 'Pending'}
      </span>
      <button onClick={async () => { setSaving(true); try { await onApprove(text) } finally { setSaving(false) } }}
        disabled={saving}
        className="text-xs text-blue-600 font-medium px-2 py-1 rounded hover:bg-blue-100 disabled:opacity-40 shrink-0">
        {saving ? '…' : 'Approve'}
      </button>
    </div>
  )
}
