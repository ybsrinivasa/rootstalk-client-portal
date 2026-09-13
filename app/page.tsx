'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getToken, setClient, CPClient, CPUserWithClient } from '@/lib/auth'
import { COACH_VIEW_FLAG } from '@/lib/tokenStore'

export default function Root() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Coach-view handoff (2026-09-12). The SA portal's View button
    // opens `${portal}/#coach_view_token=<jwt>` in a new tab. Detect
    // the fragment here, store the token in sessionStorage (isolated
    // to this tab, cannot bleed into the coach's own portal tab),
    // fetch /auth/me + branding to populate the rest of the coach-
    // view store, then land on /dashboard. Fragment is stripped
    // from the URL so a copy/paste of the address bar can't leak
    // the token.
    const hash = window.location.hash
    const match = hash.match(/coach_view_token=([^&]+)/)
    if (match) {
      const token = decodeURIComponent(match[1])
      // Wipe any prior coach-view state before rebinding — a stale
      // student's data must not survive into a new view.
      sessionStorage.setItem(COACH_VIEW_FLAG, '1')
      sessionStorage.setItem('rt_cp_token', token)
      sessionStorage.removeItem('rt_cp_user')
      sessionStorage.removeItem('rt_cp_client')
      // Clear the fragment from the address bar.
      window.history.replaceState(null, '', window.location.pathname + window.location.search)

      ;(async () => {
        try {
          const me = (await api.get<CPUserWithClient>('/auth/me')).data
          sessionStorage.setItem('rt_cp_user', JSON.stringify(me))
          if (me.client_id && me.client_short_name) {
            // Best-effort branding fetch — the endpoint is public, so
            // the coach-view token isn't required, but no harm sending
            // it. Fall back to a minimal CPClient on failure so the
            // dashboard still renders (short_name / id are the load-
            // bearing fields).
            let branding: CPClient | null = null
            try {
              const b = await api.get<CPClient>(`/portal/${me.client_short_name.toLowerCase()}/branding`)
              branding = b.data
            } catch { /* fall through to minimal */ }
            const authoritative: CPClient = branding
              ? { ...branding, id: me.client_id, short_name: me.client_short_name }
              : {
                  id: me.client_id,
                  short_name: me.client_short_name,
                  display_name: me.client_short_name,
                  primary_colour: '#1A5C2A',
                  logo_url: null,
                  tagline: null,
                  org_type_cosh_ids: [],
                }
            setClient(authoritative)
          }
          router.replace('/dashboard')
        } catch {
          setError('This coach-view link has expired. Return to the coaching session and click View again.')
          // Clean up the aborted handoff so the tab doesn't get
          // stuck in a half-authed coach-view state.
          sessionStorage.removeItem('rt_cp_token')
          sessionStorage.removeItem('rt_cp_coach_view')
        }
      })()
      return
    }

    if (getToken()) router.replace('/dashboard')
    else router.replace('/login')
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-amber-900 font-medium mb-2">Coach-view link expired</p>
          <p className="text-amber-800 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
