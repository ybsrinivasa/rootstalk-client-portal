import api from './api'

export interface CPUser {
  id: string; email: string; name: string | null
  roles: { role_type: string; status: string }[]
}

export interface CPClient {
  id: string; short_name: string; display_name: string
  primary_colour: string; logo_url: string | null; tagline: string | null
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api.post('/auth/admin/login', { email, password })
  localStorage.setItem('rt_cp_token', data.access_token)
  const me = await api.get<CPUser>('/auth/me')
  localStorage.setItem('rt_cp_user', JSON.stringify(me.data))
}

export function logout(): void {
  localStorage.removeItem('rt_cp_token')
  localStorage.removeItem('rt_cp_user')
  localStorage.removeItem('rt_cp_client')
  window.location.href = '/login'
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
