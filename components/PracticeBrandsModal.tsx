'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'


// Advisory-Only v1.10 (2026-09-17) — SE / CA view of the filtered
// Cosh brand catalog for a specific practice. Mirror of the SA-portal
// PracticeBrandsModal (separate repo, no shared component library).
// See canonical rationale in that file.


interface BrandRow {
  name: string
  manufacturer: string | null
}

interface BrandsResponse {
  is_locked: boolean
  locked_brand_name: string | null
  brands: BrandRow[]
  practice_common_name?: string | null
  practice_ai_display?: string | null
  practice_formulation_display?: string | null
  practice_combined_display?: string | null
}


function formulationAcronym(name: string): string {
  if (!name) return ''
  const m = name.match(/\(([^)]+)\)\s*$/)
  return (m ? m[1] : name).trim()
}

function shortBrandName(fullName: string): string {
  if (!fullName) return ''
  const idx = fullName.indexOf(' - ')
  return idx > 0 ? fullName.slice(0, idx).trim() : fullName.trim()
}

function composeChemistryLine(data: BrandsResponse): string | null {
  const cn = (data.practice_common_name || '').trim()
  const ai = (data.practice_ai_display || '').trim()
  const fmtRaw = (data.practice_formulation_display || '').trim()
  const combined = (data.practice_combined_display || '').trim()
  const fmt = fmtRaw ? formulationAcronym(fmtRaw) : ''
  if (ai || fmt) {
    const parts: string[] = []
    if (cn) parts.push(cn)
    if (ai) parts.push(`${ai}%`)
    if (fmt) parts.push(fmt)
    return parts.length > 0 ? parts.join(' ') : null
  }
  if (combined) return cn ? `${cn} ${combined}` : combined
  return cn || null
}


export default function PracticeBrandsModal({
  practiceId, onClose,
}: {
  practiceId: string | null
  onClose: () => void
}) {
  const [data, setData] = useState<BrandsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    setLoading(true)
    setError(null)
    setData(null)
    api.get<BrandsResponse>(`/practices/${practiceId}/brands`)
      .then(r => setData(r.data))
      .catch(e => {
        const detail = e?.response?.data?.detail
        setError(
          (typeof detail === 'object' ? detail?.message : detail)
          || 'Could not load brands.',
        )
      })
      .finally(() => setLoading(false))
  }, [practiceId])

  if (!practiceId) return null

  const chemistryLine = data ? composeChemistryLine(data) : null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">
            Brands in the Cosh catalog
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-2">
              <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          ) : !data ? null : (
            <>
              {chemistryLine && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-4">
                  <p className="text-xs text-emerald-700 uppercase tracking-wider font-medium mb-0.5">
                    Chemistry
                  </p>
                  <p className="text-base font-bold text-emerald-900">{chemistryLine}</p>
                </div>
              )}
              {data.brands.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-500">
                  No brands in the Cosh catalog match this chemistry yet.
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                    {data.brands.length} brand{data.brands.length === 1 ? '' : 's'}
                  </p>
                  <div className="border border-slate-100 rounded-lg overflow-hidden">
                    {data.brands.map((b, idx) => (
                      <div key={`${b.name}-${idx}`}
                        className={`px-4 py-2.5 ${idx > 0 ? 'border-t border-slate-50' : ''}`}>
                        <p className="font-medium text-slate-800 text-sm">{shortBrandName(b.name)}</p>
                        {b.manufacturer && (
                          <p className="text-xs text-slate-500 mt-0.5">{b.manufacturer}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
