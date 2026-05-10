'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export interface ActiveChip {
  key: string          // URL query-param key
  label: string        // Human label, e.g. "Crop: Tomato"
}

/** Filter-chip strip for CCA hub screens. Each chip removes its query
 * param without disturbing the others. The URL params are the source
 * of truth — when the user navigates away and back, chips persist. */
export default function FilterChips({ chips }: { chips: ActiveChip[] }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()

  if (chips.length === 0) return null

  const removeChip = (key: string) => {
    const next = new URLSearchParams(params.toString())
    next.delete(key)
    const qs = next.toString()
    router.push(qs ? `${path}?${qs}` : path)
  }

  const clearAll = () => router.push(path)

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {chips.map(c => (
        <button key={c.key} onClick={() => removeChip(c.key)}
          className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors">
          <span>{c.label}</span>
          <span className="text-slate-400 group-hover:text-slate-600">×</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button onClick={clearAll}
          className="text-xs text-slate-500 hover:text-slate-700 underline ml-2">
          clear all
        </button>
      )}
    </div>
  )
}
