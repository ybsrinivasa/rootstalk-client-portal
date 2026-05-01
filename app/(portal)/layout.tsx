'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getToken, getUser, getClient, logout, CPClient, CPUser } from '@/lib/auth'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '⬡' },
  { href: '/advisory', label: 'CCA — Advisory', icon: '🌿' },
  { href: '/cha', label: 'CHA — Crop Health', icon: '🔬' },
  { href: '/field-manager', label: 'Field Manager', icon: '🌾' },
  { href: '/farm-pundits', label: 'FarmPundits', icon: '🎓' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/setup', label: 'Setup', icon: '⚙' },
  { href: '/users', label: 'Users', icon: '👥' },
  { href: '/subscription', label: 'Subscription', icon: '💳' },
]

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [client, setClient] = useState<CPClient | null>(null)
  const [user, setUser] = useState<CPUser | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return }
    setClient(getClient())
    setUser(getUser())
  }, [router])

  const colour = client?.primary_colour || '#1A5C2A'

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 flex flex-col transition-transform lg:translate-x-0 lg:static lg:inset-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: `linear-gradient(180deg, ${colour}f0, ${colour}cc)` }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          {client?.logo_url
            ? <img src={client.logo_url} alt="logo" className="h-8 w-8 object-contain rounded" />
            : <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-sm">
                {client?.display_name?.[0] || 'R'}
              </div>
          }
          <div className="overflow-hidden">
            <p className="text-white font-semibold text-sm leading-tight truncate">{client?.display_name || 'RootsTalk'}</p>
            <p className="text-white/50 text-xs">Client Portal</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(item => {
            const active = pathname.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-white/80 text-xs font-medium truncate">{user?.name || user?.email}</p>
          <button onClick={logout} className="text-white/50 text-xs hover:text-white mt-1">Sign out</button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-100">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-slate-800 text-sm">{client?.display_name || 'RootsTalk'}</span>
        </div>

        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
