'use client'

// Batch 39P-d (2026-05-16) — shared lineage UI for the UCAT publish
// lifecycle:
//
//   • `<ReadOnlyBanner>` — amber banner on ACTIVE / INACTIVE rows
//     directing the CM to clone-to-draft (or continue an existing
//     DRAFT in the same lineage).
//
//   • `<VersionHistorySection>` — disclosure panel listing every row
//     in the lineage. "Open draft →" links the existing DRAFT row;
//     "View →" navigates to ACTIVE / INACTIVE; "Make editable" on
//     INACTIVE rows kicks a fresh clone-to-draft from that historical
//     content.
//
// Both mounted by CCA Global Package + CHA-PG Global today; future
// pipes (SP, Q&A) plug in once their lifecycle endpoints land.

import Link from 'next/link'
import type { ReactNode } from 'react'

export interface LineageRow {
  id: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  version: number
  is_current: boolean
}

const STATUS_COLOUR: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
}

// ── Read-only banner ──────────────────────────────────────────────────

interface BannerProps {
  /** Status of the row being viewed. Banner renders only when
   *  status !== 'DRAFT'. */
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'
  currentVersion: number
  /** Version number that a fresh draft would carry on first publish.
   *  Caller computes this from lineage (max version across active
   *  rows + 1; first publish stays at 1). */
  nextVersion: number
  /** When non-null, the lineage already contains a DRAFT — the CTA
   *  becomes "Continue v{N} draft →" linking to it. */
  existingDraft: LineageRow | null
  /** Where Continue-draft should navigate. Caller builds via
   *  `parentDetailUrl(ctx)`. */
  continueDraftHref: (draft: LineageRow) => string
  cloning: boolean
  cloneError: string
  onCloneToDraft: () => void
}

export function ReadOnlyBanner({
  status, currentVersion, nextVersion, existingDraft,
  continueDraftHref, cloning, cloneError, onCloneToDraft,
}: BannerProps) {
  if (status === 'DRAFT') return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          {status === 'ACTIVE'
            ? `v${currentVersion} is the published version — read-only.`
            : `v${currentVersion} is a previous (INACTIVE) version — read-only.`}
        </p>
        <p className="text-xs text-amber-800 mt-0.5">
          To make changes, start a new draft from this version.
          {existingDraft && (
            <> A v{existingDraft.version} DRAFT already exists in this lineage —
            you can continue that draft, or start a fresh draft from this
            version (which replaces the existing draft).</>
          )}
        </p>
        {cloneError && <p className="text-xs text-red-600 mt-1">{cloneError}</p>}
      </div>
      <div className="flex flex-col gap-2 shrink-0 items-end">
        {/* Primary CTA: always Start-fresh-draft from THIS version. When
            a sibling DRAFT exists, the page-side handler asks the user
            to confirm that the existing draft will become INACTIVE. */}
        <button onClick={onCloneToDraft} disabled={cloning}
          className="bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-amber-700 disabled:opacity-50">
          {cloning ? 'Starting…' : `Start fresh v${nextVersion} draft`}
        </button>
        {existingDraft && (
          <Link href={continueDraftHref(existingDraft)}
            className="text-xs font-medium text-amber-800 hover:underline">
            or continue v{existingDraft.version} draft →
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Version history section ───────────────────────────────────────────

interface VersionHistoryProps {
  lineage: LineageRow[]
  /** Builds the URL for any row in the lineage. */
  rowDetailUrl: (row: LineageRow) => string
  makingEditable: string | null
  onMakeEditable: (rowId: string, version: number) => void
  /** Caption next to each row's published_at when available. PG rows
   *  don't carry published_at; CCA Packages do. Returns ReactNode to
   *  let callers render dates or just blank. */
  publishedAtChip?: (row: LineageRow) => ReactNode
  /** Optional version-label override. Callers can use this to display
   *  DRAFT rows as "v(N+1)" — the version the draft will carry on
   *  publish — so a list of "DRAFT v1 / ACTIVE v1" reads cleanly as
   *  "v2 (draft) / v1" instead. Defaults to `v{row.version}`. */
  versionLabel?: (row: LineageRow) => string
}

export function VersionHistorySection({
  lineage, rowDetailUrl, makingEditable, onMakeEditable,
  publishedAtChip, versionLabel,
}: VersionHistoryProps) {
  if (lineage.length <= 1) return null
  const label = versionLabel || ((r: LineageRow) => `v${r.version}`)
  return (
    <details className="bg-white border border-slate-200 rounded-2xl">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 rounded-2xl">
        📜 Version history ({lineage.length} versions)
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {lineage.map(row => (
          <li key={row.id} className="px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
            <span className="font-semibold text-slate-900 min-w-[2.5rem]">{label(row)}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOUR[row.status] || 'bg-slate-100 text-slate-600'}`}>
              {row.status}
            </span>
            {publishedAtChip && publishedAtChip(row)}
            {row.is_current && (
              <span className="text-xs text-slate-500 italic">(viewing)</span>
            )}
            <div className="ml-auto flex items-center gap-3">
              {!row.is_current && (
                <Link href={rowDetailUrl(row)}
                  className="text-xs text-blue-600 hover:underline">
                  {row.status === 'DRAFT' ? 'Open draft →' : 'View →'}
                </Link>
              )}
              {!row.is_current && row.status === 'INACTIVE' && (
                <button onClick={() => onMakeEditable(row.id, row.version)}
                  disabled={makingEditable !== null}
                  className="text-xs font-semibold text-amber-700 hover:underline disabled:opacity-50">
                  {makingEditable === row.id ? 'Working…' : 'Make editable'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
