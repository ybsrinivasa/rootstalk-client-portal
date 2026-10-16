'use client'

// Student Feedback form — Moment 2 (post-session).
// 2026-10-16 design: project_coaching_student_feedback_design_2026_10_16.md
// Standalone, token-authenticated, mobile-first. No login required.
// Three sections stacked:
//   1. Mirror of Moment 1 answers (if any) — student responds to each
//   2. Benchmark against the tech the student named at Moment 1
//   3. Open feedback (1-5 star rating + two text fields + Yes/Maybe/No)

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'


interface FormData {
  student_name: string
  reference_client_name: string
  moment1_answers: Record<string, string>
  requested_at: string
  already_submitted: boolean
}

type Section1Response = {
  mode: 'changed' | 'helped' | 'not_addressed' | null
  text: string
}

type SubmitContent = {
  section1: Record<string, Section1Response>
  section2: {
    compare_to_tech: string
    comparison: 'much_worse' | 'worse' | 'similar' | 'better' | 'much_better' | null
    comparison_reason: string
  }
  section3: {
    star_rating: number
    most_valuable: string
    would_change: string
    would_recommend: 'yes' | 'maybe' | 'no' | null
  }
}


const COMPARE_LABELS: Record<string, string> = {
  much_worse: 'Much worse',
  worse: 'Worse',
  similar: 'Similar',
  better: 'Better',
  much_better: 'Much better',
}


export default function StudentFeedbackPage() {
  const { token } = useParams()
  const [form, setForm] = useState<FormData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [section1, setSection1] = useState<Record<string, Section1Response>>({})
  const [compareToTech, setCompareToTech] = useState('')
  const [comparison, setComparison] = useState<SubmitContent['section2']['comparison']>(null)
  const [comparisonReason, setComparisonReason] = useState('')
  const [starRating, setStarRating] = useState(0)
  const [starHover, setStarHover] = useState(0)
  const [mostValuable, setMostValuable] = useState('')
  const [wouldChange, setWouldChange] = useState('')
  const [wouldRecommend, setWouldRecommend] = useState<SubmitContent['section3']['would_recommend']>(null)

  useEffect(() => {
    if (!token) return
    api.get<FormData>(`/coaching/feedback/${token}`)
      .then(r => {
        setForm(r.data)
        if (r.data.already_submitted) setDone(true)
        // Seed Section 1 responses
        const seed: Record<string, Section1Response> = {}
        for (const key of Object.keys(r.data.moment1_answers || {})) {
          seed[key] = { mode: null, text: '' }
        }
        setSection1(seed)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  const starLabels = ['Very poor', 'Poor', 'OK', 'Good', 'Excellent']

  async function submit() {
    if (!token) return
    setSaving(true); setError(null)
    try {
      const content: SubmitContent = {
        section1,
        section2: {
          compare_to_tech: compareToTech.trim(),
          comparison,
          comparison_reason: comparisonReason.trim(),
        },
        section3: {
          star_rating: starRating,
          most_valuable: mostValuable.trim(),
          would_change: wouldChange.trim(),
          would_recommend: wouldRecommend,
        },
      }
      await api.post(`/coaching/feedback/${token}/submit`, { content })
      setDone(true)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string | { message?: string } } } })
        ?.response?.data?.detail
      const msg = typeof detail === 'string' ? detail : (detail?.message || 'Submission failed. Please try again.')
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Link not found</h1>
          <p className="text-sm text-slate-500">This feedback link isn&apos;t valid. Please check with your coach.</p>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="max-w-md w-full bg-white border border-emerald-200 rounded-xl p-8 text-center">
          <div className="text-5xl mb-3">✓</div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Thank you</h1>
          <p className="text-sm text-slate-600">
            Your feedback has been received. Your certificate is now with your coach for issuance.
          </p>
        </div>
      </div>
    )
  }

  const moment1Keys = form ? Object.keys(form.moment1_answers || {}) : []
  const hasMoment1 = moment1Keys.length > 0

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
          <h1 className="text-xl font-bold text-slate-900 mb-1">Your experience of the Coaching Program</h1>
          <p className="text-sm text-slate-600 mb-2">
            Hi {form?.student_name}, thank you for taking the time to share your experience.
          </p>
          <p className="text-xs text-slate-500 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
            <strong>Take your time.</strong> Your honest answers help us build RootsTalk better.
            Your coach can see that you&apos;ve submitted this, but cannot read your answers until after your certificate is issued.
          </p>
        </div>

        {/* Section 1: Mirror of Moment 1 */}
        {hasMoment1 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
            <h2 className="text-base font-semibold text-slate-900 mb-3">Looking back at what you said at the start</h2>
            <div className="space-y-5">
              {moment1Keys.map(key => {
                const original = form!.moment1_answers[key]
                if (!original || !original.trim()) return null
                const resp = section1[key] || { mode: null, text: '' }
                return (
                  <div key={key} className="border-l-4 border-slate-200 pl-4">
                    <p className="text-xs text-slate-500 italic mb-1">You said:</p>
                    <p className="text-sm text-slate-800 mb-3">&ldquo;{original}&rdquo;</p>
                    <div className="flex flex-col gap-2 mb-2">
                      {[
                        { v: 'changed' as const, label: 'I see this differently now' },
                        { v: 'helped' as const, label: 'RootsTalk helped me think about this' },
                        { v: 'not_addressed' as const, label: 'RootsTalk didn\'t address this' },
                      ].map(opt => (
                        <label key={opt.v} className="flex items-start gap-2 cursor-pointer text-sm">
                          <input type="radio"
                            checked={resp.mode === opt.v}
                            onChange={() => setSection1({
                              ...section1,
                              [key]: { ...resp, mode: opt.v },
                            })}
                            className="mt-0.5"
                          />
                          <span className="text-slate-700">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                    {resp.mode && (
                      <textarea
                        value={resp.text}
                        onChange={e => setSection1({ ...section1, [key]: { ...resp, text: e.target.value } })}
                        placeholder="Share more if you'd like (optional)"
                        rows={2}
                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Section 2: Benchmark */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            Compared to apps or tech you like
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                Think of an app or technology you really like (optional)
              </label>
              <input type="text" value={compareToTech}
                onChange={e => setCompareToTech(e.target.value)}
                placeholder="e.g., WhatsApp, Google Maps, YouTube..."
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">
                How does RootsTalk compare?
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {(Object.keys(COMPARE_LABELS) as (keyof typeof COMPARE_LABELS)[]).map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setComparison(key as SubmitContent['section2']['comparison'])}
                    className={`text-[11px] px-1 py-2 rounded border text-center ${
                      comparison === key
                        ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}>
                    {COMPARE_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                What makes the comparison go that way?
              </label>
              <textarea value={comparisonReason}
                onChange={e => setComparisonReason(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
        </div>

        {/* Section 3: Open feedback */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">Overall</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">
                How would you rate the Coaching Program overall?
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map(n => {
                  const filled = starHover > 0 ? n <= starHover : n <= starRating
                  return (
                    <button key={n} type="button"
                      onMouseEnter={() => setStarHover(n)}
                      onMouseLeave={() => setStarHover(0)}
                      onClick={() => setStarRating(n)}
                      className="text-3xl leading-none">
                      <span className={filled ? 'text-amber-400' : 'text-slate-300'}>★</span>
                    </button>
                  )
                })}
                {(starHover || starRating) > 0 && (
                  <span className="text-xs text-slate-500 ml-2">
                    {starLabels[(starHover || starRating) - 1]}
                  </span>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                What was most valuable to you?
              </label>
              <textarea value={mostValuable}
                onChange={e => setMostValuable(e.target.value)}
                rows={2}
                placeholder="Optional — I'd rather not say is OK"
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                What would you change if you could?
              </label>
              <textarea value={wouldChange}
                onChange={e => setWouldChange(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">
                Would you tell a friend to try RootsTalk?
              </label>
              <div className="flex gap-2">
                {(['yes', 'maybe', 'no'] as const).map(v => (
                  <button key={v} type="button"
                    onClick={() => setWouldRecommend(v)}
                    className={`flex-1 text-sm px-3 py-2 rounded border capitalize ${
                      wouldRecommend === v
                        ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full bg-emerald-700 text-white font-medium py-3 rounded-lg hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? 'Submitting…' : 'Submit feedback'}
        </button>

        <p className="text-xs text-center text-slate-400 mt-4">
          Submission is final. If anything comes up later, contact your coach directly.
        </p>
      </div>
    </div>
  )
}
