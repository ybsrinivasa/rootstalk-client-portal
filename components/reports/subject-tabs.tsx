'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Sub-nav strip at the top of every Reports subject page. Renders a
// simple set of tab-styled links; the active tab is picked by
// startsWith(href) so /reports/subscriptions?crop=… still highlights
// the Subscriptions tab.
//
// When the Overview page (/reports) lands, add it as the first tab
// and make the Reports sidebar entry point at /reports; nothing else
// changes.

interface SubjectTab {
  href: string
  label: string
}

const TABS: SubjectTab[] = [
  { href: '/reports',               label: 'Overview' },
  { href: '/reports/subscriptions', label: 'Subscriptions' },
  { href: '/reports/orders',        label: 'Orders' },
  { href: '/reports/sales',         label: 'Sales' },
]

export function ReportSubjectTabs() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Report subjects"
      className="flex items-center gap-1 border-b border-slate-200"
    >
      {TABS.map(tab => {
        // '/reports' matches EXACTLY (not startsWith) so it doesn't
        // light up when we're on /reports/subscriptions.
        const active = tab.href === '/reports'
          ? pathname === '/reports'
          : (pathname === tab.href || pathname.startsWith(tab.href + '/'))
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2 -mb-px text-sm border-b-2 transition-colors ${
              active
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
