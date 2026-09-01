'use client'

// Coaching Sandbox — public student self-registration page (Phase 4b).
// Token-authed via URL (no login required, no auth headers). The
// emailed invite link lands here. Consumes the two public backend
// endpoints:
//   GET  /coaching/join/{token}         — invite context
//   POST /coaching/join/{token}/submit  — submit registration form
//
// Same public-domain convention as /onboarding/[token] (SA client
// onboarding) — invite link is `{frontend_base_url}/coaching/join/
// {token}` which resolves to this exact route on the client-portal
// app (which serves the SA + CA portals at path-prefix).

import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'


interface InviteContext {
  email: string
  coach_name: string | null
  reference_client_name: string
  status: string  // INVITED | SUBMITTED | APPROVED | REJECTED
  expires_at: string
  already_submitted: boolean
  can_submit: boolean
}


function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}


export default function CoachingJoinPage() {
  const { token } = useParams<{ token: string }>()

  const [ctx, setCtx] = useState<InviteContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    year_of_birth: '',
    address: '',
    organization: '',
    phone: '',
  })

  useEffect(() => {
    api.get<InviteContext>(`/coaching/join/${token}`)
      .then(r => setCtx(r.data))
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')

    // Client-side sanity checks — backend validates authoritatively
    // but early rejection avoids a round-trip on obvious problems.
    if (!form.name.trim() || form.name.trim().length < 2) {
      setError('Please enter your full name.')
      return
    }
    const yob = parseInt(form.year_of_birth, 10)
    if (!yob || yob < 1930 || yob > 2015) {
      setError('Please enter a valid year of birth (1930–2015).')
      return
    }
    if (!form.address.trim() || form.address.trim().length < 5) {
      setError('Please enter your postal address.')
      return
    }
    if (!form.organization.trim()) {
      setError('Please enter your affiliated organization (college, university, etc.).')
      return
    }
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (phoneDigits.length < 10) {
      setError('Please enter a valid 10-digit mobile number.')
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/coaching/join/${token}/submit`, {
        name: form.name.trim(),
        year_of_birth: yob,
        address: form.address.trim(),
        organization: form.organization.trim(),
        phone: form.phone.trim(),
      })
      setDone(true)
      // Refresh context so subsequent visits see the SUBMITTED state.
      api.get<InviteContext>(`/coaching/join/${token}`)
        .then(r => setCtx(r.data))
        .catch(() => { /* best-effort refresh */ })
    } catch (e) {
      setError(extractErrorMessage(
        e,
        'We could not submit your details. Please try again in a moment.',
      ))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render states ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <PageShell>
        <div className="text-center text-slate-500 text-sm py-12">Loading…</div>
      </PageShell>
    )
  }

  if (invalid || !ctx) {
    return (
      <PageShell>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <h1 className="text-lg font-semibold text-red-800 mb-1">Invite not found</h1>
          <p className="text-sm text-red-700">
            This coaching invite link is invalid or has expired. Please ask your coach for a fresh invite.
          </p>
        </div>
      </PageShell>
    )
  }

  // Already SUBMITTED — waiting on coach approval. Re-submission is
  // allowed while status is SUBMITTED (fix typos before coach reviews).
  if (done || (ctx.status === 'SUBMITTED' && !ctx.can_submit)) {
    return (
      <PageShell coach={ctx.coach_name} referenceClient={ctx.reference_client_name}>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-emerald-800 mb-2">Your details are with your coach</h1>
          <p className="text-sm text-emerald-700 leading-relaxed">
            {ctx.coach_name || 'Your coach'} will review your submission and confirm your enrolment. You&apos;ll receive a confirmation email at <strong>{ctx.email}</strong> once approved — including login instructions for your coaching workspace.
          </p>
        </div>
      </PageShell>
    )
  }

  if (ctx.status === 'APPROVED') {
    return (
      <PageShell coach={ctx.coach_name} referenceClient={ctx.reference_client_name}>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-emerald-800 mb-2">You&apos;re already enrolled</h1>
          <p className="text-sm text-emerald-700 leading-relaxed">
            Your enrolment has been approved. Check your email at <strong>{ctx.email}</strong> for login instructions. Once your coach starts the session, you can log in to your coaching workspace.
          </p>
        </div>
      </PageShell>
    )
  }

  if (ctx.status === 'REJECTED') {
    return (
      <PageShell coach={ctx.coach_name} referenceClient={ctx.reference_client_name}>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-slate-800 mb-2">Invite closed</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            This coaching invitation is no longer active. Please reach out to your coach if you have questions.
          </p>
        </div>
      </PageShell>
    )
  }

  if (!ctx.can_submit) {
    // Covers expired invite + session-has-started cases.
    return (
      <PageShell coach={ctx.coach_name} referenceClient={ctx.reference_client_name}>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h1 className="text-lg font-semibold text-amber-800 mb-2">This invite is no longer active</h1>
          <p className="text-sm text-amber-700 leading-relaxed">
            The window for joining this coaching session has closed. Please ask your coach for a fresh invite.
          </p>
          <p className="text-xs text-amber-700/70 mt-2">
            Invite expires at {formatDate(ctx.expires_at)}.
          </p>
        </div>
      </PageShell>
    )
  }

  // Actively soliciting the form (INVITED or a fresh re-submit on SUBMITTED)
  return (
    <PageShell coach={ctx.coach_name} referenceClient={ctx.reference_client_name}>
      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">Invited email</p>
          <p className="text-sm font-medium text-slate-800">{ctx.email}</p>
        </div>

        <Field label="Full name" required>
          <input type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. Priya Sharma" required />
        </Field>

        <Field label="Year of birth" required>
          <input type="number" value={form.year_of_birth}
            onChange={e => setForm(f => ({ ...f, year_of_birth: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="YYYY" min="1930" max="2015" required />
        </Field>

        <Field label="Organization affiliated to" required
          hint="College, university, research institute, or company you're associated with.">
          <input type="text" value={form.organization}
            onChange={e => setForm(f => ({ ...f, organization: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. Punjab Agricultural University" required />
        </Field>

        <Field label="Postal address" required
          hint="Where you can be reached for coaching-related correspondence.">
          <textarea value={form.address} rows={3}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="Street, city, PIN code" required />
        </Field>

        <Field label="Mobile number" required
          hint="Enter a fresh number — this will be your PWA login and cannot already be registered on RootsTalk.">
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 text-slate-500 text-sm">
              +91
            </span>
            <input type="tel" inputMode="numeric" maxLength={10}
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
              className="flex-1 border border-slate-300 rounded-r-lg px-3 py-2 text-sm"
              placeholder="10-digit mobile" required />
          </div>
        </Field>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="pt-2">
          <button type="submit" disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-3 rounded-lg disabled:opacity-50">
            {submitting ? 'Submitting…' : 'Submit for coach approval'}
          </button>
          <p className="text-xs text-slate-500 text-center mt-3">
            Your details will go to your coach for review. You&apos;ll receive a confirmation email once approved.
          </p>
        </div>
      </form>
    </PageShell>
  )
}


// ── Shared page shell + form field wrapper ────────────────────────────────

function PageShell({
  children, coach, referenceClient,
}: {
  children: React.ReactNode
  coach?: string | null
  referenceClient?: string
}) {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">rootsTALK Coaching</h1>
          <p className="text-sm text-slate-500 mt-1">Agriculture coaching program registration</p>
        </div>
        {coach && referenceClient && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
            <p className="text-xs text-slate-500">You&apos;ve been invited by</p>
            <p className="font-semibold text-slate-800">{coach}</p>
            <p className="text-xs text-slate-500 mt-2">Coaching context</p>
            <p className="font-semibold text-slate-800">{referenceClient}</p>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}


function Field({
  label, required, hint, children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}
