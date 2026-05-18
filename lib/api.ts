import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001',
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('rt_cp_token')
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
      if (status === 401) {
        // Preserve the company-branded login URL on session expiry,
        // mirroring the explicit logout flow in lib/auth.ts.
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
