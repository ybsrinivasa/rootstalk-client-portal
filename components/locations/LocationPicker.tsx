'use client'
// Shared state-grouped tri-state location picker (2026-05-17).
//
// Built for two mount sites:
//   - Setup → Locations tab (universe = full Cosh India list).
//   - Package detail → Edit Locations modal (universe = the
//     company's ClientLocation footprint).
//
// Pure component — parent owns `selected` and decides what to do on
// save. No API calls inside.

import { useMemo, useRef, useState, useEffect } from 'react'

export interface DistrictOption {
  cosh_id: string
  name: string | null
}

export interface StateOption {
  cosh_id: string
  name: string | null
  districts: DistrictOption[]
}

export interface LocationUniverse {
  states: StateOption[]
}

interface LocationPickerProps {
  universe: LocationUniverse
  selected: Set<string>            // composite keys: `${state}::${district}`
  onChange: (next: Set<string>) => void
  emptyMessage?: string
  accentColour?: string
}

export function pairKey(stateId: string, districtId: string): string {
  return `${stateId}::${districtId}`
}

export function unpairKey(key: string): { state_cosh_id: string; district_cosh_id: string } {
  const [s, d] = key.split('::')
  return { state_cosh_id: s, district_cosh_id: d }
}

function displayName(name: string | null): string {
  if (name && name.trim()) return name
  return '(unnamed)'
}

function TriStateCheckbox({
  state, onChange, ariaLabel,
}: {
  state: 'none' | 'some' | 'all'
  onChange: (next: boolean) => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <input ref={ref} type="checkbox"
      aria-label={ariaLabel}
      checked={state === 'all'}
      onChange={e => onChange(e.target.checked)}
      className="w-4 h-4 cursor-pointer" />
  )
}

export function LocationPicker({
  universe, selected, onChange, emptyMessage, accentColour,
}: LocationPickerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return universe.states
    return universe.states
      .map(s => {
        const stateMatches = (s.name || '').toLowerCase().includes(q)
        const matchingDistricts = stateMatches
          ? s.districts
          : s.districts.filter(d => (d.name || '').toLowerCase().includes(q))
        if (!stateMatches && matchingDistricts.length === 0) return null
        return { ...s, districts: matchingDistricts }
      })
      .filter(Boolean) as StateOption[]
  }, [universe.states, query])

  const totalDistrictsInUniverse = useMemo(
    () => universe.states.reduce((sum, s) => sum + s.districts.length, 0),
    [universe.states],
  )

  function stateSelectionShape(s: StateOption): 'none' | 'some' | 'all' {
    let on = 0
    for (const d of s.districts) {
      if (selected.has(pairKey(s.cosh_id, d.cosh_id))) on++
    }
    if (on === 0) return 'none'
    if (on === s.districts.length) return 'all'
    return 'some'
  }

  function toggleState(s: StateOption, on: boolean) {
    const next = new Set(selected)
    for (const d of s.districts) {
      const k = pairKey(s.cosh_id, d.cosh_id)
      if (on) next.add(k); else next.delete(k)
    }
    onChange(next)
  }

  function toggleDistrict(s: StateOption, d: DistrictOption) {
    const next = new Set(selected)
    const k = pairKey(s.cosh_id, d.cosh_id)
    if (next.has(k)) next.delete(k); else next.add(k)
    onChange(next)
  }

  function selectAllFiltered() {
    const next = new Set(selected)
    for (const s of filtered) for (const d of s.districts) {
      next.add(pairKey(s.cosh_id, d.cosh_id))
    }
    onChange(next)
  }

  function clearAllFiltered() {
    const next = new Set(selected)
    for (const s of filtered) for (const d of s.districts) {
      next.delete(pairKey(s.cosh_id, d.cosh_id))
    }
    onChange(next)
  }

  function toggleExpanded(stateId: string) {
    const next = new Set(expanded)
    if (next.has(stateId)) next.delete(stateId); else next.add(stateId)
    setExpanded(next)
  }

  if (universe.states.length === 0) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-8 text-center">
        <p className="text-sm text-slate-500">{emptyMessage || 'No locations available to pick from.'}</p>
      </div>
    )
  }

  const colour = accentColour || '#1A5C2A'
  const inViewLabel = query ? 'in view' : 'across India'

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search state or district…"
          className="flex-1 min-w-[200px] border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
        <button type="button" onClick={selectAllFiltered}
          className="text-xs font-medium px-3 py-2 rounded-xl border"
          style={{ borderColor: colour, color: colour }}>
          Select all {inViewLabel}
        </button>
        <button type="button" onClick={clearAllFiltered}
          className="text-xs font-medium px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
          Clear {inViewLabel}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        <strong>{selected.size}</strong> selected · universe has {totalDistrictsInUniverse} district{totalDistrictsInUniverse === 1 ? '' : 's'} across {universe.states.length} state{universe.states.length === 1 ? '' : 's'}
      </p>

      {/* State list */}
      <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-6">No matches for &ldquo;{query}&rdquo;.</p>
        ) : (
          filtered.map(s => {
            const shape = stateSelectionShape(s)
            const isOpen = expanded.has(s.cosh_id)
            const onCount = s.districts.filter(d => selected.has(pairKey(s.cosh_id, d.cosh_id))).length
            return (
              <div key={s.cosh_id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <TriStateCheckbox
                    state={shape}
                    onChange={on => toggleState(s, on)}
                    ariaLabel={`Select all districts in ${displayName(s.name)}`} />
                  <button type="button"
                    onClick={() => toggleExpanded(s.cosh_id)}
                    className="flex-1 flex items-center justify-between text-left">
                    <span className="text-sm font-medium text-slate-800">
                      {displayName(s.name)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {onCount} / {s.districts.length} · {isOpen ? '▾' : '▸'}
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div className="pl-10 pr-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {s.districts.map(d => {
                      const k = pairKey(s.cosh_id, d.cosh_id)
                      const on = selected.has(k)
                      return (
                        <label key={d.cosh_id}
                          className="flex items-center gap-2 text-sm text-slate-700 py-1 cursor-pointer hover:text-slate-900">
                          <input type="checkbox" checked={on}
                            onChange={() => toggleDistrict(s, d)}
                            className="w-4 h-4 cursor-pointer" />
                          <span>{displayName(d.name)}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
