import axios from 'axios'
import { getStore, isCoachView } from './tokenStore'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001',
})

api.interceptors.request.use((config) => {
  const store = getStore()
  if (store) {
    const token = store.getItem('rt_cp_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (typeof window !== 'undefined') {
      const status = error.response?.status
      const code = error.response?.data?.detail?.code
      // Coach-view 403s on writes are expected (get_current_user
      // refuses any non-safe method on tokens with `coach_view=true`).
      // Don't hijack the response — the caller sees the error and
      // shows an inline "Read-only mode" toast. Same reasoning for
      // 401s inside a coach-view tab: the coach can't re-authenticate
      // from here (they'd need to open a fresh view from the SA
      // portal), so redirecting to /login would just log them out of
      // the student's identity and land on the company login page —
      // wrong for both users.
      if (isCoachView()) {
        return Promise.reject(error)
      }
      if (status === 401 && !window.location.pathname.startsWith('/onboarding/')) {
        // Preserve the company-branded login URL on session expiry,
        // mirroring the explicit logout flow in lib/auth.ts. The
        // /onboarding/[token] page is intentionally public — its
        // own .catch() handles failures (empty-list fallback for the
        // org-type checklist). Don't hijack it with a hard redirect.
        let target = '/login'
        try {
          const cached = JSON.parse(localStorage.getItem('rt_cp_client') || 'null') as { short_name?: string } | null
          if (cached?.short_name) target = `/login/${cached.short_name}`
        } catch { /* fall through to generic /login */ }
        localStorage.removeItem('rt_cp_token')
        localStorage.removeItem('rt_cp_user')
        localStorage.removeItem('rt_cp_client')
        window.location.href = target
      } else if (
        status === 403
        && (code === 'advisory_view_forbidden' || code === 'cross_client_forbidden')
        // Don't loop if we're already on the access-denied page.
        && !window.location.pathname.startsWith('/access-denied')
      ) {
        const wanted = encodeURIComponent(window.location.pathname)
        const reason = encodeURIComponent(
          error.response?.data?.detail?.message || ''
        )
        window.location.href = `/access-denied?from=${wanted}&reason=${reason}`
      }
    }
    return Promise.reject(error)
  }
)

export default api
