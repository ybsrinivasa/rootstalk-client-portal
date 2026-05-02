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
  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotOtp, setForgotOtp] = useState('')
  const [forgotNew, setForgotNew] = useState('')
  const [forgotStage, setForgotStage] = useState<'email' | 'otp' | 'done'>('email')
  const [info, setInfo] = useState('')
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

  async function sendOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/admin/request-email-otp', { email, purpose: 'LOGIN' })
      setOtpSent(true)
      setInfo(`A 6-digit code was sent to ${email}`)
    } catch { setError('Could not send OTP') } finally { setLoading(false) }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data } = await api.post<{ access_token: string }>('/auth/admin/verify-email-otp', { email, otp_code: otpCode })
      localStorage.setItem('rt_cp_token', data.access_token)
      const me = await api.get('/auth/me')
      localStorage.setItem('rt_cp_user', JSON.stringify((me as { data: unknown }).data))
      if (branding) setClient({ ...branding, short_name: shortName.toLowerCase() })
      router.replace('/dashboard')
    } catch { setError('Invalid or expired code') } finally { setLoading(false) }
  }

  async function sendForgotOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/admin/forgot-password', { email })
      setForgotStage('otp')
      setInfo(`Reset code sent to ${email}`)
    } catch { setError('Could not send reset code') } finally { setLoading(false) }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/admin/reset-password', { email, otp_code: forgotOtp, new_password: forgotNew })
      setForgotStage('done')
      setInfo('Password reset. You can now sign in.')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Reset failed')
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

          {step === 'credentials' && !forgotMode && (
            <>
              <div className="mb-6">
                <button onClick={() => { setStep('company'); setBranding(null); setError('') }}
                  className="text-slate-400 text-sm hover:text-slate-600 mb-3">← Change company</button>
                <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
                <p className="text-slate-500 text-sm mt-1">{branding?.display_name} · Client Portal</p>
              </div>
              {/* Method toggle */}
              <div className="flex bg-slate-100 rounded-xl p-1 mb-5">
                <button onClick={() => { setLoginMethod('password'); setError('') }}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${loginMethod === 'password' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                  Password
                </button>
                <button onClick={() => { setLoginMethod('otp'); setError(''); setOtpSent(false) }}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${loginMethod === 'otp' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                  Email OTP
                </button>
              </div>
              {loginMethod === 'password' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="you@company.com"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    required placeholder="Password"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button type="button" onClick={() => { setForgotMode(true); setForgotStage('email') }}
                    className="w-full text-sm text-green-700 hover:underline text-center">
                    Forgot password?
                  </button>
                </form>
              )}
              {loginMethod === 'otp' && !otpSent && (
                <form onSubmit={sendOtp} className="space-y-4">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="your registered email"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Sending…' : 'Send OTP to my email'}
                  </button>
                </form>
              )}
              {loginMethod === 'otp' && otpSent && (
                <form onSubmit={verifyOtp} className="space-y-4">
                  {info && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-4 py-2">{info}</p>}
                  <input value={otpCode} onChange={e => setOtpCode(e.target.value)}
                    required autoFocus maxLength={6} placeholder="6-digit code"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Verifying…' : 'Verify & Sign in'}
                  </button>
                </form>
              )}
            </>
          )}

          {step === 'credentials' && forgotMode && (
            <div>
              <button onClick={() => { setForgotMode(false); setForgotStage('email'); setError(''); setInfo('') }}
                className="text-slate-400 text-sm hover:text-slate-600 mb-5 block">← Back to sign in</button>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Reset password</h2>
              {forgotStage === 'email' && (
                <form onSubmit={sendForgotOtp} className="space-y-4 mt-4">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="your registered email"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Sending…' : 'Send reset code'}
                  </button>
                </form>
              )}
              {forgotStage === 'otp' && (
                <form onSubmit={resetPassword} className="space-y-4 mt-4">
                  {info && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-4 py-2">{info}</p>}
                  <input value={forgotOtp} onChange={e => setForgotOtp(e.target.value)}
                    required autoFocus maxLength={6} placeholder="6-digit reset code"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-center tracking-widest focus:outline-none" />
                  <input type="password" value={forgotNew} onChange={e => setForgotNew(e.target.value)}
                    required placeholder="New password (min 8 chars)"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none" />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Resetting…' : 'Set new password'}
                  </button>
                </form>
              )}
              {forgotStage === 'done' && (
                <div className="mt-4 text-center">
                  <p className="text-3xl mb-3">✓</p>
                  <p className="text-green-700 font-semibold">{info}</p>
                  <button onClick={() => { setForgotMode(false); setForgotStage('email') }}
                    className="mt-4 text-sm text-green-700 underline">Sign in now</button>
                </div>
              )}
            </div>
          )}

          <p className="text-center text-xs text-slate-400 mt-10">Neytiri Eywafarm Agritech Pvt Ltd</p>
        </div>
      </div>
    </div>
  )
}
