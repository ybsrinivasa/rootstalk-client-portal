'use client'
import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'
import FilterChips, { ActiveChip } from '@/components/cca/FilterChips'

interface SpProblem {
  cosh_id: string
  name_en: string
  status: string
  existing: { id: string; status: string; version: number } | null
}

interface EligibleCrop {
  crop_cosh_id: string
  name_en: string
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

function SpProblemsContent() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'
  const router = useRouter()
  const params = useSearchParams()
  const cropFilter = params.get('crop') || ''

  const [problems, setProblems] = useState<SpProblem[]>([])
  const [crops, setCrops] = useState<EligibleCrop[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [addError, setAddError] = useState('')

  const cropName = useMemo(
    () => crops.find(c => c.crop_cosh_id === cropFilter)?.name_en || cropFilter,
    [crops, cropFilter],
  )

  useEffect(() => {
    if (!clientId) return
    api.get<EligibleCrop[]>(`/client/${clientId}/cha-sp/eligible-crops`)
      .then(r => setCrops(r.data))
      .catch(() => setCrops([]))
  }, [clientId])

  useEffect(() => {
    if (!clientId || !cropFilter) {
      setProblems([])
      setLoading(false)
      return
    }
    setLoading(true)
    api.get<SpProblem[]>(`/client/${clientId}/cha-sp/specific-problems?crop_cosh_id=${encodeURIComponent(cropFilter)}`)
      .then(r => setProblems(r.data))
      .finally(() => setLoading(false))
  }, [clientId, cropFilter])

  const chips: ActiveChip[] = useMemo(() => {
    if (!cropFilter) return []
    return [{ key: 'crop', label: `Crop: ${cropName}` }]
  }, [cropFilter, cropName])

  async function addToList(p: SpProblem) {
    if (!clientId || !cropFilter) return
    setAdding(p.cosh_id); setAddError('')
    try {
      const { data } = await api.post<{ id: string }>(
        `/client/${clientId}/sp-recommendations`,
        {
          specific_problem_cosh_id: p.cosh_id,
          crop_cosh_id: cropFilter,
        },
      )
      // Take the SE straight to the timeline screen pre-filtered to
      // the new recommendation. The recommendation editor page lands
      // in Round 3; until then, /cha/sp/timelines is the closest
      // useful destination.
      router.push(`/cha/sp/specific-problems/${encodeURIComponent(data.id)}`)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail as { message?: string })?.message
      setAddError(msg || 'Failed to add to list.')
      setAdding(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Specific Problems</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Problems Cosh has linked to the selected crop. Add one to the list to start authoring its
          timelines and practices. Picking a crop is required.
        </p>
      </div>

      <FilterChips chips={chips} />

      {!cropFilter ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🩺</p>
          <p className="text-slate-600 font-medium">Pick a crop first</p>
          <p className="text-slate-400 text-sm mt-1">
            Specific problems are crop-bound. Start at <Link href="/cha/sp/crops" className="text-green-700 hover:underline">CHA · SP Crops</Link>.
          </p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : problems.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-400 text-4xl mb-3">🩺</p>
          <p className="text-slate-600 font-medium">No specific problems for {cropName} yet</p>
          <p className="text-slate-400 text-sm mt-1">
            V1 stopgap list: ~5 problems each for Tomato, Paddy, Onion, Chilli, Cotton. More will arrive when Cosh ships the
            <code className="mx-1 px-1.5 py-0.5 bg-slate-100 rounded font-mono text-[11px]">specific_problem</code> Connect.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Specific Problem</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {problems.map(p => (
                <tr key={p.cosh_id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    {p.existing ? (
                      <Link
                        href={`/cha/sp/specific-problems/${encodeURIComponent(p.existing.id)}`}
                        className="font-medium text-slate-800 hover:text-green-700">
                        {p.name_en}
                      </Link>
                    ) : (
                      <span className="text-slate-700">{p.name_en}</span>
                    )}
                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{p.cosh_id}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    {p.existing ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOUR[p.existing.status]}`}>
                        {p.existing.status} · v{p.existing.version}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">untouched</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {p.existing ? (
                      <Link
                        href={`/cha/sp/specific-problems/${encodeURIComponent(p.existing.id)}`}
                        className="text-xs font-medium text-green-700 hover:text-green-800">
                        Open →
                      </Link>
                    ) : (
                      <button onClick={() => addToList(p)}
                        disabled={adding === p.cosh_id}
                        className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: colour }}>
                        {adding === p.cosh_id ? 'Adding…' : '+ Add to list'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addError && <p className="text-sm text-red-600">{addError}</p>}
    </div>
  )
}

export default function ChaSpProblemsPage() {
  return (
    <Suspense fallback={<div className="text-center py-10 text-slate-400">Loading…</div>}>
      <SpProblemsContent />
    </Suspense>
  )
}
