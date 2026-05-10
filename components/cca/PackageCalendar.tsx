'use client'
import { useMemo, useState, useEffect } from 'react'

interface Timeline {
  id: string
  name: string
  from_type: 'DBS' | 'DAS' | 'CALENDAR'
  from_value: number
  to_value: number
  display_order: number
}

interface Pkg {
  id: string
  package_type: 'ANNUAL' | 'PERENNIAL'
  duration_days: number
}

interface Props {
  pkg: Pkg
  timelines: Timeline[]
  practiceCounts: Record<string, number>
  onTimelineClick?: (id: string) => void
}

type View = 'combined' | 'dbs' | 'das'

const BAND_COLOURS = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
]

/** Default sowing date to ~1 June of the current year — Kharif window
 * is the most common case in Karnataka, and the SE can change it. */
function defaultStart(): string {
  const today = new Date()
  return `${today.getFullYear()}-06-01`
}

function dayOfYear(date: Date): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const diff = date.getTime() - start.getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface TimelineRange {
  tl: Timeline
  start: number  // days relative to sowing (Day 0)
  end: number
  unmapped?: boolean  // CALENDAR with no start date set
}

function computeRanges(timelines: Timeline[], startISO: string): TimelineRange[] {
  const startDayOfYear = dayOfYear(new Date(startISO + 'T00:00:00Z'))
  return timelines.map(tl => {
    if (tl.from_type === 'DBS') {
      // DBS values are positive "days BEFORE" — flip sign on the
      // sowing-relative axis. From=30, To=0 → -30 to 0.
      return { tl, start: -tl.from_value, end: -tl.to_value }
    }
    if (tl.from_type === 'DAS') {
      return { tl, start: tl.from_value, end: tl.to_value }
    }
    // CALENDAR: treat from/to as day-of-year. Map onto the sowing-
    // relative axis by subtracting startDayOfYear. Result can be
    // negative (calendar date earlier than artificial sowing).
    return {
      tl,
      start: tl.from_value - startDayOfYear,
      end: tl.to_value - startDayOfYear,
    }
  })
}

/** Coverage = fraction of [axisStart, axisEnd] that is covered by ≥1
 * timeline. Returned as [0..1]. */
function computeCoverage(
  ranges: TimelineRange[], axisStart: number, axisEnd: number,
): number {
  if (axisEnd <= axisStart) return 0
  const span = axisEnd - axisStart
  // Build a sorted list of (start, end) pairs clipped to the axis.
  const intervals = ranges
    .map(r => {
      const a = Math.max(r.start, axisStart)
      const b = Math.min(r.end, axisEnd)
      return a < b ? [a, b] as [number, number] : null
    })
    .filter((x): x is [number, number] => x !== null)
    .sort((a, b) => a[0] - b[0])
  // Merge overlaps + sum.
  let covered = 0
  let curA = -Infinity
  let curB = -Infinity
  for (const [a, b] of intervals) {
    if (a > curB) {
      covered += curB - curA > 0 ? curB - curA : 0
      curA = a; curB = b
    } else if (b > curB) {
      curB = b
    }
  }
  covered += curB - curA > 0 ? curB - curA : 0
  return covered / span
}

export default function PackageCalendar({ pkg, timelines, practiceCounts, onTimelineClick }: Props) {
  const [view, setView] = useState<View>('combined')
  const [startDate, setStartDate] = useState<string>(defaultStart())

  // Persist start date per package in localStorage — never sent to backend.
  const lsKey = `cca_pkg_start_date_${pkg.id}`
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(lsKey) : null
    if (saved) setStartDate(saved)
  }, [lsKey])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem(lsKey, startDate)
  }, [lsKey, startDate])

  const ranges = useMemo(() => computeRanges(timelines, startDate), [timelines, startDate])

  const maxDBSDay = useMemo(
    () => Math.max(0, ...ranges.filter(r => r.start < 0).map(r => -r.start)),
    [ranges],
  )

  // Axis bounds depend on view. For Perennial we drop the DBS region
  // (perennials don't have a "before sowing" — they're cyclic).
  const isPerennial = pkg.package_type === 'PERENNIAL'
  const axisStart =
    isPerennial ? 0 :
    view === 'das' ? 0 :
    -maxDBSDay
  const axisEnd =
    isPerennial ? 365 :
    view === 'dbs' ? 0 :
    pkg.duration_days
  const axisSpan = Math.max(1, axisEnd - axisStart)

  const coverage = useMemo(
    () => computeCoverage(ranges, axisStart, axisEnd),
    [ranges, axisStart, axisEnd],
  )

  const xToPct = (day: number) =>
    ((Math.max(axisStart, Math.min(axisEnd, day)) - axisStart) / axisSpan) * 100

  // Show 5 evenly-spaced day labels along the axis.
  const labels = useMemo(() => {
    const step = axisSpan / 4
    return Array.from({ length: 5 }, (_, i) => {
      const day = Math.round(axisStart + step * i)
      return { day, date: addDays(startDate, day) }
    })
  }, [axisStart, axisSpan, startDate])

  const visibleRanges = ranges.filter(r => r.end >= axisStart && r.start <= axisEnd)
  const totalPractices = Object.values(practiceCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">Calendar</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {timelines.length} timeline{timelines.length === 1 ? '' : 's'} · {totalPractices} practice{totalPractices === 1 ? '' : 's'} ·{' '}
            <span className={coverage >= 0.7 ? 'text-emerald-600' : coverage >= 0.4 ? 'text-amber-600' : 'text-rose-500'}>
              {Math.round(coverage * 100)}% of duration covered
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {!isPerennial && (
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {([['combined', 'Combined'], ['dbs', 'DBS only'], ['das', 'DAS only']] as [View, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setView(v)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-1.5 text-slate-500">
            <span>{isPerennial ? 'Year start:' : 'Sowing date:'}</span>
            <input type="date" value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="border border-slate-200 rounded px-2 py-0.5 text-xs" />
          </label>
        </div>
      </div>

      {timelines.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">
          Add timelines to see the calendar take shape.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Coverage strip */}
          <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
            {ranges.map((r, i) => {
              const a = Math.max(r.start, axisStart)
              const b = Math.min(r.end, axisEnd)
              if (a >= b) return null
              return (
                <div key={i}
                  className="absolute top-0 h-full bg-emerald-300/70"
                  style={{ left: `${xToPct(a)}%`, width: `${xToPct(b) - xToPct(a)}%` }} />
              )
            })}
          </div>

          {/* Axis labels */}
          <div className="relative h-5 text-[10px] text-slate-400">
            {labels.map((l, i) => (
              <div key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${xToPct(l.day)}%` }}>
                <span className="font-mono">{l.day >= 0 ? `+${l.day}` : l.day}d</span>
                <span className="text-slate-300 ml-1">{l.date.slice(5)}</span>
              </div>
            ))}
            {/* Day-0 anchor when visible */}
            {axisStart <= 0 && axisEnd >= 0 && (
              <div className="absolute top-0 -translate-x-1/2 text-emerald-600 font-medium"
                style={{ left: `${xToPct(0)}%` }}>
                ↓ sow
              </div>
            )}
          </div>

          {/* Timeline bands */}
          <div className="relative pt-1">
            {/* Day-0 vertical line behind the bands */}
            {axisStart <= 0 && axisEnd >= 0 && (
              <div className="absolute top-0 bottom-0 w-px bg-emerald-400/60 z-0"
                style={{ left: `${xToPct(0)}%` }} />
            )}
            <div className="relative space-y-1.5 z-10">
              {visibleRanges.map((r, i) => {
                const colour = BAND_COLOURS[i % BAND_COLOURS.length]
                const left = xToPct(r.start)
                const width = Math.max(0.5, xToPct(r.end) - xToPct(r.start))
                const practices = practiceCounts[r.tl.id] ?? 0
                return (
                  <div key={r.tl.id} className="relative h-7">
                    <button
                      onClick={() => onTimelineClick?.(r.tl.id)}
                      className={`absolute h-full rounded-md ${colour} text-white text-[11px] font-medium px-2 flex items-center hover:brightness-110 transition`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${r.tl.name} · ${r.tl.from_type} ${r.tl.from_value}→${r.tl.to_value} · ${practices} practice${practices === 1 ? '' : 's'}`}>
                      <span className="truncate">{r.tl.name}</span>
                      {width > 8 && (
                        <span className="ml-2 opacity-75 shrink-0">{practices}p</span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* CALENDAR-mapped notice */}
          {ranges.some(r => r.tl.from_type === 'CALENDAR') && (
            <p className="text-[11px] text-slate-400 mt-2 italic">
              Calendar-typed timelines are positioned relative to the {isPerennial ? 'year start' : 'sowing date'} above.
              Change the date to see them shift.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
