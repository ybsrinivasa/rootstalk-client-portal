'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getToken, getUser, getClient, logout, CPClient, CPUser } from '@/lib/auth'

// ── SVG icon components ──────────────────────────────────────────────────────
function IconHome() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}
function IconAdvisory() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}
function IconCHA() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}
function IconFieldManager() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
function IconFarmPundits() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
    </svg>
  )
}
function IconAlerts() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  )
}
function IconSeed() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  )
}
function IconCustomParams() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  )
}
function IconQR() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h.01M12 4h.01M4 4h4v4H4V4zm12 0h4v4h-4V4zM4 16h4v4H4v-4z" />
    </svg>
  )
}
function IconUsers() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}
function IconSetup() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function IconBuilding() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  )
}
function IconLock() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}
function IconCard() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  )
}

// ── Nav definition ────────────────────────────────────────────────────────────
interface NavItem {
  href: string
  label: string
  Icon: React.ComponentType
  caOnly?: boolean
  seedOnly?: boolean
  group: string
}

const ALL_NAV: NavItem[] = [
  { href: '/dashboard',          label: 'Dashboard',         Icon: IconHome,         group: 'PORTAL' },
  { href: '/cca/crops',          label: 'CCA · Crops',       Icon: IconAdvisory,     group: 'CCA' },
  { href: '/cca/packages',       label: 'CCA · Packages',    Icon: IconAdvisory,     group: 'CCA' },
  { href: '/cca/timelines',      label: 'CCA · Timelines',   Icon: IconAdvisory,     group: 'CCA' },
  { href: '/cca/practices',      label: 'CCA · Practices',   Icon: IconAdvisory,     group: 'CCA' },
  { href: '/cha/problems',          label: 'CHA · PG · Problems',         Icon: IconCHA, group: 'CHA' },
  { href: '/cha/recommendations',   label: 'CHA · PG · Recommendations',  Icon: IconCHA, group: 'CHA' },
  { href: '/cha/timelines',         label: 'CHA · PG · Timelines',        Icon: IconCHA, group: 'CHA' },
  { href: '/cha/practices',         label: 'CHA · PG · Practices',        Icon: IconCHA, group: 'CHA' },
  { href: '/cha/sp/crops',          label: 'CHA · SP · Crops',            Icon: IconCHA, group: 'CHA' },
  { href: '/cha/sp/specific-problems', label: 'CHA · SP · Specific Problems', Icon: IconCHA, group: 'CHA' },
  { href: '/cha/sp/timelines',      label: 'CHA · SP · Timelines',        Icon: IconCHA, group: 'CHA' },
  { href: '/cha/sp/practices',      label: 'CHA · SP · Practices',        Icon: IconCHA, group: 'CHA' },
  { href: '/custom-parameters',  label: 'Custom Parameters', Icon: IconCustomParams, group: 'CONTENT' },
  { href: '/field-manager',      label: 'Field Manager',     Icon: IconFieldManager, group: 'FIELD' },
  { href: '/alerts',             label: 'Alerts',            Icon: IconAlerts,       group: 'FIELD' },
  { href: '/seed',               label: 'Seed Varieties',    Icon: IconSeed,         group: 'DATA', seedOnly: true },
  { href: '/qr',                 label: 'QR Codes',          Icon: IconQR,           group: 'DATA' },
  { href: '/farm-pundits',       label: 'FarmPundits',       Icon: IconFarmPundits,  group: 'PORTAL', caOnly: true },
  { href: '/standard-responses', label: 'Standard Q&A',      Icon: IconCHA,          group: 'CONTENT' },
  { href: '/users',              label: 'Users',             Icon: IconUsers,        group: 'PORTAL' },
  { href: '/setup',              label: 'Setup',             Icon: IconSetup,        group: 'PORTAL' },
  { href: '/profile',            label: 'Company Profile',   Icon: IconBuilding,     group: 'PORTAL', caOnly: true },
  { href: '/change-password',    label: 'Change Password',   Icon: IconLock,         group: 'ACCOUNT' },
  { href: '/subscription',       label: 'Subscription',      Icon: IconCard,         group: 'ACCOUNT' },
]

const ROLE_NAV: Record<string, string[]> = {
  SUBJECT_EXPERT:   ['/dashboard', '/cca/crops', '/cca/packages', '/cca/timelines', '/cca/practices', '/cha/problems', '/cha/recommendations', '/cha/timelines', '/cha/practices', '/cha/sp/crops', '/cha/sp/specific-problems', '/cha/sp/timelines', '/cha/sp/practices', '/custom-parameters', '/standard-responses', '/alerts'],
  FIELD_MANAGER:    ['/dashboard', '/field-manager', '/alerts'],
  CLIENT_RM:        ['/dashboard', '/alerts', '/field-manager'],
  SEED_DATA_MANAGER:['/dashboard', '/seed'],
  PRODUCT_MANAGER:  ['/dashboard', '/qr'],
  REPORT_USER:      ['/dashboard'],
}

const GROUP_ORDER = ['PORTAL', 'CCA', 'CHA', 'CONTENT', 'FIELD', 'DATA', 'ACCOUNT']

function getNavForRole(role: string | null, client: CPClient | null): NavItem[] {
  const isSeedClient = client?.org_type_cosh_ids?.includes('org_type_seed_companies') ?? false

  if (!role || role === 'CA') {
    return ALL_NAV.filter(item => {
      if (item.seedOnly && !isSeedClient) return false
      return true
    })
  }

  const allowed = ROLE_NAV[role]
  if (!allowed) {
    return ALL_NAV.filter(item => {
      if (item.seedOnly && !isSeedClient) return false
      if (item.caOnly) return false
      return true
    })
  }

  return ALL_NAV.filter(item => {
    if (!allowed.includes(item.href)) return false
    if (item.seedOnly && !isSeedClient) return false
    return true
  })
}

// ── Group label component ─────────────────────────────────────────────────────
function GroupLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/25">
      {label}
    </p>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [client, setClientState] = useState<CPClient | null>(null)
  const [user, setUser] = useState<CPUser | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return }
    setClientState(getClient())
    setUser(getUser())
  }, [router])

  const nav = getNavForRole(user?.portal_role ?? null, client)

  // Group nav items
  const grouped = GROUP_ORDER.map(group => ({
    group,
    items: nav.filter(item => item.group === group),
  })).filter(g => g.items.length > 0)

  // Initials for user avatar
  const initials = (() => {
    const name = user?.name || user?.email || ''
    const parts = name.split(/[\s@]/)
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase()
  })()

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 flex flex-col transition-transform lg:translate-x-0 lg:static lg:inset-auto bg-[#1A2332] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 bg-[#1F2A3C] border-b border-white/5 flex-shrink-0">
          {client?.logo_url
            ? <img src={client.logo_url} alt="logo" className="h-10 w-10 object-cover rounded-full flex-shrink-0" />
            : <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {client?.display_name?.[0] || 'R'}
              </div>
          }
          <div className="overflow-hidden">
            <p className="text-white font-semibold text-sm leading-tight truncate">{client?.display_name || 'RootsTalk'}</p>
            <p className="text-white/40 text-xs truncate">{client?.short_name || 'Client Portal'}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto pb-2">
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <GroupLabel label={group} />
              {items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const { Icon } = item
                return (
                  <Link key={item.href} href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm transition-all ${
                      active
                        ? 'bg-white/10 border-l-2 border-[#C4994A] text-white font-medium pl-[10px]'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}>
                    <Icon />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              {initials}
            </div>
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="text-white/80 text-xs font-medium truncate">{user?.name || user?.email}</p>
              {user?.name && <p className="text-white/40 text-xs truncate">{user.email}</p>}
            </div>
          </div>
          <button onClick={logout} className="text-white/40 text-xs hover:text-white transition-colors">Sign out</button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto border-l border-stone-200">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#F7F5F0] border-b border-stone-200">
          <button onClick={() => setSidebarOpen(true)} className="text-stone-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-stone-800 text-sm">{client?.display_name || 'RootsTalk'}</span>
        </div>

        <main className="flex-1 p-6 bg-[#F7F5F0]">
          {children}
        </main>
      </div>
    </div>
  )
}
