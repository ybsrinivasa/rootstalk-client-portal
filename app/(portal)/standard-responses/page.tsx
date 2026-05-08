'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

// Spec §14.9. Subject Experts curate question/answer pairs for the
// company. FarmPundits later browse this library while responding to
// farmer queries (no edit; they layer their own additional guidance
// on top). V1 answer body is text + media; Timelines/Practices
// integration deferred to V1.1 — see audit memory for context.

interface AnswerMediaItem {
  media_type: string
  url: string
  caption?: string
}

interface StandardResponse {
  id: string
  client_id: string
  crop_cosh_id: string | null
  question_text: string
  answer_text: string | null
  answer_media: AnswerMediaItem[]
  created_at: string
  updated_at: string
}

const MEDIA_TYPES: Array<[string, string]> = [
  ['IMAGE', 'Image'],
  ['VIDEO', 'Video'],
  ['AUDIO', 'Audio'],
  ['HYPERLINK', 'Hyperlink'],
]

const CROP_FILTER_ALL = '__ALL__'
const CROP_FILTER_AGNOSTIC = 'AGNOSTIC'

const emptyForm = {
  id: '' as string,
  question_text: '',
  answer_text: '',
  crop_cosh_id: '',
  answer_media: [] as AnswerMediaItem[],
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
      answer_text: item.answer_text || '',
      crop_cosh_id: item.crop_cosh_id || '',
      answer_media: item.answer_media || [],
    })
    setError('')
    setShowForm(true)
  }

  function addMediaRow() {
    setForm(f => ({
      ...f,
      answer_media: [...f.answer_media, { media_type: 'IMAGE', url: '', caption: '' }],
    }))
  }

  function updateMediaRow(idx: number, patch: Partial<AnswerMediaItem>) {
    setForm(f => ({
      ...f,
      answer_media: f.answer_media.map((m, i) => i === idx ? { ...m, ...patch } : m),
    }))
  }

  function removeMediaRow(idx: number) {
    setForm(f => ({
      ...f,
      answer_media: f.answer_media.filter((_, i) => i !== idx),
    }))
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
        answer_text: form.answer_text.trim() || null,
        crop_cosh_id: form.crop_cosh_id.trim() || null,
        // Drop empty rows so the backend's media validation doesn't 422 on them.
        answer_media: form.answer_media.filter(m => m.url.trim()),
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
            Curate question/answer pairs that FarmPundits use when responding to farmer queries.
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
            No entries yet. Add the first standard question + answer to start the library.
          </p>
          <p className="text-slate-400 text-xs mt-2">
            FarmPundits will pick from this library when responding to farmer queries.
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
                  {item.answer_text && (
                    <p className="text-sm text-slate-600 mt-2 leading-relaxed whitespace-pre-wrap">
                      {item.answer_text}
                    </p>
                  )}
                  {item.answer_media && item.answer_media.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {item.answer_media.map((m, i) => (
                        <a key={i} href={m.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg hover:bg-blue-100">
                          {m.media_type} · {m.caption || m.url}
                        </a>
                      ))}
                    </div>
                  )}
                  {!item.answer_text && (!item.answer_media || item.answer_media.length === 0) && (
                    <p className="text-xs text-amber-600 mt-2 italic">
                      ⚠ No answer body yet. FarmPundits will see only the question.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button onClick={() => openEdit(item)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Edit
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                {form.id ? 'Edit standard Q&A' : 'Add standard Q&A'}
              </h2>
              <p className="text-slate-500 text-sm mt-0.5">
                FarmPundits will pick from this library while responding to farmer queries.
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
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Answer (text)</label>
                <textarea value={form.answer_text}
                  onChange={e => setForm(f => ({ ...f, answer_text: e.target.value }))}
                  rows={5}
                  placeholder="The full answer the FarmPundit will forward to the farmer."
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700">Answer attachments (optional)</label>
                  <button type="button" onClick={addMediaRow}
                    className="text-xs text-green-700 hover:text-green-800 font-medium">+ Add</button>
                </div>
                {form.answer_media.length === 0 ? (
                  <p className="text-xs text-slate-400">No attachments yet. Click "+ Add" to attach an image, video, audio, or hyperlink.</p>
                ) : (
                  <div className="space-y-2">
                    {form.answer_media.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={m.media_type}
                          onChange={e => updateMediaRow(idx, { media_type: e.target.value })}
                          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
                          {MEDIA_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <input value={m.url}
                          onChange={e => updateMediaRow(idx, { url: e.target.value })}
                          placeholder="https://…"
                          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono" />
                        <input value={m.caption || ''}
                          onChange={e => updateMediaRow(idx, { caption: e.target.value })}
                          placeholder="Caption (optional)"
                          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
                        <button type="button" onClick={() => removeMediaRow(idx)}
                          className="text-red-400 hover:text-red-600 text-sm w-6">×</button>
                      </div>
                    ))}
                  </div>
                )}
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
