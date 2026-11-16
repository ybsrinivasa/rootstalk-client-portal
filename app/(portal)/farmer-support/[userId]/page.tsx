'use client'

// Farmer Support — legacy 360° route → redirect stub.
//
// Bundle B (2026-11-16) retired the per-farmer 360° view in favour
// of per-subscription detail pages reached via a collapsible list.
// This page replaces the former 360° so any lingering bookmarks
// (/farmer-support/{userId}) land softly on the list instead of
// 404'ing, with the farmer's row auto-expanded via the
// sessionStorage expansion-state hook on the list page.

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// sessionStorage key must match /farmer-support/page.tsx::EXPANSION_KEY.
const EXPANSION_KEY = 'rt_fs_expanded_v1'

export default function FarmerSupportLegacyRedirect() {
  const router = useRouter()
  const params = useParams<{ userId: string }>()
  const userId = params?.userId

  useEffect(() => {
    if (!userId) return
    // Pre-seed the expansion set so the list page lands with this
    // farmer's row already open. Union with any existing seed so
    // multiple bookmarked redirects don't clobber one another.
    try {
      const raw = sessionStorage.getItem(EXPANSION_KEY)
      const existing = raw ? (JSON.parse(raw) as string[]) : []
      const next = Array.from(new Set([...existing, userId]))
      sessionStorage.setItem(EXPANSION_KEY, JSON.stringify(next))
    } catch { /* quota / parse error — harmless */ }
    router.replace('/farmer-support')
  }, [userId, router])

  return (
    <div className="max-w-xl mx-auto p-10 text-center text-sm text-slate-500">
      Taking you to the new Farmer Support list…
    </div>
  )
}
