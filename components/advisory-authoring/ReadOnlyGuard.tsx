'use client'

// 2026-05-21 — Shared read-only guard for the four authoring
// surfaces with the DRAFT → ACTIVE → INACTIVE versioning lifecycle
// (CA-Package, CA-PG, Global-Package, Global-PG). User principle:
//
//   "Don't disable buttons silently — let the user try. When they
//    try, show a friendly caution explaining what they need to do."
//
// The page derives `isReadOnly` from `pkg.status !== 'DRAFT'`,
// imports this hook, wraps every edit-action onClick through
// `tryEdit(action)`, and mounts `<GuardModal />` at page root.
//
// MIRROR FILE — kept verbatim in rootstalk-frontend and rootstalk-
// client-portal per feedback_cross_repo_authoring_modules. Any
// change in one repo needs the sibling mirror commit.

import { useState } from 'react'

interface GuardOptions {
  /** True when the row being viewed is ACTIVE or INACTIVE
   *  (or any non-DRAFT status). False on a fresh DRAFT — edits
   *  pass through untouched. */
  isReadOnly: boolean
  /** What the page calls its clone-to-draft button. The modal
   *  copy quotes this verbatim so the user sees the same words
   *  in the dialog and on the page. Defaults to "+ Start new
   *  edit" (the standardised label across CA + SA portals). */
  ctaLabel?: string
  /** The current row's status label for the explanation line.
   *  E.g. "active", "inactive". Defaults to "published". */
  statusLabel?: string
}

interface GuardReturn {
  /** Wrap every edit-action onClick: `onClick={() => tryEdit(action)}`.
   *  If read-only, opens the caution modal and skips `action`.
   *  If editable, runs `action()` synchronously. */
  tryEdit: (action: () => void) => void
  /** Mount once at page root: `<GuardModal />`. */
  GuardModal: () => React.ReactElement | null
}

export function useReadOnlyGuard({
  isReadOnly,
  ctaLabel = '+ Start new edit',
  statusLabel = 'published',
}: GuardOptions): GuardReturn {
  const [open, setOpen] = useState(false)

  function tryEdit(action: () => void) {
    if (isReadOnly) {
      setOpen(true)
      return
    }
    action()
  }

  function GuardModal() {
    if (!open) return null
    return (
      <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
        onClick={() => setOpen(false)}>
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full"
          onClick={e => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">
              You need to start a new edit first
            </h2>
          </div>
          <div className="px-5 py-4 text-sm text-slate-700 space-y-2">
            <p>
              This version is {statusLabel} — read-only. To make any
              changes (timelines, practices, relations, locations,
              authors, etc.), you must first start a new edit.
            </p>
            <p>
              Tap <span className="font-semibold text-slate-900">{ctaLabel}</span>{' '}
              at the top of the page to begin. A new draft will be
              created from this version; the live one stays untouched
              until you publish the new draft.
            </p>
          </div>
          <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
            <button onClick={() => setOpen(false)}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl">
              Got it
            </button>
          </div>
        </div>
      </div>
    )
  }

  return { tryEdit, GuardModal }
}
