'use client'
import { useEffect, useState, FormEvent } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

// Spec §14.9 — UCAT pipe-3. Subject Experts curate question-rooted
// advisories; FarmPundits pick a question while responding to a
// farmer query, and the matched advisory's Timelines (with their
// full Practice → Element scaffold) merge into the farmer's
// advisory just like a CHA recommendation.
//
// Sub-batch 1 (this batch) ships the question/crop CRUD only. The
// Timeline + Practice editor lands in Sub-batch 3 — until then,
// each entry shows an "Edit advisory" placeholder where the editor
// will live. The backend `pg_timelines` table is already
// polymorphic (commit 4b8e2c1a93f5) so the editor will write into
// it the same way the CHA editor writes PG timelines.

interface StandardResponse {
  id: string
  client_id: string
  crop_cosh_id: string | null
  question_text: string
  created_at: string
  updated_at: string
}

const CROP_FILTER_ALL = '__ALL__'
const CROP_FILTER_AGNOSTIC = 'AGNOSTIC'

const emptyForm = {
  id: '' as string,
  question_text: '',
  crop_cosh_id: '',
}

export default function StandardResponsesPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [items, setItems] = useState<StandardResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cropFilter, setCropFilter] = useState<string>(CROP_FILTER_ALL)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<typeof emptyForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.append('search', search)
      if (cropFilter && cropFilter !== CROP_FILTER_ALL) params.append('crop_cosh_id', cropFilter)
      const { data } = await api.get<StandardResponse[]>(
        `/client/${clientId}/standard-responses?${params}`,
      )
      setItems(data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [clientId, cropFilter])

  function openCreate() {
    setForm(emptyForm)
    setError('')
    setShowForm(true)
  }

  function openEdit(item: StandardResponse) {
    setForm({
      id: item.id,
      question_text: item.question_text,
      crop_cosh_id: item.crop_cosh_id || '',
    })
    setError('')
    setShowForm(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form.question_text.trim()) {
      setError('Question is required.')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        question_text: form.question_text.trim(),
        crop_cosh_id: form.crop_cosh_id.trim() || null,
      }
      if (form.id) {
        await api.put(`/client/${clientId}/standard-responses/${form.id}`, payload)
      } else {
        await api.post(`/client/${clientId}/standard-responses`, payload)
      }
      setShowForm(false)
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to save.')
    } finally { setSaving(false) }
  }

  async function remove(item: StandardResponse) {
    const preview = item.question_text.length > 60
      ? item.question_text.slice(0, 60) + '…'
      : item.question_text
    if (!confirm(`Delete "${preview}"? This cannot be undone.`)) return
    await api.delete(`/client/${clientId}/standard-responses/${item.id}`)
    load()
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Standard Q&amp;A Library</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Curate question-rooted advisories. FarmPundits pick from this library when responding to farmer queries; the advisory's Timelines merge into the farmer's plan just like a CHA recommendation.
          </p>
        </div>
        <button onClick={openCreate}
          className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
          style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
          + Add Q&amp;A
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load() }}
          placeholder="Search questions…"
          className="flex-1 min-w-[200px] border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        <select value={cropFilter}
          onChange={e => setCropFilter(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none">
          <option value={CROP_FILTER_ALL}>All entries</option>
          <option value={CROP_FILTER_AGNOSTIC}>Crop-agnostic only</option>
        </select>
        <button onClick={load}
          className="px-4 py-2 text-sm border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50">
          Search
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">
            No entries yet. Add the first standard question + crop scope to start the library.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800">{item.question_text}</p>
                  {item.crop_cosh_id ? (
                    <span className="inline-block mt-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-mono">
                      {item.crop_cosh_id}
                    </span>
                  ) : (
                    <span className="inline-block mt-1 text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      Crop-agnostic
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Link href={`/standard-responses/${item.id}`}
                    className="text-xs px-2.5 py-1 rounded-lg text-white text-center font-medium hover:opacity-90"
                    style={{ background: colour }}>
                    Edit advisory →
                  </Link>
                  <button onClick={() => openEdit(item)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Rename
                  </button>
                  <button onClick={() => remove(item)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                {form.id ? 'Edit standard Q&A' : 'Add standard Q&A'}
              </h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Curate the question and crop scope. Timelines for the advisory will be added in the next release.
              </p>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Question <span className="text-red-500">*</span>
                </label>
                <textarea value={form.question_text}
                  onChange={e => setForm(f => ({ ...f, question_text: e.target.value }))}
                  required rows={2}
                  placeholder="e.g. Why are leaves yellowing on young paddy?"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Crop (Cosh ID)</label>
                <input value={form.crop_cosh_id}
                  onChange={e => setForm(f => ({ ...f, crop_cosh_id: e.target.value }))}
                  placeholder="crop:paddy — leave empty for crop-agnostic"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono" />
                <p className="text-xs text-slate-400 mt-1">Leave empty for crop-agnostic entries (apply to any crop).</p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
