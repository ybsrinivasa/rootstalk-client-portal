// Coach-view mode uses sessionStorage so the token, user, and client
// context live only for the duration of the tab — never persists past
// close, never bleeds into the coach's own portal tab. Normal login
// keeps using localStorage. `getStore` picks the right one; every
// helper in lib/auth.ts + the api.ts interceptor route through here
// so callers never touch storage directly.

export const COACH_VIEW_FLAG = 'rt_cp_coach_view'

export function isCoachView(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(COACH_VIEW_FLAG) === '1'
}

export function getStore(): Storage | null {
  if (typeof window === 'undefined') return null
  return isCoachView() ? sessionStorage : localStorage
}
