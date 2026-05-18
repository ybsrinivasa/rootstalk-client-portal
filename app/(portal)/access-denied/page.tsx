'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { getClient } from '@/lib/auth'

// Shown by the portal layout when a logged-in user navigates to a
// page their role can't reach (Batch K, 2026-05-18). Strict-role-based
// sidebar items already hide the affordance; this page handles direct
// URL navigation, deep-links from emails, and back-navigation after
// a role change.

function AccessDeniedInner() {
  const client = getClient()
  const params = useSearchParams()
  const wanted = params.get('from') || ''
  const reason = params.get('reason') || ''
  const colour = client?.primary_colour || '#1A5C2A'

  return (
    <div className="max-w-md mx-auto pt-20 px-6 text-center">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="text-xl font-bold text-slate-900">Access denied</h1>
      <p className="text-slate-500 text-sm mt-3 leading-relaxed">
        Your role on <strong>{client?.display_name || 'this company'}</strong> doesn&apos;t
        have access to this page.
      </p>
      {reason && (
        <p className="text-slate-400 text-xs mt-2 italic">{reason}</p>
      )}
      {wanted && (
        <p className="text-slate-400 text-xs mt-2 font-mono">
          Tried to reach: {wanted}
        </p>
      )}
      <p className="text-slate-500 text-sm mt-5 leading-relaxed">
        If you believe this is wrong, ask your CA to grant the appropriate
        role under <strong>Users</strong>.
      </p>
      <Link href="/dashboard"
        className="inline-block mt-6 text-sm font-semibold text-white px-5 py-2.5 rounded-xl"
        style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
        ← Back to Dashboard
      </Link>
    </div>
  )
}

export default function AccessDeniedPage() {
  return (
    <Suspense fallback={<div className="pt-20 text-center text-slate-400">Loading…</div>}>
      <AccessDeniedInner />
    </Suspense>
  )
}
