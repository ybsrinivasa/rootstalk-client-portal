import api from './api'

export interface CPUser {
  id: string; email: string; name: string | null
  roles: { role_type: string; status: string }[]
  /** @deprecated — use portal_roles. Kept for backward compat with
   *  cached objects from pre-Batch-K sessions. New code should read
   *  portal_roles. */
  portal_role: string | null
  /** Batch K (2026-05-18) — all ACTIVE ClientUser roles for this
   *  user at the JWT-bound client. Multi-role is supported for every
   *  role except CA (which is mutually exclusive — enforced server-
   *  side). The sidebar shows the UNION of items across these roles.
   *  Empty when the user has no ClientUser at the bound client
   *  (e.g. SA / CM logins). */
  portal_roles?: string[]
}

/** Convenience helper — true when the user's portal_roles include the
 *  given role. Use this in pages that need to gate UI on a specific
 *  role membership. */
export function hasPortalRole(user: CPUser | null, role: string): boolean {
  if (!user) return false
  // Prefer the new portal_roles list; fall back to legacy portal_role
  // for users whose cached /auth/me payload predates Batch K.
  const list = user.portal_roles
  if (Array.isArray(list)) return list.includes(role)
  return user.portal_role === role
}

export interface CPClient {
  id: string; short_name: string; display_name: string
  primary_colour: string; logo_url: string | null; tagline: string | null
  org_type_cosh_ids: string[]
  /** Per spec §11.1 — client-level subscription configuration.
   *  Optional in the type because cached CPClient objects from a
   *  pre-payment-model login won't have it; UI should tolerate
   *  `undefined` gracefully and refetch on next login. */
  payment_model?: 'COMPANY_PAYS' | 'FARMER_PAYS'
}

export interface CPUserWithClient extends CPUser {
  /** Tenant binding (2026-05-18). Set by backend `/auth/me` from
   *  the JWT's client_id claim. Authoritative source for the
   *  frontend's setClient call — pre-login branding fetches drift,
   *  the token can't. */
  client_id?: string | null
  client_short_name?: string | null
}

export async function login(email: string, password: string, clientShortName?: string): Promise<CPUserWithClient> {
  // Tenant isolation (2026-05-18): clear ANY stale state from a prior
  // session before authenticating. Without this, a partial UI failure
  // path (e.g. pre-login branding fetch returns null) leaves rt_cp_client
  // pointing at the previous tenant — and getClient() returns it, so the
  // dashboard hits /client/{old_id}/packages and surfaces the prior
  // tenant's data. Belt-and-suspenders with backend JWT.client_id claim:
  // even if this clearing is skipped, the backend's cross_client_forbidden
  // guard in get_current_user refuses the cross-tenant call (403).
  localStorage.removeItem('rt_cp_token')
  localStorage.removeItem('rt_cp_user')
  localStorage.removeItem('rt_cp_client')

  const { data } = await api.post('/auth/admin/login', {
    email, password, ...(clientShortName ? { client_short_name: clientShortName } : {}),
  })
  localStorage.setItem('rt_cp_token', data.access_token)
  const me = await api.get<CPUserWithClient>('/auth/me')
  localStorage.setItem('rt_cp_user', JSON.stringify(me.data))
  return me.data
}

export function logout(): void {
  // Capture the bound short_name BEFORE clearing localStorage so we
  // can land the user back on their company-branded login URL
  // (/login/<short>) instead of the generic /login. Per user
  // 2026-05-18: "When a Client User signs out, he doesn't stay
  // with his company URL. It helps to stay with his company URL
  // only."
  let target = '/login'
  try {
    const cached = JSON.parse(localStorage.getItem('rt_cp_client') || 'null') as { short_name?: string } | null
    if (cached?.short_name) {
      target = `/login/${cached.short_name}`
    }
  } catch { /* fall through to generic /login */ }
  localStorage.removeItem('rt_cp_token')
  localStorage.removeItem('rt_cp_user')
  localStorage.removeItem('rt_cp_client')
  window.location.href = target
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('rt_cp_token')
}

export function getUser(): CPUser | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('rt_cp_user') || '') } catch { return null }
}

export function getClient(): CPClient | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('rt_cp_client') || '') } catch { return null }
}

export function setClient(client: CPClient): void {
  localStorage.setItem('rt_cp_client', JSON.stringify(client))
}

export function hasRole(user: CPUser | null, ...roles: string[]): boolean {
  if (!user) return false
  return user.roles.some(r => r.status === 'ACTIVE' && roles.includes(r.role_type))
}
