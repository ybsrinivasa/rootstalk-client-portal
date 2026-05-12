'use client'
import { useEffect, useState, useRef, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient, getToken } from '@/lib/auth'

// ── Colour distance helper ────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return null
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}
function euclidean(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}
const ROLE_COLOURS: Record<string, [number, number, number]> = {
  Farmer:      [26,  92,  42],
  Dealer:      [8,   80,  65],
  Facilitator: [125, 78,  0],
  FarmPundit:  [60,  52, 137],
}
function colourWarning(hex: string): string | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  for (const [role, ref] of Object.entries(ROLE_COLOURS)) {
    if (euclidean(rgb, ref) < 60) {
      return `This colour is very close to the ${role} role colour. Consider a more distinct shade.`
    }
  }
  return null
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SocialLinks {
  twitter?: string; instagram?: string; linkedin?: string
  facebook?: string; youtube?: string
}

interface ProfileData {
  display_name: string
  tagline: string | null
  primary_colour: string
  secondary_colour: string | null
  logo_url: string | null
  hq_address: string | null
  support_phone: string | null
  office_phone: string | null
  website: string | null
  social_links: SocialLinks | null
  // read-only
  gst_number: string | null
  pan_number: string | null
  org_type_labels: string[]
  status: string
  approved_at: string | null
  ca_name: string | null
  ca_email: string | null
}

const ORG_TYPE_MAP: Record<string, string> = {
  org_type_seed_companies:         'Seed Companies',
  org_type_pesticide_manufacturer: 'Pesticide Manufacturer',
  org_type_fertiliser_company:     'Fertiliser Company',
  org_type_agrochemical:           'Agrochemical',
  org_type_input_distributor:      'Input Distributor',
  org_type_fpo:                    'FPO / Co-operative',
  org_type_government:             'Government Body',
  org_type_ngo:                    'NGO',
}

function InfoCard({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="bg-stone-50 border border-stone-100 rounded-lg px-4 py-3">
      <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-stone-700">{value || '—'}</p>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-4 pb-2 border-b border-stone-200">{children}</h2>
}

export default function ProfilePage() {
  const client = getClient()
  const clientId = client?.id

  const [form, setForm] = useState<ProfileData>({
    display_name: '', tagline: null, primary_colour: '#1A5C2A', secondary_colour: null,
    logo_url: null, hq_address: null, support_phone: null, office_phone: null,
    website: null, social_links: null,
    gst_number: null, pan_number: null, org_type_labels: [],
    status: '', approved_at: null, ca_name: null, ca_email: null,
  })
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Colour warnings
  const primaryWarn = colourWarning(form.primary_colour)
  const secondaryWarn = form.secondary_colour ? colourWarning(form.secondary_colour) : null

  useEffect(() => {
    if (!clientId) return
    api.get<ProfileData>(`/client/${clientId}/profile`)
      .then(res => setForm(res.data))
      .catch(() => setLoadError('Could not load profile. Please refresh.'))
  }, [clientId])

  function set<K extends keyof ProfileData>(key: K, value: ProfileData[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    setSaveSuccess(false)
    setSaveError('')
  }

  function setSocial(platform: keyof SocialLinks, value: string) {
    setForm(prev => ({
      ...prev,
      social_links: { ...(prev.social_links || {}), [platform]: value || undefined },
    }))
  }

  async function uploadLogo(file: File) {
    setLogoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'logos')
      const token = getToken()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      set('logo_url', data.url)
    } catch {
      setSaveError('Logo upload failed. Please try again.')
    } finally {
      setLogoUploading(false)
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setSaveSuccess(false); setSaveError('')
    try {
      await api.put(`/client/${clientId}/profile`, {
        display_name: form.display_name,
        tagline:       form.tagline,
        primary_colour:   form.primary_colour,
        secondary_colour: form.secondary_colour,
        logo_url:      form.logo_url,
        hq_address:    form.hq_address,
        support_phone: form.support_phone,
        office_phone:  form.office_phone,
        website:       form.website,
        social_links:  form.social_links,
      })
      setSaveSuccess(true)
    } catch (err: unknown) {
      setSaveError(extractErrorMessage(err, 'Save failed. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{loadError}</div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Company Profile</h1>
        <p className="text-stone-500 text-sm mt-1">Update your company branding and contact information</p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">

        {/* ── Brand Identity ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <SectionTitle>Brand Identity</SectionTitle>
          <div className="space-y-6">

            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">Logo</label>
              <div className="flex items-center gap-4">
                {form.logo_url
                  ? <img src={form.logo_url} alt="logo" className="h-16 w-16 rounded-xl object-contain border border-stone-200 bg-stone-50" />
                  : <div className="h-16 w-16 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400 text-xs">No logo</div>
                }
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={logoUploading}
                    className="px-3 py-1.5 text-sm font-medium bg-white border border-stone-200 rounded-lg hover:bg-stone-50 text-stone-700 disabled:opacity-50">
                    {logoUploading ? 'Uploading…' : 'Upload'}
                  </button>
                  {form.logo_url && (
                    <button type="button"
                      onClick={() => set('logo_url', null)}
                      className="px-3 py-1.5 text-sm font-medium bg-white border border-stone-200 rounded-lg hover:bg-red-50 hover:border-red-200 text-red-600">
                      Remove
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f) }} />
              </div>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Display Name <span className="text-red-500">*</span></label>
              <input required value={form.display_name}
                onChange={e => set('display_name', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
            </div>

            {/* Tagline */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Tagline <span className="text-stone-400 font-normal">(optional)</span></label>
              <input value={form.tagline || ''}
                onChange={e => set('tagline', e.target.value || null)}
                placeholder="A short phrase that describes your company"
                className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
            </div>

            {/* Primary Colour */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Primary Colour</label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.primary_colour}
                  onChange={e => set('primary_colour', e.target.value)}
                  className="h-10 w-14 rounded-lg border border-stone-200 cursor-pointer p-0.5 bg-white" />
                <input value={form.primary_colour}
                  onChange={e => set('primary_colour', e.target.value)}
                  placeholder="#1A5C2A" maxLength={7}
                  className="w-28 border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
                <div className="h-8 w-8 rounded-lg border border-stone-200" style={{ background: form.primary_colour }} />
              </div>
              {primaryWarn && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{primaryWarn}</p>
              )}
            </div>

            {/* Secondary Colour */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Secondary Colour <span className="text-stone-400 font-normal">(optional)</span></label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.secondary_colour || '#C4994A'}
                  onChange={e => set('secondary_colour', e.target.value)}
                  className="h-10 w-14 rounded-lg border border-stone-200 cursor-pointer p-0.5 bg-white" />
                <input value={form.secondary_colour || ''}
                  onChange={e => set('secondary_colour', e.target.value || null)}
                  placeholder="#C4994A" maxLength={7}
                  className="w-28 border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
                {form.secondary_colour && (
                  <div className="h-8 w-8 rounded-lg border border-stone-200" style={{ background: form.secondary_colour }} />
                )}
              </div>
              {secondaryWarn && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{secondaryWarn}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Contact & Web ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <SectionTitle>Contact &amp; Web</SectionTitle>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">HQ Address</label>
              <textarea rows={3} value={form.hq_address || ''}
                onChange={e => set('hq_address', e.target.value || null)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 resize-y bg-white" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Support Phone</label>
                <input value={form.support_phone || ''} onChange={e => set('support_phone', e.target.value || null)}
                  placeholder="+91 9000000000"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1.5">Office Phone</label>
                <input value={form.office_phone || ''} onChange={e => set('office_phone', e.target.value || null)}
                  placeholder="+91 4400000000"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1.5">Website</label>
              <input type="url" value={form.website || ''} onChange={e => set('website', e.target.value || null)}
                placeholder="https://www.yourcompany.com"
                className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
            </div>
          </div>
        </div>

        {/* ── Social Media ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <SectionTitle>Social Media</SectionTitle>
          <div className="space-y-4">
            {(['twitter', 'instagram', 'linkedin', 'facebook', 'youtube'] as (keyof SocialLinks)[]).map(platform => (
              <div key={platform}>
                <label className="block text-sm font-medium text-stone-700 mb-1.5 capitalize">{platform}</label>
                <input type="url" value={form.social_links?.[platform] || ''}
                  onChange={e => setSocial(platform, e.target.value)}
                  placeholder={`https://${platform}.com/yourpage`}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white" />
              </div>
            ))}
          </div>
        </div>

        {/* ── Read-only Info ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <SectionTitle>Organisation Details</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoCard label="GST Number" value={form.gst_number} />
            <InfoCard label="PAN Number" value={form.pan_number} />
            <InfoCard label="Status" value={form.status} />
            <InfoCard label="Approved At" value={form.approved_at ? new Date(form.approved_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : null} />
            <InfoCard label="CA Name" value={form.ca_name} />
            <InfoCard label="CA Email" value={form.ca_email} />
            {form.org_type_labels?.length > 0 && (
              <div className="sm:col-span-2 bg-stone-50 border border-stone-100 rounded-lg px-4 py-3">
                <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">Organisation Types</p>
                <div className="flex flex-wrap gap-2">
                  {form.org_type_labels.map(label => (
                    <span key={label} className="px-2.5 py-1 bg-white border border-stone-200 rounded-full text-xs text-stone-600 font-medium">{label}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Save button ───────────────────────────────────────────────────── */}
        <div className="pb-8">
          {saveSuccess && (
            <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm">
              Profile saved successfully.
            </div>
          )}
          {saveError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{saveError}</div>
          )}
          <button type="submit" disabled={saving || logoUploading}
            className="px-6 py-2.5 text-white font-semibold rounded-lg text-sm disabled:opacity-50 transition-opacity"
            style={{ background: form.primary_colour || '#1A5C2A' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
