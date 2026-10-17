'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

type TemplateRow = {
  id: string
  parameter_id: string
  operator: 'RANGE' | 'UPPER_BOUND' | 'LOWER_BOUND'
  low_value: number | null
  high_value: number | null
}

type Template = {
  id: string
  client_id: string
  name: string
  description: string | null
  status: 'ACTIVE' | 'INACTIVE'
  created_at: string
  updated_at: string
  rows: TemplateRow[]
}

export default function SoilRangeTemplatesPage() {
  const client = getClient()
  const clientId = client?.id

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [clientId, includeInactive])

  async function load() {
    if (!clientId) return
    setLoading(true); setError(null); setModuleDisabled(false)
    try {
      const { data } = await api.get(
        `/client/${clientId}/soil-nutrient/templates`,
        { params: { include_inactive: includeInactive } },
      )
      setTemplates(data)
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

  async function createTemplate() {
    if (!clientId || !newName.trim()) return
    setCreating(true); setError(null)
    try {
      await api.post(`/client/${clientId}/soil-nutrient/templates`, {
        name: newName.trim(),
        description: newDescription.trim() || null,
      })
      setShowCreate(false)
      setNewName(''); setNewDescription('')
      load()
    } catch (e) {
      setError(extractErrorMessage(e, 'Create failed'))
    } finally {
      setCreating(false)
    }
  }

  async function deactivate(t: Template) {
    if (!clientId) return
    if (!confirm(`Deactivate "${t.name}"? Packages pointing at it stop being classified until you repoint them.`)) return
    await api.delete(`/client/${clientId}/soil-nutrient/templates/${t.id}`)
    load()
  }

  async function reactivate(t: Template) {
    if (!clientId) return
    await api.patch(`/client/${clientId}/soil-nutrient/templates/${t.id}`, { status: 'ACTIVE' })
    load()
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
          <h1 className="text-2xl font-bold text-slate-900">Soil Range Templates</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Geography-based templates ("Dharwad red", "Belgaum black cotton"…).
            Each Package picks one template; the engine classifies soil values against it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={includeInactive}
              onChange={e => setIncludeInactive(e.target.checked)}
              className="rounded border-slate-300" />
            Show inactive
          </label>
          <button onClick={() => { setShowCreate(true); setError(null) }}
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700">
            + New Template
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{error}</p>
      )}

      {loading ? (
        <p className="text-center py-12 text-slate-400">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">No templates yet.</p>
          <p className="text-xs mt-1">Click <strong>+ New Template</strong> to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {templates.map(t => {
            const rowCount = t.rows.length
            return (
              <div key={t.id}
                className={`flex items-start justify-between px-5 py-3.5 border-b border-slate-100 last:border-0 ${t.status !== 'ACTIVE' ? 'bg-slate-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <p className="font-medium text-slate-800 text-sm">
                      {t.name}
                      {t.status !== 'ACTIVE' && (
                        <span className="ml-2 text-xs text-slate-400 italic">(inactive)</span>
                      )}
                    </p>
                    <span className="text-[11px] text-slate-500">
                      {rowCount} parameter{rowCount === 1 ? '' : 's'} authored
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <Link href={`/soil-nutrient/soil-range-templates/${t.id}`}
                    className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 hover:border-slate-300">
                    Edit
                  </Link>
                  {t.status === 'ACTIVE' ? (
                    <button onClick={() => deactivate(t)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:border-red-300">
                      Deactivate
                    </button>
                  ) : (
                    <button onClick={() => reactivate(t)}
                      className="text-xs text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded border border-emerald-200 hover:border-emerald-300">
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => !creating && setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold">New Soil Range Template</h2>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Name</label>
                <input type="text" value={newName} autoFocus
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g., Dharwad red soil"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Description <span className="text-slate-400">(optional)</span>
                </label>
                <textarea value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  rows={2}
                  placeholder="Short note about where this applies"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
              <button onClick={() => setShowCreate(false)} disabled={creating}
                className="text-sm text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={createTemplate}
                disabled={creating || !newName.trim()}
                className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
