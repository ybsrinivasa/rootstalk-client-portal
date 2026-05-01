'use client'
import { useEffect, useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'

interface OnboardingContext {
  full_name: string; short_name: string; ca_name: string; ca_email: string; is_manufacturer: boolean
}

const ORG_TYPES = [
  { id: 'org_type_seed_companies',   label: 'Seed Companies',                  unlocks: 'Seed module' },
  { id: 'org_type_pesticide_mfr',    label: 'Pesticide Manufacturer',           unlocks: null },
  { id: 'org_type_fertiliser_mfr',   label: 'Fertiliser Manufacturer',          unlocks: null },
  { id: 'org_type_agri_university',  label: 'Agricultural University / KVK',    unlocks: null },
  { id: 'org_type_govt_dept',        label: 'Government Line Department',        unlocks: null },
  { id: 'org_type_nonprofit',        label: 'Not-for-profit',                   unlocks: null },
  { id: 'org_type_private_company',  label: 'Private Company',                  unlocks: null },
  { id: 'org_type_research_inst',    label: 'Research Institution / Commodity Board', unlocks: null },
]

export default function OnboardingPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [ctx, setCtx] = useState<OnboardingContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    display_name: '',
    tagline: '',
    primary_colour: '#1A5C2A',
    secondary_colour: '#854F0B',
    hq_address: '',
    gst_number: '',
    pan_number: '',
    website: '',
    support_phone: '',
    office_phone: '',
    org_type_cosh_ids: [] as string[],
  })

  useEffect(() => {
    api.get<OnboardingContext>(`/onboarding/${token}`)
      .then(r => {
        setCtx(r.data)
        setForm(f => ({ ...f, display_name: r.data.full_name.split(' ').slice(0, 3).join(' ') }))
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false))
  }, [token])

  function toggleOrgType(id: string) {
    setForm(f => ({
      ...f,
      org_type_cosh_ids: f.org_type_cosh_ids.includes(id)
        ? f.org_type_cosh_ids.filter(x => x !== id)
        : [...f.org_type_cosh_ids, id],
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError('')
    try {
      await api.post(`/onboarding/${token}/submit`, form)
      setDone(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Submission failed. Please check all fields and try again.')
    } finally { setSubmitting(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (invalid) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-sm border border-slate-100">
        <span className="text-4xl">⚠️</span>
        <h1 className="text-xl font-bold text-slate-900 mt-4">Link not found or expired</h1>
        <p className="text-slate-500 text-sm mt-2">
          This onboarding link is invalid or has expired. Please contact your RootsTalk account manager for a new link.
        </p>
      </div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-sm border border-slate-100">
        <span className="text-5xl">🌾</span>
        <h1 className="text-xl font-bold text-slate-900 mt-4">Registration submitted!</h1>
        <p className="text-slate-500 text-sm mt-2">
          Thank you, {ctx?.ca_name}. Your company details have been submitted to RootsTalk for review.
          You will receive your login credentials by email once approved — usually within 1 working day.
        </p>
        <p className="text-xs text-slate-400 mt-4">Powered by RootsTalk · Neytiri Eywafarm Agritech</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-green-700 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">R</div>
          <h1 className="text-2xl font-bold text-slate-900">Complete your company registration</h1>
          <p className="text-slate-500 text-sm mt-1">
            Welcome, <strong>{ctx?.ca_name}</strong>. Please fill in your company details below.
          </p>
          <div className="inline-block bg-green-50 border border-green-200 rounded-xl px-4 py-2 mt-3">
            <p className="text-green-800 text-sm">Registering: <strong>{ctx?.full_name}</strong></p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Display & Branding */}
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
            <h2 className="font-semibold text-slate-800">Display & Branding</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Display Name <span className="text-red-500">*</span></label>
              <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                required placeholder="How farmers see your company name"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              <p className="text-xs text-slate-400 mt-1">This is shown on farmer-facing screens</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Tagline</label>
              <input value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
                placeholder="e.g. Growing trust, field by field"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Primary Colour</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.primary_colour}
                    onChange={e => setForm(f => ({ ...f, primary_colour: e.target.value }))}
                    className="h-10 w-16 rounded-lg border border-slate-200 cursor-pointer" />
                  <span className="text-sm font-mono text-slate-600">{form.primary_colour}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Secondary Colour</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.secondary_colour}
                    onChange={e => setForm(f => ({ ...f, secondary_colour: e.target.value }))}
                    className="h-10 w-16 rounded-lg border border-slate-200 cursor-pointer" />
                  <span className="text-sm font-mono text-slate-600">{form.secondary_colour}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Legal Details */}
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
            <h2 className="font-semibold text-slate-800">Legal Details</h2>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">GST Number <span className="text-red-500">*</span></label>
              <input value={form.gst_number} onChange={e => setForm(f => ({ ...f, gst_number: e.target.value.toUpperCase() }))}
                required maxLength={15} minLength={15} placeholder="15-character GST number"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono uppercase" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">PAN Number <span className="text-red-500">*</span></label>
              <input value={form.pan_number} onChange={e => setForm(f => ({ ...f, pan_number: e.target.value.toUpperCase() }))}
                required maxLength={10} minLength={10} placeholder="10-character PAN"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono uppercase" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Registered Address <span className="text-red-500">*</span></label>
              <textarea value={form.hq_address} onChange={e => setForm(f => ({ ...f, hq_address: e.target.value }))}
                required rows={3} placeholder="Full registered office address"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
            </div>
          </div>

          {/* Contact */}
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
            <h2 className="font-semibold text-slate-800">Contact & Web</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Support Phone</label>
                <input value={form.support_phone} onChange={e => setForm(f => ({ ...f, support_phone: e.target.value }))}
                  placeholder="+91XXXXXXXXXX"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Office Phone</label>
                <input value={form.office_phone} onChange={e => setForm(f => ({ ...f, office_phone: e.target.value }))}
                  placeholder="+91XXXXXXXXXX"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Website</label>
              <input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                placeholder="https://yourcompany.in"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>

          {/* Organisation Types */}
          <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-3">
            <h2 className="font-semibold text-slate-800">Organisation Type(s) <span className="text-red-500">*</span></h2>
            <p className="text-slate-500 text-sm">Select all that apply. This determines which modules are available.</p>
            {ORG_TYPES.map(org => (
              <label key={org.id} className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-slate-50">
                <input type="checkbox"
                  checked={form.org_type_cosh_ids.includes(org.id)}
                  onChange={() => toggleOrgType(org.id)}
                  className="w-4 h-4 rounded accent-green-600" />
                <div>
                  <span className="text-sm text-slate-800">{org.label}</span>
                  {org.unlocks && (
                    <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Unlocks {org.unlocks}</span>
                  )}
                </div>
              </label>
            ))}
            {form.org_type_cosh_ids.length === 0 && (
              <p className="text-xs text-red-500">Please select at least one organisation type.</p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <button type="submit"
            disabled={submitting || form.org_type_cosh_ids.length === 0}
            className="w-full py-4 rounded-2xl text-white font-bold text-base disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #065f46, #1A5C2A)' }}>
            {submitting ? 'Submitting…' : 'Submit Company Registration →'}
          </button>

          <p className="text-center text-xs text-slate-400">
            By submitting, you confirm that all information is accurate and you are authorised to register this company.
            <br />Powered by RootsTalk · Neytiri Eywafarm Agritech Pvt Ltd
          </p>
        </form>
      </div>
    </div>
  )
}
