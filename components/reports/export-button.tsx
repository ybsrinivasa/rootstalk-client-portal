'use client'

// Reusable CSV export button for Reports drill pages. Visible only
// to CA + CM(EDIT) accounts; REPORT_USER-only accounts don't see it.
// Server-side gate (_assert_ca_for_export) is the authoritative
// check — this button is the UX complement to hide the click that
// would 403 anyway.
//
// Download path: axios blob GET (so localStorage Bearer token
// travels), then a temp Object URL + programmatic <a> click.
// Server sends filename via Content-Disposition; we fall back to a
// computed name if the header is stripped.

import { useState } from 'react'
import api from '@/lib/api'
import { getUser, hasPortalRole, CPUser } from '@/lib/auth'
import { extractErrorMessage } from '@/lib/errors'

function canExport(user: CPUser | null): boolean {
  if (!user) return false
  if (hasPortalRole(user, 'CA')) return true
  if (user.is_cm_for_this_client) return true
  return false
}

function filenameFromContentDisposition(header: string | undefined): string | null {
  if (!header) return null
  const match = /filename="?([^";]+)"?/i.exec(header)
  return match ? match[1] : null
}

interface ExportButtonProps {
  /** Full path with query string (e.g. `/client/abc/reports/orders/export.csv?crop=xyz`). */
  href: string
  /** Fallback filename if the server doesn't send Content-Disposition. */
  fallbackFilename: string
}

export function ExportCsvButton({ href, fallbackFilename }: ExportButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!canExport(getUser())) return null

  async function onClick() {
    setBusy(true); setError('')
    try {
      const res = await api.get<Blob>(href, { responseType: 'blob' })
      const filename = filenameFromContentDisposition(
        res.headers['content-disposition'] as string | undefined,
      ) ?? fallbackFilename
      const blobUrl = URL.createObjectURL(
        new Blob([res.data], { type: 'text/csv' }),
      )
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not export CSV.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:border-slate-400 disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3M12 4v6" />
        </svg>
        {busy ? 'Exporting…' : 'Export CSV'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
