'use client'
import { useEffect, useState, useMemo, Suspense, FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

type SRStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

interface QaSr {
  id: string
  question_text: string
  crop_cosh_id: string | null
  crop_name_en: string | null
  status: SRStatus
  timeline_count: number
  created_at: string
  updated_at: string
}

interface QaCrop {
  crop_cosh_id: string
  name_en: string
}

const STATUS_CHIP: Record<SRStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-green-50 text-green-700',
  INACTIVE: 'bg-amber-50 text-amber-700',
}

function QaSrsContent() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'
  const router = useRouter()
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''

  const [srs, setSrs] = useState<QaSr[]>([])
  const [crops, setCrops] = useState<QaCrop[]>([])
  const [loading, setLoading] = useState(true)

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [questionText, setQuestionText] = useState('')

  const cropName = useMemo(() => {
    if (cropFilter === '__AGNOSTIC__') return 'Common to all crops'
    return crops.find(c => c.crop_cosh_id === cropFilter)?.name_en || cropFilter
  }, [cropFilter, crops])

  const load = async () => {
    if (!clientId) return
    setLoading(true)
    const qs = new URLSearchParams()
    if (cropFilter) qs.set('crop_cosh_id', cropFilter)
    try {
      const [{ data: srData }, { data: cropData }] = await Promise.all([
        api.get<QaSr[]>(`/client/${clientId}/qa/standard-responses?${qs.toString()}`),
        api.get<QaCrop[]>(`/client/${clientId}/qa/eligible-crops`),
      ])
      setSrs(srData)
      setCrops(cropData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [clientId, cropFilter])

  const chips: ActiveChip[] = useMemo(() => {
    if (!cropFilter) return []
    return [{ key: 'crop', label: `Crop: ${cropName}` }]
  }, [cropFilter, cropName])

  const openCreate = () => {
    setQuestionText('')
    setCreateError('')
    setShowCreate(true)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!clientId || !cropFilter) return
    setCreating(true); setCreateError('')
    try {
      const body = {
        question_text: questionText.trim(),
        crop_cosh_id: cropFilter === '__AGNOSTIC__' ? null : cropFilter,
      }
      const { data } = await api.post<{ id: string }>(
        `/client/${clientId}/standard-responses`, body,
      )
      setShowCreate(false)
      router.push(`/standard-responses/${data.id}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setCreateError(msg || 'Failed to create standard response.')
    } finally { setCreating(false) }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Q&amp;A · Standard Responses</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Question library — Pundits pick from this when answering farmer queries. Each question
            anchors a Timeline + Practice tree the farmer&apos;s advisory merges in.
          </p>
        </div>
        {cropFilter ? (
          <button onClick={openCreate}
            className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            + New Question
          </button>
        ) : (
          <Link href="/qa/crops"
            className="text-sm font-semibold px-4 py-2.5 rounded-xl border"
            style={{ borderColor: colour, color: colour }}>
            Pick a crop to add →
          </Link>
        )}
      </div>

      <FilterChips chips={chips} />

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : srs.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">❓</p>
          <p className="text-slate-600 font-medium">
            {chips.length > 0 ? 'No questions for this filter yet.' : 'No standard responses yet.'}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            Pick a <Link href="/qa/crops" className="text-green-700 hover:underline">crop</Link> to start authoring questions.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Question</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Crop</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Timelines</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Last edited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {srs.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <Link href={`/standard-responses/${s.id}`}
                      className="font-medium text-slate-800 hover:text-green-700">
                      {s.question_text}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${STATUS_CHIP[s.status] || STATUS_CHIP.DRAFT}`}>
                      {s.status?.toLowerCase() || 'draft'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 text-xs">
                    {s.crop_name_en || (s.crop_cosh_id ? s.crop_cosh_id : (
                      <span className="text-amber-700/80 italic">Common to all crops</span>
                    ))}
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600 hidden md:table-cell text-xs">
                    <Link href={`/qa/timelines?sr=${encodeURIComponent(s.id)}`}
                      className="hover:text-green-700">
                      {s.timeline_count}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-400 hidden lg:table-cell text-xs">
                    {new Date(s.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && cropFilter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">New Standard Response</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Type the farmer-facing question. You&apos;ll add Timelines + Practices on the next screen.
              </p>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Crop</label>
                <div className="px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700">
                  {cropName}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Question</label>
                <textarea value={questionText}
                  onChange={e => setQuestionText(e.target.value)}
                  required rows={2}
                  placeholder="e.g. When should I irrigate after sowing?"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              {createError && <p className="text-sm text-red-600">{createError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button"
                  onClick={() => { setShowCreate(false); setCreateError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={creating || !questionText.trim()}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default function QaSrsPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <QaSrsContent />
    </Suspense>
  )
}
