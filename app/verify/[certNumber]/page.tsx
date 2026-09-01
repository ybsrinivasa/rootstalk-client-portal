'use client'

// Public certificate verification page (Phase 6b). Anyone with the
// certificate number can hit /verify/<cert_number> and see the
// certificate details echoed back — proves authenticity without any
// login. Backend endpoint:
//   GET /coaching/certificates/{cert_number}
// Response is deliberately narrow — no student email/phone, no
// coach email, no workspace ids leaked.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'


interface CertificateView {
  certificate_number: string
  student_name: string | null
  reference_client_name: string
  coach_name: string | null
  session_started_at: string | null
  session_closed_at: string | null
  grade: 'SATISFACTORY' | 'GOOD' | 'EXCELLENT'
  certified_at: string
  certificate_generated_at: string | null
}


const GRADE_LABEL: Record<string, string> = {
  SATISFACTORY: 'Satisfactory', GOOD: 'Good', EXCELLENT: 'Excellent',
}
const GRADE_COLOUR: Record<string, string> = {
  SATISFACTORY: 'text-blue-700',
  GOOD:         'text-emerald-700',
  EXCELLENT:    'text-purple-700',
}


function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  }) } catch { return iso }
}


export default function VerifyCertificatePage() {
  const { certNumber } = useParams<{ certNumber: string }>()
  const [cert, setCert] = useState<CertificateView | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    api.get<CertificateView>(`/coaching/certificates/${certNumber}`)
      .then(r => setCert(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [certNumber])

  if (loading) return (
    <PageShell>
      <div className="text-center text-slate-500 text-sm py-12">Verifying…</div>
    </PageShell>
  )

  if (notFound || !cert) return (
    <PageShell>
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h1 className="text-lg font-semibold text-red-800 mb-2">Certificate not found</h1>
        <p className="text-sm text-red-700">
          We could not verify a certificate with number <code>{certNumber}</code>.
        </p>
        <p className="text-xs text-red-700/70 mt-2">
          If you received this link from someone claiming to hold a rootsTALK certification, please treat it with caution.
        </p>
      </div>
    </PageShell>
  )

  return (
    <PageShell>
      <div className="bg-white border border-emerald-200 rounded-xl p-6">
        <div className="text-center mb-6 pb-6 border-b border-slate-100">
          <p className="text-emerald-700 font-semibold text-sm">✓ Verified rootsTALK certificate</p>
          <h1 className="text-3xl font-bold text-slate-800 mt-3">{cert.student_name || '—'}</h1>
          <p className="text-sm text-slate-500 mt-2">
            completed the rootsTALK Coaching Program in the context of
          </p>
          <p className="text-lg font-semibold text-slate-800 mt-1">{cert.reference_client_name}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1">Grade</dt>
            <dd className={`text-lg font-bold ${GRADE_COLOUR[cert.grade] || 'text-slate-800'}`}>
              {GRADE_LABEL[cert.grade] || cert.grade}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1">Coach</dt>
            <dd className="text-slate-800 font-medium">{cert.coach_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1">Session started</dt>
            <dd className="text-slate-700">{formatDate(cert.session_started_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1">Session closed</dt>
            <dd className="text-slate-700">{formatDate(cert.session_closed_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1">Certified on</dt>
            <dd className="text-slate-700">{formatDate(cert.certified_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 uppercase tracking-wider mb-1">Certificate number</dt>
            <dd className="text-slate-700 font-mono text-xs break-all">{cert.certificate_number}</dd>
          </div>
        </dl>

        <p className="text-xs text-slate-500 text-center mt-6 pt-6 border-t border-slate-100 italic">
          Issued by NEYTIRI EYWAFARM AGRITECH PRIVATE LIMITED via rootsTALK
        </p>
      </div>
    </PageShell>
  )
}


function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">rootsTALK Certificate Verification</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
