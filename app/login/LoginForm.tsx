'use client'
import { useState, FormEvent, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { login, getToken, setClient, CPClient } from '@/lib/auth'
import api from '@/lib/api'

interface LoginFormProps {
  /**
   * When set, the form starts on the credentials step with branding
   * for this short_name auto-fetched. Reaching the form via
   * `/login/<shortName>` (the branded URL embedded in the CA's
   * credentials email) passes this prop; the generic `/login` route
   * leaves it undefined.
   *
   * If the auto-fetch returns 404 (CA mistyped or visited a stale
   * link), the form falls back to the company-name step with the
   * short_name pre-filled and an error message.
   */
  initialShortName?: string
}

export default function LoginForm({ initialShortName }: LoginFormProps) {
  const router = useRouter()
  const [shortName, setShortName] = useState(initialShortName || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [branding, setBranding] = useState<CPClient | null>(null)
  const [step, setStep] = useState<'company' | 'credentials'>(
    initialShortName ? 'credentials' : 'company',
  )
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

  // Branded entry: auto-fetch the company's branding so the
  // credentials step renders with the right logo + colours
  // immediately. On 404 (typo / stale URL) drop back to the company
  // step with the short_name pre-filled so the user can correct it
  // without losing their place.
  useEffect(() => {
    if (!initialShortName) return
    (async () => {
      setLoading(true)
      try {
        const { data } = await api.get<CPClient>(`/portal/${initialShortName}/branding`)
        setBranding(data)
      } catch {
        setStep('company')
        setError('Company not found. Check your company short name.')
      } finally {
        setLoading(false)
      }
    })()
  }, [initialShortName])

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
      await login(email, password, shortName.toLowerCase())
      if (branding) setClient(branding)
      router.replace('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Invalid email or password.')
    } finally { setLoading(false) }
  }

  async function sendOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await api.post('/auth/admin/request-email-otp', { email, purpose: 'LOGIN', client_short_name: shortName.toLowerCase() })
      setOtpSent(true)
      setInfo(`A 6-digit code was sent to ${email}`)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Could not send OTP')
    } finally { setLoading(false) }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { data } = await api.post<{ access_token: string }>('/auth/admin/verify-email-otp', {
        email, otp_code: otpCode, client_short_name: shortName.toLowerCase(),
      })
      localStorage.setItem('rt_cp_token', data.access_token)
      const me = await api.get('/auth/me')
      localStorage.setItem('rt_cp_user', JSON.stringify((me as { data: unknown }).data))
      if (branding) setClient(branding)
      router.replace('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Invalid or expired code')
    } finally { setLoading(false) }
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
  const inputCls = 'w-full border border-stone-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 bg-white text-stone-900 placeholder-stone-400'

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
      <div className="flex-1 flex items-center justify-center bg-[#F7F5F0] px-8 py-12">
        <div className="w-full max-w-sm">

          {/* RootsTalk wordmark (company step only) */}
          {step === 'company' && (
            <div className="mb-8 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-stone-200">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3" fill="#57534e"/>
                  <circle cx="4" cy="6" r="2" fill="#57534e" opacity="0.6"/>
                  <circle cx="20" cy="18" r="2" fill="#57534e" opacity="0.6"/>
                  <line x1="12" y1="12" x2="4" y2="6" stroke="#57534e" strokeWidth="1.5"/>
                  <line x1="12" y1="12" x2="20" y2="18" stroke="#57534e" strokeWidth="1.5"/>
                </svg>
              </div>
              <span className="text-stone-400 text-xs font-medium tracking-widest uppercase">RootsTalk</span>
            </div>
          )}

          {step === 'company' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-stone-900">Sign in</h2>
                <p className="text-stone-500 text-sm mt-1">Enter your company identifier to continue</p>
              </div>
              <form onSubmit={lookupCompany} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1.5">Company short name</label>
                  <input value={shortName} onChange={e => setShortName(e.target.value)}
                    required autoFocus placeholder="e.g. acmeagri"
                    className={inputCls} />
                  <p className="text-xs text-stone-400 mt-1.5">Your unique name as assigned by RootsTalk</p>
                </div>
                {error && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
                )}
                <button type="submit" disabled={loading || !shortName}
                  className="w-full text-white font-semibold py-3 rounded-lg text-sm tracking-wide disabled:opacity-50"
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
                  className="text-stone-400 text-sm hover:text-stone-600 mb-3">← Change company</button>
                <h2 className="text-2xl font-bold text-stone-900">Welcome back</h2>
                <p className="text-stone-500 text-sm mt-1">{branding?.display_name || shortName} · Client Portal</p>
              </div>
              {/* Method toggle */}
              <div className="flex bg-stone-200 rounded-lg p-1 mb-5">
                <button onClick={() => { setLoginMethod('password'); setError('') }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${loginMethod === 'password' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500'}`}>
                  Password
                </button>
                <button onClick={() => { setLoginMethod('otp'); setError(''); setOtpSent(false) }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${loginMethod === 'otp' ? 'bg-white shadow-sm text-stone-800' : 'text-stone-500'}`}>
                  Email OTP
                </button>
              </div>

              {loginMethod === 'password' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="you@company.com"
                    className={inputCls} />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    required placeholder="Password"
                    className={inputCls} />
                  {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white font-semibold py-3 rounded-lg text-sm tracking-wide disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button type="button" onClick={() => { setForgotMode(true); setForgotStage('email') }}
                    className="w-full text-sm text-stone-500 hover:text-stone-700 text-center">
                    Forgot password?
                  </button>
                </form>
              )}

              {loginMethod === 'otp' && !otpSent && (
                <form onSubmit={sendOtp} className="space-y-4">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="your registered email"
                    className={inputCls} />
                  {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white font-semibold py-3 rounded-lg text-sm tracking-wide disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Sending…' : 'Send OTP to my email'}
                  </button>
                </form>
              )}

              {loginMethod === 'otp' && otpSent && (
                <form onSubmit={verifyOtp} className="space-y-4">
                  {info && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">{info}</div>}
                  <input value={otpCode} onChange={e => setOtpCode(e.target.value)}
                    required autoFocus maxLength={6} placeholder="6-digit code"
                    className={`${inputCls} font-mono text-center tracking-widest`} />
                  {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white font-semibold py-3 rounded-lg text-sm tracking-wide disabled:opacity-50"
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
                className="text-stone-400 text-sm hover:text-stone-600 mb-5 block">← Back to sign in</button>
              <h2 className="text-xl font-bold text-stone-900 mb-1">Reset password</h2>

              {forgotStage === 'email' && (
                <form onSubmit={sendForgotOtp} className="space-y-4 mt-4">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required autoFocus placeholder="your registered email"
                    className={inputCls} />
                  {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white py-3 rounded-lg text-sm font-semibold tracking-wide disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Sending…' : 'Send reset code'}
                  </button>
                </form>
              )}

              {forgotStage === 'otp' && (
                <form onSubmit={resetPassword} className="space-y-4 mt-4">
                  {info && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">{info}</div>}
                  <input value={forgotOtp} onChange={e => setForgotOtp(e.target.value)}
                    required autoFocus maxLength={6} placeholder="6-digit reset code"
                    className={`${inputCls} font-mono text-center tracking-widest`} />
                  <input type="password" value={forgotNew} onChange={e => setForgotNew(e.target.value)}
                    required placeholder="New password (min 8 chars)"
                    className={inputCls} />
                  {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>}
                  <button type="submit" disabled={loading}
                    className="w-full text-white py-3 rounded-lg text-sm font-semibold tracking-wide disabled:opacity-50"
                    style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                    {loading ? 'Resetting…' : 'Set new password'}
                  </button>
                </form>
              )}

              {forgotStage === 'done' && (
                <div className="mt-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-green-700 font-semibold">{info}</p>
                  <button onClick={() => { setForgotMode(false); setForgotStage('email') }}
                    className="mt-4 text-sm text-stone-600 hover:underline">Sign in now</button>
                </div>
              )}
            </div>
          )}

          <p className="text-center text-xs text-stone-400 mt-10">Neytiri Eywafarm Agritech Pvt Ltd</p>
        </div>
      </div>
    </div>
  )
}
