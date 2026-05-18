'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { CPClient, setClient, CPUser } from '@/lib/auth'

// CM SSO entry point (Batch Q, 2026-05-18). The SA Portal's
// /admin/cm/clients/{cid}/login-as endpoint returns a JWT bound to
// the target client. The SA-Portal "Open Client Portal ↗" button
// opens this route with the token + short_name in the URL FRAGMENT
// (not query — fragments don't appear in nginx access logs).
//
// This page:
//   1. Reads token + short from the fragment.
//   2. Clears any stale state in localStorage (mirrors login()).
//   3. Stores the token.
//   4. Fetches /auth/me + /portal/{short}/branding to seed the
//      rt_cp_user + rt_cp_client caches.
//   5. Redirects to /dashboard.
//
// If anything fails (missing token, /me 401, branding 404), shows
// a friendly error with a link back to the standard /login flow.

export default function CmLoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      // Parse fragment params (e.g. #token=abc&short=kingcorp).
      const hash = window.location.hash.replace(/^#/, '')
      const params = new URLSearchParams(hash)
      const token = params.get('token')
      const short = params.get('short')
      if (!token || !short) {
        setError('Missing SSO token. Open this page from the SA Portal — don’t bookmark it.')
        return
      }
      try {
        // Clean slate before storing the new token.
        localStorage.removeItem('rt_cp_token')
        localStorage.removeItem('rt_cp_user')
        localStorage.removeItem('rt_cp_client')

        localStorage.setItem('rt_cp_token', token)
        const meRes = await api.get<CPUser>('/auth/me')
        localStorage.setItem('rt_cp_user', JSON.stringify(meRes.data))

        // Build the client cache. Prefer /portal/{short}/branding
        // for the colours / logo. Fall back to a minimal stub if
        // branding fails (network blip; the user still lands inside).
        let client: CPClient | null = null
        try {
          const brandRes = await api.get<CPClient>(`/portal/${short}/branding`)
          client = brandRes.data
        } catch { /* branding optional */ }
        if (!client) {
          client = {
            id: (meRes.data as { client_id?: string | null }).client_id || '',
            short_name: short,
            display_name: short,
            primary_colour: '#1A5C2A',
            logo_url: null,
            tagline: null,
            org_type_cosh_ids: [],
          }
        } else {
          // /auth/me client_id is the authoritative bound tenant id.
          // Branding's id can drift; override.
          const meClientId = (meRes.data as { client_id?: string | null }).client_id
          if (meClientId) client = { ...client, id: meClientId }
        }
        setClient(client)

        // Clean the fragment from history so the token doesn't sit
        // in browser history.
        window.history.replaceState(null, '', '/cm-login')
        router.replace('/dashboard')
      } catch (err: unknown) {
        const detail = (err as { response?: { data?: { detail?: { message?: string } | string } } })?.response?.data?.detail
        const msg = typeof detail === 'string' ? detail : detail?.message
        setError(msg || 'Could not sign you in. The token may have expired.')
      }
    })()
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md text-center">
          <p className="text-3xl mb-3">🔒</p>
          <p className="font-medium text-slate-900">SSO failed</p>
          <p className="text-sm text-slate-500 mt-2">{error}</p>
          <a href="/login"
            className="inline-block mt-5 text-sm font-medium text-green-700 hover:underline">
            Go to standard login →
          </a>
        </div>
      </div>
    )
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-slate-400">Signing you in…</p>
    </div>
  )
}
