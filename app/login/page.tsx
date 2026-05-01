'use client'
import { useState, FormEvent, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { login, getToken, setClient, CPClient } from '@/lib/auth'
import api from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [shortName, setShortName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [branding, setBranding] = useState<CPClient | null>(null)
  const [step, setStep] = useState<'company' | 'credentials'>('company')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (getToken()) router.replace('/dashboard')
  }, [router])

  async function lookupCompany(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data } = await api.get<CPClient>(`/portal/${shortName.toLowerCase()}/branding`)
      setBranding(data)
      setStep('credentials')
    } catch {
      setError('Company not found. Check your company short name.')
    } finally { setLoading(false) }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(email, password)
      if (branding) setClient({ ...branding, short_name: shortName.toLowerCase() })
      router.replace('/dashboard')
    } catch {
      setError('Invalid email or password.')
    } finally { setLoading(false) }
  }

  const colour = branding?.primary_colour || '#1A5C2A'

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12"
        style={{ background: `linear-gradient(135deg, ${colour}dd, ${colour})` }}>
        <div>
          {branding?.logo_url
            ? <img src={branding.logo_url} alt="logo" className="h-12 mb-8 object-contain" />
            : <div className="w-12 h-12 rounded-xl bg-white/20 mb-8 flex items-center justify-center">
                <span className="text-white text-xl font-bold">{branding?.display_name?.[0] || 'R'}</span>
              </div>
          }
          <h1 className="text-3xl font-bold text-white leading-tight">
            {branding?.display_name || 'RootsTalk'}
          </h1>
          {branding?.tagline && <p className="text-white/70 text-sm mt-2">{branding.tagline}</p>}
          {!branding && <p className="text-white/70 text-sm mt-2">Client Portal</p>}
        </div>
        <p className="text-white/50 text-xs">Powered by RootsTalk · Neytiri Eywafarm Agritech</p>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-sm">

          {step === 'company' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
                <p className="text-slate-500 text-sm mt-1">Enter your company short name to continue</p>
              </div>
              <form onSubmit={lookupCompany} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Company short name</label>
                  <input value={shortName} onChange={e => setShortName(e.target.value)}
                    required autoFocus placeholder="e.g. acmeagri"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <p className="text-xs text-slate-400 mt-1">This is the unique name assigned by RootsTalk admin</p>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button type="submit" disabled={loading || !shortName}
                  className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #065f46, #059669)' }}>
                  {loading ? 'Looking up…' : 'Continue'}
                </button>
              </form>
            </>
          )}

          {step === 'credentials' && (
            <>
              <div className="mb-8">
                <button onClick={() => { setStep('company'); setBranding(null); setError('') }}
                  className="text-slate-400 text-sm hover:text-slate-600 mb-3">← Change company</button>
                <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
                <p className="text-slate-500 text-sm mt-1">{branding?.display_name} · Client Portal</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="you@company.com"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': colour } as React.CSSProperties} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    required placeholder="••••••••"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': colour } as React.CSSProperties} />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          <p className="text-center text-xs text-slate-400 mt-10">Neytiri Eywafarm Agritech Pvt Ltd</p>
        </div>
      </div>
    </div>
  )
}
