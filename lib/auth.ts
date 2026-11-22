import api from './api'
import { getStore, isCoachView, COACH_VIEW_FLAG } from './tokenStore'

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
   *  (e.g. SA / CM logins). When a CM SSOs in via /cm-login, the
   *  backend synthesises 'CONTENT_MANAGER' into this list — the
   *  sidebar treats CONTENT_MANAGER as catch-all (full CA-equivalent
   *  visibility). */
  portal_roles?: string[]
  /** Batch Q (2026-05-18) — true when the bound user is a CM with
   *  ACTIVE EDIT assignment for the bound client (CM SSO via
   *  /admin/cm/clients/{cid}/login-as). Drives the "CM badge" UI
   *  and unlocks every feature on the client. */
  is_cm_for_this_client?: boolean
  /** Coaching Sandbox context (2026-09-01). Non-null when the user
   *  is a coaching student in an OPEN session — drives read-only
   *  reference-client fetches on pages like Company Profile that
   *  would otherwise show the student's empty workspace shell. */
  coaching_context?: {
    session_id: string
    session_status: string
    coach_name: string | null
    reference_client_id: string
    reference_client_name: string
    workspace_client_id: string
    assigned_pwa_roles: string[]
  } | null
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
  /** 2026-07-05 — Manufacturer flag. Gates the /qr sidebar entry
   *  (in combination with seed-flavour). Optional for the same
   *  cached-CPClient reason above. */
  is_manufacturer?: boolean
  /** 2026-07-05 — Cosh input_manufacturers cosh_id — deterministic
   *  link for the QR Brand Portfolio picker. NULL until SA links it.
   */
  cosh_manufacturer_id?: string | null
  /** 2026-10-16 — Soil Nutrient module flags. Both gate CA-portal
   *  sidebar entries; undefined on CPClient cached before this field
   *  shipped — the layout refreshes branding on mount to backfill. */
  soil_nutrient_module_enabled?: boolean
  has_soil_testing_lab?: boolean
  /** 2026-11-22 — Feature Access state for Messaging / Touchpoints.
   *  Gates the CAMPAIGNS nav section; _expires_at + _days_remaining
   *  drive the Expiring Soon banner (shown ≤7 days). Undefined on
   *  pre-upgrade cached CPClient — layout refreshes branding on mount. */
  messaging_enabled?: boolean
  messaging_expires_at?: string | null
  messaging_days_remaining?: number | null
  touchpoints_enabled?: boolean
  touchpoints_expires_at?: string | null
  touchpoints_days_remaining?: number | null
  /** 2026-10-16 — Coaching workspace access state (hybrid access).
   *  Present only for is_coaching=true workspaces; absent on real
   *  clients. Drives the GRACE days-remaining and ARCHIVED read-only
   *  banners in the portal layout. */
  coaching_access?: {
    state: 'NOT_YET_STARTED' | 'ACTIVE' | 'GRACE' | 'ARCHIVED'
    closed_at: string | null
    grace_ends_at: string | null
  }
}

export interface CPUserWithClient extends CPUser {
  /** Tenant binding (2026-05-18). Set by backend `/auth/me` from
   *  the JWT's client_id claim. Authoritative source for the
   *  frontend's setClient call — pre-login branding fetches drift,
   *  the token can't. */
  client_id?: string | null
  client_short_name?: string | null
}

// 2026-11-20 — Cross-tab session broadcast. localStorage is shared
// across tabs in the same browser, so a login in Tab B silently
// overwrites Tab A's auth state (token + rt_cp_user + rt_cp_client).
// Tab A then starts making API calls with Tab B's tenant token while
// its URL / banner still claims to be Tab A's tenant. Observed on
// staging (Demo 1 / Demo 2) + reported on prod (UAS Raichur / SMS
// Grow) — see `project_cp_cross_tab_logout_2026_11_20.md`.
//
// Fix shape: every login + logout broadcasts a session-change event.
// Other tabs listening via `installCrossTabLogout()` compare the
// broadcast's user_id against their own; on mismatch they force-logout
// to the user's own tenant-branded login URL. Belt-and-suspenders
// with the backend's cross_client_forbidden guard — the guard
// still catches any slipped request; this just stops the slip from
// happening in the first place.
const CROSS_TAB_CHANNEL = 'rt_cp_session'
// Storage-event fallback key. Browsers that don't support
// BroadcastChannel (older Safari) still fire `storage` events
// cross-tab when a localStorage key is set/removed. The writer
// toggles this key's value (timestamp) to give sibling tabs a
// reliable trigger even when `rt_cp_token` already matches what's
// in localStorage (same-user re-login).
const CROSS_TAB_STORAGE_PING = 'rt_cp_session_ping'

export interface SessionChangeEvent {
  kind: 'login' | 'logout'
  user_id: string | null
  client_id: string | null
  at: number
}

function broadcastSessionChange(evt: SessionChangeEvent): void {
  if (typeof window === 'undefined') return
  try {
    const bc = new BroadcastChannel(CROSS_TAB_CHANNEL)
    bc.postMessage(evt)
    bc.close()
  } catch {
    // BroadcastChannel missing / disabled — fall through to the
    // storage-event trigger below, which every mainstream browser
    // supports.
  }
  try {
    localStorage.setItem(CROSS_TAB_STORAGE_PING, JSON.stringify(evt))
  } catch { /* quota / privacy mode — can't help it */ }
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
  // 2026-11-20 — Notify sibling tabs so they can eject stale sessions.
  broadcastSessionChange({
    kind: 'login',
    user_id: me.data.id,
    client_id: me.data.client_id || null,
    at: Date.now(),
  })
  return me.data
}

export function logout(): void {
  // Coach-view tabs get a dedicated exit path — close the tab (or
  // wipe sessionStorage + redirect somewhere neutral). Sign-out UI
  // is relabelled "Close view" for these tabs so this branch only
  // fires from that explicit exit.
  if (isCoachView()) {
    sessionStorage.removeItem('rt_cp_token')
    sessionStorage.removeItem('rt_cp_user')
    sessionStorage.removeItem('rt_cp_client')
    sessionStorage.removeItem(COACH_VIEW_FLAG)
    // Best-effort tab close; if the tab wasn't opened via window.open
    // the browser refuses and we fall through to an empty about:blank.
    window.close()
    window.location.href = 'about:blank'
    return
  }

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
  // 2026-11-20 — Logouts also broadcast so sibling tabs that still
  // think they're authenticated eject cleanly instead of surviving
  // on stale-React state until the next API 401.
  broadcastSessionChange({
    kind: 'logout', user_id: null, client_id: null, at: Date.now(),
  })
  window.location.href = target
}

// 2026-11-20 — Called once from the portal layout mount. Listens for
// cross-tab session-change broadcasts (via BroadcastChannel primary
// + storage-event fallback). When a sibling tab logs in/out and the
// event's user_id differs from this tab's own, force-logout: clears
// in-memory state (via window.location.reload or a redirect, caller's
// choice) and lands this tab on its own tenant-branded login URL.
//
// `currentUserIdResolver` is a callable because the hook runs inside
// React — the caller passes a stable function that returns the
// currently-rendered user_id from React state, not a stale closure.
//
// Returns an unsubscribe function for React effect cleanup.
export function installCrossTabLogout(
  currentUserIdResolver: () => string | null,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  if (isCoachView()) return () => undefined   // coach-view uses per-tab sessionStorage; no cross-tab leak possible

  function handle(evt: SessionChangeEvent): void {
    const my = currentUserIdResolver()
    // No current user → nothing to protect.
    if (!my) return
    // Same user re-logging in → no action (benign refresh).
    if (evt.kind === 'login' && evt.user_id === my) return
    // Otherwise the session has changed under us → eject to our own
    // tenant-branded login URL. Read the short_name from the CPUser
    // in localStorage BEFORE it gets clobbered; fall back to generic.
    let target = '/login'
    try {
      const u = JSON.parse(localStorage.getItem('rt_cp_user') || 'null') as CPUserWithClient | null
      if (u?.client_short_name) target = `/login/${u.client_short_name}`
    } catch { /* fall through */ }
    // Hard navigation (not router.push) so every bit of in-memory
    // React state / React Query cache / zustand store is dropped.
    window.location.href = target
  }

  let bc: BroadcastChannel | null = null
  try {
    bc = new BroadcastChannel(CROSS_TAB_CHANNEL)
    bc.onmessage = (e: MessageEvent) => handle(e.data as SessionChangeEvent)
  } catch { /* fall through to storage event */ }

  function onStorage(e: StorageEvent) {
    if (e.key !== CROSS_TAB_STORAGE_PING || !e.newValue) return
    try {
      handle(JSON.parse(e.newValue) as SessionChangeEvent)
    } catch { /* malformed — ignore */ }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    if (bc) { try { bc.close() } catch { /* already closed */ } }
    window.removeEventListener('storage', onStorage)
  }
}

export function getToken(): string | null {
  const store = getStore()
  return store ? store.getItem('rt_cp_token') : null
}

export function getUser(): CPUser | null {
  const store = getStore()
  if (!store) return null
  try { return JSON.parse(store.getItem('rt_cp_user') || '') } catch { return null }
}

export function getClient(): CPClient | null {
  const store = getStore()
  if (!store) return null
  try { return JSON.parse(store.getItem('rt_cp_client') || '') } catch { return null }
}

export function setClient(client: CPClient): void {
  const store = getStore()
  if (store) store.setItem('rt_cp_client', JSON.stringify(client))
}

/**
 * 2026-11-16 — cache the latest `/auth/me` payload. Used by the
 * portal layout's on-mount refresh so role changes (CA adds the RM
 * role to a multi-role user, for example) pick up without forcing
 * a logout/login dance. Mirrors `setClient` + the `rt_cp_user`
 * localStorage key already in use by `login()` / `getUser()`.
 */
export function setUser(user: CPUser): void {
  const store = getStore()
  if (store) store.setItem('rt_cp_user', JSON.stringify(user))
}

export function hasRole(user: CPUser | null, ...roles: string[]): boolean {
  if (!user) return false
  return user.roles.some(r => r.status === 'ACTIVE' && roles.includes(r.role_type))
}

/** Publish-rights helper (2026-05-30). Only Subject Experts can
 *  publish CCA / PG / SP / SR. CMs can edit content but cannot push
 *  it LIVE — matches the backend's `_assert_can_publish_client_advisory`
 *  gate. CA falls through unless they also carry an SE portal role
 *  (multi-role is supported for non-CA roles only).
 *
 *  Coaching Sandbox (2026-09-02): a coaching student is the sole CA
 *  of their is_coaching workspace and can't add an SE (my earlier
 *  add_portal_user guard + CA-exclusivity block it). So without this
 *  bypass the student could never practise the Publish flow. The
 *  backend gates (`_assert_can_edit_client_advisory` +
 *  `_assert_can_publish_client_advisory`) have the mirroring
 *  is_coaching short-circuit — this UI helper mirrors it so the
 *  Publish button surfaces instead of being hidden.
 *
 *  Used to hide Publish buttons / hide preview-page Publish CTAs.
 *  Surfaces the same rule client-side so the user doesn't get to
 *  the click → 403 round-trip. */
export function canPublishAdvisory(user: CPUser | null): boolean {
  if (hasPortalRole(user, 'SUBJECT_EXPERT')) return true
  if (user?.coaching_context) return true
  return false
}

/** Post-login landing route. Dashboard fetches packages/pool/alerts
 *  behind `_assert_can_view_client_advisory` (SUBJECT_EXPERT + CA +
 *  CM-EDIT only), so a REPORT_USER-only account 403s on every tile.
 *  Send them to Reports instead.
 *
 *  Rule: if REPORT_USER is the ONLY portal role, land on /reports
 *  (Overview). Anyone with any other role (or multi-role including
 *  REPORT_USER + something else) lands on /dashboard.
 *  2026-07-28 — target flipped from /reports/subscriptions to
 *  /reports once the Overview page landed. */
export function landingRouteForUser(user: CPUser | null): string {
  if (!user) return '/dashboard'
  const roles = user.portal_roles ?? (user.portal_role ? [user.portal_role] : [])
  if (roles.length === 1 && roles[0] === 'REPORT_USER') {
    return '/reports'
  }
  return '/dashboard'
}
