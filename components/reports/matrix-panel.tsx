'use client'

// Nested-row pivot panel used by the two Sales matrices:
//   - Recommended vs Given (rows = our brands, given = what dealers sold)
//   - Common Name → Brand Sold (rows = common names, given = what dealers picked)
//
// Both matrices share the shape { rows: [{label, totals, given: [...]}] }
// where each `given` entry has {label, litres, kilograms, numbers, match?}.
// Renders as an expandable card:
//   Header (always visible): title · N rows · Show/Hide
//   Body (when expanded): per-row block with total + horizontal
//     breakdown of given entries. Each given entry: bar + label + amount.
//
// Match=true (Recommended honored — dealer sold what SE recommended) is
// rendered in the brand accent; substitutions in slate; NULL brand as
// muted "(no brand recorded)".

import { useState } from 'react'
import { ThreeUnitNumber } from './three-unit-number'

export interface MatrixGiven {
  label: string | null    // sold-brand or common-name label; null → "no brand recorded"
  match?: boolean         // true when the sold brand equals the recommended brand
  litres: number
  kilograms: number
  numbers: number
}

export interface MatrixRow {
  label: string
  totals: { litres: number; kilograms: number; numbers: number }
  given: MatrixGiven[]
}

interface MatrixPanelProps {
  title: string
  caption: string
  rows: MatrixRow[]
  loading: boolean
  brandColour: string
  /** Text used when a given entry has no brand recorded. */
  nullLabel?: string
}

function rowTotal(g: { litres: number; kilograms: number; numbers: number }): number {
  return g.litres + g.kilograms + g.numbers
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

export function MatrixPanel({
  title, caption, rows, loading, brandColour,
  nullLabel = '(no brand recorded)',
}: MatrixPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const hasRows = rows.length > 0

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 rounded-2xl"
      >
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            {title}
          </p>
          <p className="text-sm text-slate-500 mt-1">{caption}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <span className="text-xs text-slate-400 tabular-nums">
            {loading ? '…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </span>
          <span className={`text-slate-500 text-lg transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden>
            ▾
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          {loading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : !hasRows ? (
            <p className="text-slate-400 text-sm">No data for the current filters.</p>
          ) : (
            <ul className="space-y-5">
              {rows.map((row, i) => {
                const total = rowTotal(row.totals)
                return (
                  <li key={i} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold text-slate-800 truncate">{row.label}</p>
                      <ThreeUnitNumber
                        litres={row.totals.litres}
                        kilograms={row.totals.kilograms}
                        numbers={row.totals.numbers}
                        colour={brandColour}
                      />
                    </div>
                    <ul className="space-y-1.5 pl-4 border-l border-slate-100">
                      {row.given.map((g, gi) => {
                        const givenTotal = rowTotal(g)
                        const share = pct(givenTotal, total)
                        const barColour = g.match ? brandColour : '#94a3b8'   // slate-400 for substitutes
                        return (
                          <li key={gi} className="flex items-center gap-3 text-sm">
                            <span className={`w-40 truncate ${g.label ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                              {g.label ?? nullLabel}
                              {g.match && <span className="ml-1 text-xs text-slate-400">✓</span>}
                            </span>
                            <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                              <div
                                className="h-full transition-all"
                                style={{ width: `${share}%`, backgroundColor: barColour }}
                              />
                            </div>
                            <span className="w-10 text-right text-xs text-slate-500 tabular-nums">
                              {share}%
                            </span>
                            <span className="w-32 text-right text-xs text-slate-600">
                              <InlineThreeUnit
                                litres={g.litres}
                                kilograms={g.kilograms}
                                numbers={g.numbers}
                              />
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Compact inline version of ThreeUnitNumber — no bold, small font,
// fits inside the matrix breakdown rows.
function InlineThreeUnit({ litres, kilograms, numbers }: { litres: number; kilograms: number; numbers: number }) {
  const parts: string[] = []
  if (litres >= 0.01) parts.push(`${litres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L`)
  if (kilograms >= 0.01) parts.push(`${kilograms.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`)
  if (numbers >= 1) parts.push(`${numbers.toLocaleString()} Nos`)
  if (parts.length === 0) return <span className="text-slate-300">—</span>
  return <>{parts.join(' · ')}</>
}
