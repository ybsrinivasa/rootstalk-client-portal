'use client'
import { useState, useEffect, useRef } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'

interface PortfolioItem { id: string; product_type: string; brand_cosh_id: string | null; variety_id: string | null; display_name: string }
interface QRCode { id: string; product_type: string; product_display_name: string; batch_lot_number: string; manufacture_date: string; expiry_date: string; status: string; created_at: string; scan_count: number; mismatch_count: number }
interface BrandSearchResult { cosh_id: string; name: string; manufacturer: string | null; product_type: string }
interface MismatchEntry { scan_id: string; scanned_at: string; farmer_name: string | null; farmer_district: string | null; expected_product: string; scanned_brand_cosh_id: string | null; batch_lot_number: string; scan_attempt: number }
interface BulkResult { summary: { generated: number; skipped_duplicates: number; failed: number }; rows: { row: number; status: string; reason?: string; display_name: string }[] }

const PRODUCT_TYPES = ['PESTICIDE', 'FERTILISER', 'SEED']
const TABS = ['codes', 'portfolio', 'mismatches'] as const
type Tab = typeof TABS[number]

export default function QRModulePage() {
  const client = getClient()
  const clientId = client?.id
  const [tab, setTab] = useState<Tab>('codes')
  const [codes, setCodes] = useState<QRCode[]>([])
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([])
  const [mismatches, setMismatches] = useState<MismatchEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showGenerate, setShowGenerate] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<BrandSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [generateForm, setGenerateForm] = useState({ product_type: 'PESTICIDE', product_display_name: '', brand_cosh_id: '', variety_id: '', manufacture_date: '', expiry_date: '', batch_lot_number: '' })
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    if (!clientId) return
    const [codesRes, portfolioRes, mismatchRes] = await Promise.all([
      api.get<QRCode[]>(`/client/${clientId}/qr/codes`).catch(() => ({ data: [] })),
      api.get<PortfolioItem[]>(`/client/${clientId}/qr/portfolio`).catch(() => ({ data: [] })),
      api.get<MismatchEntry[]>(`/client/${clientId}/qr/mismatches`).catch(() => ({ data: [] })),
    ])
    setCodes(codesRes.data)
    setPortfolio(portfolioRes.data)
    setMismatches(mismatchRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId])

  async function searchBrands() {
    if (!clientId || !searchQuery.trim()) return
    setSearching(true)
    try {
      const { data } = await api.post<BrandSearchResult[]>(`/client/${clientId}/qr/portfolio/search`, { manufacturer_name: searchQuery })
      setSearchResults(data)
    } finally { setSearching(false) }
  }

  async function addToPortfolio(brand: BrandSearchResult) {
    if (!clientId) return
    await api.post(`/client/${clientId}/qr/portfolio`, {
      product_type: brand.product_type,
      brand_cosh_id: brand.cosh_id,
    })
    load()
  }

  async function removeFromPortfolio(id: string) {
    if (!clientId || !confirm('Remove from portfolio?')) return
    await api.delete(`/client/${clientId}/qr/portfolio/${id}`)
    load()
  }

  async function generateCode() {
    if (!clientId || !generateForm.product_display_name.trim() || !generateForm.batch_lot_number.trim()) return
    setSaving(true)
    try {
      await api.post(`/client/${clientId}/qr/codes`, generateForm)
      setShowGenerate(false)
      setGenerateForm({ product_type: 'PESTICIDE', product_display_name: '', brand_cosh_id: '', variety_id: '', manufacture_date: '', expiry_date: '', batch_lot_number: '' })
      load()
    } finally { setSaving(false) }
  }

  async function toggleStatus(id: string, current: string) {
    if (!clientId) return
    await api.put(`/client/${clientId}/qr/codes/${id}/status`, { status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
    load()
  }

  function downloadQR(id: string, format: string, size: string) {
    if (!clientId) return
    window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/client/${clientId}/qr/codes/${id}/download?format=${format}&size=${size}`, '_blank')
  }

  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!clientId || !e.target.files?.[0]) return
    const file = e.target.files[0]
    const form = new FormData()
    form.append('file', file)
    const { data } = await api.post<BulkResult>(`/client/${clientId}/qr/codes/bulk`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    setBulkResult(data)
    load()
  }

  function downloadTemplate() {
    if (!clientId) return
    window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/client/${clientId}/qr/bulk-template`, '_blank')
  }

  const STATUS_COLOUR: Record<string, string> = { ACTIVE: 'bg-green-100 text-green-700', INACTIVE: 'bg-gray-100 text-gray-500' }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">QR Codes</h1>
            <p className="text-sm text-gray-500 mt-1">Product authentication and dealer verification</p>
          </div>
          <div className="flex gap-2">
            <button onClick={downloadTemplate} className="px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
              CSV Template
            </button>
            <label className="px-3 py-2 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
              Bulk Upload
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleBulkUpload} />
            </label>
            <button onClick={() => setShowGenerate(true)} className="px-4 py-2 bg-green-700 text-white text-sm font-semibold rounded-lg hover:bg-green-800">
              + Generate QR
            </button>
          </div>
        </div>

        {/* Bulk result banner */}
        {bulkResult && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-blue-800">
                Bulk result: {bulkResult.summary.generated} generated · {bulkResult.summary.skipped_duplicates} duplicates skipped · {bulkResult.summary.failed} failed
              </p>
              <button onClick={() => setBulkResult(null)} className="text-blue-400 hover:text-blue-600">✕</button>
            </div>
            {bulkResult.rows.filter(r => r.status !== 'OK').length > 0 && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {bulkResult.rows.filter(r => r.status !== 'OK').map((r, i) => (
                  <p key={i} className="text-xs text-blue-700">Row {r.row}: {r.status} — {r.reason || r.display_name}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${tab === t ? 'border-green-700 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t === 'codes' ? `QR Codes (${codes.length})` : t === 'portfolio' ? `Brand Portfolio (${portfolio.length})` : `Mismatches (${mismatches.length})`}
            </button>
          ))}
        </div>

        {/* QR Codes tab */}
        {tab === 'codes' && (
          loading ? <div className="h-24 bg-gray-100 rounded-xl animate-pulse" /> :
          codes.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              <p className="text-4xl mb-3">📦</p>
              <p className="text-gray-500 font-medium">No QR codes generated yet</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
              {codes.map(code => (
                <div key={code.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-400 uppercase">{code.product_type}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOUR[code.status]}`}>{code.status}</span>
                        {code.mismatch_count > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600">
                            {code.mismatch_count} mismatch{code.mismatch_count > 1 ? 'es' : ''}
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-gray-900 mt-1">{code.product_display_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Batch: {code.batch_lot_number} · Mfr: {code.manufacture_date} · Exp: {code.expiry_date}</p>
                      <p className="text-xs text-gray-400">Scans: {code.scan_count}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <div className="relative group">
                        <button className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100">
                          Download ▼
                        </button>
                        <div className="absolute right-0 top-8 hidden group-hover:block bg-white border border-gray-100 rounded-xl shadow-lg p-2 z-10 w-40">
                          {['SMALL', 'MEDIUM', 'LARGE'].map(size => (
                            <div key={size}>
                              <button onClick={() => downloadQR(code.id, 'PNG', size)}
                                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded">
                                PNG {size}
                              </button>
                              <button onClick={() => downloadQR(code.id, 'PDF', size)}
                                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded">
                                PDF {size}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => toggleStatus(code.id, code.status)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${code.status === 'ACTIVE' ? 'text-red-500 bg-red-50 hover:bg-red-100' : 'text-green-600 bg-green-50 hover:bg-green-100'}`}>
                        {code.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Brand Portfolio tab */}
        {tab === 'portfolio' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-800 mb-3">Search and Add Brands</h3>
              <p className="text-xs text-gray-400 mb-3">Enter your company name as it appears in Cosh to find all your registered brands.</p>
              <div className="flex gap-2">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchBrands()}
                  placeholder="Enter manufacturer name…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30" />
                <button onClick={searchBrands} disabled={searching}
                  className="px-4 py-2 bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40 hover:bg-green-800">
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="mt-4 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-64 overflow-y-auto">
                  {searchResults.map(b => {
                    const inPortfolio = portfolio.some(p => p.brand_cosh_id === b.cosh_id)
                    return (
                      <div key={b.cosh_id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{b.name}</p>
                          <p className="text-xs text-gray-400">{b.product_type} · {b.manufacturer}</p>
                        </div>
                        {inPortfolio ? (
                          <span className="text-xs text-green-600 font-medium">✓ In portfolio</span>
                        ) : (
                          <button onClick={() => addToPortfolio(b)}
                            className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200">
                            Add
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {searchResults.length === 0 && searchQuery && !searching && (
                <p className="text-xs text-gray-400 mt-3">No brands found. Try a different name variant or ask Neytiri to add the brand to Cosh.</p>
              )}
            </div>

            {portfolio.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100">
                <p className="px-5 pt-4 pb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Current Portfolio ({portfolio.length})</p>
                <div className="divide-y divide-gray-50">
                  {portfolio.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3.5">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{p.display_name}</p>
                        <p className="text-xs text-gray-400">{p.product_type}</p>
                      </div>
                      <button onClick={() => removeFromPortfolio(p.id)}
                        className="text-xs text-red-400 hover:text-red-600 font-medium">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mismatches tab */}
        {tab === 'mismatches' && (
          mismatches.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              <p className="text-4xl mb-3">✓</p>
              <p className="text-gray-500 font-medium">No mismatches recorded</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
              {mismatches.map(m => (
                <div key={m.scan_id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Mismatch</span>
                        <span className="text-xs text-gray-400">{new Date(m.scanned_at).toLocaleString()}</span>
                        {m.scan_attempt > 1 && <span className="text-xs text-gray-400">{m.scan_attempt} attempts</span>}
                      </div>
                      <p className="text-sm font-semibold text-gray-800 mt-1">{m.expected_product}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Batch: {m.batch_lot_number}</p>
                      {m.farmer_name && (
                        <p className="text-xs text-gray-500 mt-1">Farmer: {m.farmer_name} · {m.farmer_district}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Generate QR modal */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Generate QR Code</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Product Type</label>
                <select value={generateForm.product_type}
                  onChange={e => setGenerateForm(f => ({ ...f, product_type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none">
                  {PRODUCT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Trade / Variety Name *</label>
                <select value={generateForm.product_display_name}
                  onChange={e => {
                    const p = portfolio.find(p => p.display_name === e.target.value)
                    setGenerateForm(f => ({ ...f, product_display_name: e.target.value, brand_cosh_id: p?.brand_cosh_id || '', variety_id: p?.variety_id || '' }))
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none">
                  <option value="">Select from portfolio…</option>
                  {portfolio.filter(p => p.product_type === generateForm.product_type).map(p => (
                    <option key={p.id} value={p.display_name}>{p.display_name}</option>
                  ))}
                </select>
                {portfolio.filter(p => p.product_type === generateForm.product_type).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No brands in portfolio for this type. Add via Brand Portfolio tab.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Manufacture / Production Date</label>
                  <input type="date" value={generateForm.manufacture_date}
                    onChange={e => setGenerateForm(f => ({ ...f, manufacture_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                  <input type="date" value={generateForm.expiry_date}
                    onChange={e => setGenerateForm(f => ({ ...f, expiry_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Batch / Lot Number *</label>
                <input value={generateForm.batch_lot_number}
                  onChange={e => setGenerateForm(f => ({ ...f, batch_lot_number: e.target.value }))}
                  placeholder="e.g. BATCH-2026-001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={generateCode} disabled={saving || !generateForm.product_display_name || !generateForm.batch_lot_number}
                className="flex-1 py-3 bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:bg-green-800">
                {saving ? 'Generating…' : 'Generate QR Code'}
              </button>
              <button onClick={() => setShowGenerate(false)}
                className="px-5 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
