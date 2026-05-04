'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface PoolBalance { balance: number }
interface Quote {
  units: number
  gross_paise: number
  discount_paise: number
  total_paise: number
  per_unit_effective_paise: number
  min_units: number
  max_units: number
  gross_rupees: string
  discount_rupees: string
  total_rupees: string
}

function formatINR(rupees: number | string): string {
  const n = typeof rupees === 'string' ? parseFloat(rupees) : rupees
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

export default function SubscriptionPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [units, setUnits] = useState('100')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [purchasing, setPurchasing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadBalance = () => {
    if (!clientId) return
    api.get<PoolBalance>(`/client/${clientId}/subscription-pool/balance`)
      .then(r => setBalance(r.data.balance))
      .catch(() => setBalance(0))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadBalance() }, [clientId])

  // Live price preview — fetch a quote on every change to `units`,
  // debounced 250ms so we don't spam the API on each keystroke.
  useEffect(() => {
    if (!clientId) return
    const n = parseInt(units)
    if (!Number.isFinite(n) || n < 1) {
      setQuote(null); setQuoteError(''); return
    }
    const handle = setTimeout(() => {
      api.get<Quote>(`/client/${clientId}/subscription-pool/quote`, {
        params: { units: n },
      })
        .then(r => { setQuote(r.data); setQuoteError('') })
        .catch((err: unknown) => {
          const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          setQuote(null)
          setQuoteError(msg || 'Could not calculate price for this quantity.')
        })
    }, 250)
    return () => clearTimeout(handle)
  }, [units, clientId])

  async function handlePurchase(e: FormEvent) {
    e.preventDefault()
    setPurchasing(true); setError(''); setSuccess('')
    try {
      const n = parseInt(units)
      await api.post(`/client/${clientId}/subscription-pool/purchase`, { units: n })
      setSuccess(`Successfully added ${n} subscription units to your pool.`)
      setUnits('100')
      loadBalance()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to purchase units.')
    } finally { setPurchasing(false) }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Subscription Pool</h1>
        <p className="text-slate-500 text-sm mt-0.5">Manage subscription units for farmer onboarding</p>
      </div>

      {/* Balance card */}
      <div className="rounded-2xl p-8 text-white"
        style={{ background: `linear-gradient(135deg, ${colour}dd, ${colour})` }}>
        <p className="text-white/70 text-sm">Available Units</p>
        <p className="text-5xl font-bold mt-1">{loading ? '…' : balance?.toLocaleString()}</p>
        <p className="text-white/60 text-sm mt-2">
          Each unit allows one farmer to subscribe to one Package of Practices
        </p>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-3">How subscription units work</h3>
        <div className="space-y-3 text-sm text-slate-600">
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">1</span>
            <p>Purchase units in advance into your pool</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">2</span>
            <p>When a farmer subscribes to one of your packages, one unit is consumed from your pool</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">3</span>
            <p>The farmer receives daily advisory notifications for the package duration</p>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">!</span>
            <p>Keep your pool topped up — new subscriptions cannot be activated if the pool is empty</p>
          </div>
        </div>
      </div>

      {/* Purchase form */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-800 mb-4">Add Units to Pool</h3>
        <form onSubmit={handlePurchase} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Number of Units</label>
            <input type="number" min="1" value={units} onChange={e => setUnits(e.target.value)}
              required
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <p className="text-xs text-slate-400 mt-1">Minimum: 1 unit</p>
          </div>

          {/* Quick select */}
          <div className="flex gap-2 flex-wrap">
            {['50', '100', '250', '500', '1000'].map(n => (
              <button key={n} type="button" onClick={() => setUnits(n)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${units === n ? 'border-transparent text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}
                style={units === n ? { background: colour } : {}}>
                {n}
              </button>
            ))}
          </div>

          {/* Live price quote */}
          {quote && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-sm space-y-1.5">
              <div className="flex justify-between text-slate-600">
                <span>{quote.units.toLocaleString('en-IN')} units × ₹199</span>
                <span>₹{formatINR(quote.gross_rupees)}</span>
              </div>
              {quote.discount_paise > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Volume discount</span>
                  <span>− ₹{formatINR(quote.discount_rupees)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold text-slate-900">
                <span>Total payable</span>
                <span>₹{formatINR(quote.total_rupees)}</span>
              </div>
              {quote.units > 1 && (
                <p className="text-xs text-slate-500 pt-1">
                  Effective price: ₹{formatINR(quote.per_unit_effective_paise / 100)} per unit
                </p>
              )}
            </div>
          )}
          {quoteError && <p className="text-sm text-amber-700">{quoteError}</p>}

          {/* Non-refundable notice */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span className="font-semibold">Please note: </span>
            Pool top-ups are <span className="font-semibold">non-refundable</span>.
            Once purchased, units stay in your pool until allocated to a farmer subscription.
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-700">{success}</p>}

          <button type="submit" disabled={purchasing || !quote}
            className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            {purchasing
              ? 'Processing…'
              : quote
                ? `Pay ₹${formatINR(quote.total_rupees)} for ${quote.units.toLocaleString('en-IN')} units`
                : `Add ${parseInt(units) || 0} Units to Pool`}
          </button>
        </form>
      </div>
    </div>
  )
}
