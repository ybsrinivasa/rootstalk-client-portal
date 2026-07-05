'use client'
import { useState, useEffect, useRef } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'

interface PortfolioItem { id: string; product_type: string; brand_cosh_id: string | null; variety_id: string | null; display_name: string }
interface QRCode { id: string; product_type: string; product_display_name: string; batch_lot_number: string; manufacture_date: string; expiry_date: string; status: string; created_at: string; scan_count: number; mismatch_count: number }
interface BrandCandidate { cosh_id: string; name: string; product_type: string | null }
interface BrandCandidatesResponse { brands: BrandCandidate[]; cosh_manufacturer_linked: boolean }
interface CropCandidate { cosh_id: string; name: string; variety_count: number }
interface VarietyCandidate { id: string; name: string; crop_cosh_id: string }
interface VarietyCandidatesResponse { crops: CropCandidate[]; varieties: VarietyCandidate[]; is_seed_client: boolean }
interface MismatchEntry { scan_id: string; scanned_at: string; farmer_name: string | null; farmer_district: string | null; expected_product: string; scanned_brand_cosh_id: string | null; batch_lot_number: string; scan_attempt: number }
interface BulkResult { summary: { generated: number; skipped_duplicates: number; failed: number }; rows: { row: number; status: string; reason?: string; display_name: string }[] }

const PRODUCT_TYPES = ['PESTICIDE', 'FERTILISER', 'SEED']
const TABS = ['codes', 'portfolio', 'mismatches'] as const
type Tab = typeof TABS[number]

export default function QRModulePage() {
  const client = getClient()
  const clientId = client?.id
  const isManufacturer = client?.is_manufacturer ?? false
  const [tab, setTab] = useState<Tab>('codes')
  const [codes, setCodes] = useState<QRCode[]>([])
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([])
  const [mismatches, setMismatches] = useState<MismatchEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showGenerate, setShowGenerate] = useState(false)
  const [candidates, setCandidates] = useState<BrandCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesUnlinkedError, setCandidatesUnlinkedError] = useState(false)
  // Belt-and-suspenders: the cached CPClient may predate Phase 1 and
  // not have is_manufacturer. The candidates endpoint's
  // cosh_manufacturer_linked field disambiguates: false on a 200
  // means "not a manufacturer" — hide the Brands section then.
  const [showBrandsSection, setShowBrandsSection] = useState(false)
  const [candidateProductType, setCandidateProductType] = useState<Record<string, string>>({})
  const [addingCoshId, setAddingCoshId] = useState<string | null>(null)
  const [isSeedClient, setIsSeedClient] = useState(false)
  const [crops, setCrops] = useState<CropCandidate[]>([])
  const [selectedCropId, setSelectedCropId] = useState<string>('')
  const [varieties, setVarieties] = useState<VarietyCandidate[]>([])
  const [varietiesLoading, setVarietiesLoading] = useState(false)
  const [addingVarietyId, setAddingVarietyId] = useState<string | null>(null)
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

  // 2026-07-05 — Replaces the fragile "type your Cosh manufacturer
  // name" search with an auto-loaded list keyed off the client's
  // deterministic Client.cosh_manufacturer_id link. If the SA hasn't
  // set that link yet, we surface a clean "ask SA" message instead
  // of a broken UI.
  async function loadCandidates() {
    if (!clientId) return
    setCandidatesLoading(true)
    setCandidatesUnlinkedError(false)
    try {
      const { data } = await api.get<BrandCandidatesResponse>(
        `/client/${clientId}/qr/portfolio/candidates`,
      )
      setCandidates(data.brands || [])
      setShowBrandsSection(data.cosh_manufacturer_linked || isManufacturer)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) {
        setCandidatesUnlinkedError(true)
        setCandidates([])
        // 409 means is_manufacturer=True but cosh_manufacturer_id is
        // NULL — still a manufacturer, so keep the section visible.
        setShowBrandsSection(true)
      } else {
        setCandidates([])
      }
    } finally {
      setCandidatesLoading(false)
    }
  }

  useEffect(() => { loadCandidates() }, [clientId])

  // 2026-07-05 — Seed-side companion to loadCandidates. Fetches the
  // client's populated-crops list once on mount; variety fetches
  // happen only after the CA picks a crop from the dropdown. The
  // endpoint returns is_seed_client=false for manufacturer-only
  // clients — we hide the whole section in that case.
  async function loadCropCandidates() {
    if (!clientId) return
    try {
      const { data } = await api.get<VarietyCandidatesResponse>(
        `/client/${clientId}/qr/portfolio/varieties/candidates`,
      )
      setIsSeedClient(data.is_seed_client)
      setCrops(data.crops || [])
    } catch {
      setIsSeedClient(false)
      setCrops([])
    }
  }
  useEffect(() => { loadCropCandidates() }, [clientId])

  async function loadVarietiesForCrop(cropId: string) {
    if (!clientId || !cropId) { setVarieties([]); return }
    setVarietiesLoading(true)
    try {
      const { data } = await api.get<VarietyCandidatesResponse>(
        `/client/${clientId}/qr/portfolio/varieties/candidates?crop_cosh_id=${encodeURIComponent(cropId)}`,
      )
      setVarieties(data.varieties || [])
    } catch {
      setVarieties([])
    } finally {
      setVarietiesLoading(false)
    }
  }

  useEffect(() => { loadVarietiesForCrop(selectedCropId) }, [selectedCropId, clientId])

  async function addVarietyToPortfolio(variety: VarietyCandidate) {
    if (!clientId) return
    setAddingVarietyId(variety.id)
    try {
      await api.post(`/client/${clientId}/qr/portfolio`, {
        product_type: 'SEED',
        variety_id: variety.id,
      })
      load()
    } finally {
      setAddingVarietyId(null)
    }
  }

  async function addCandidateToPortfolio(brand: BrandCandidate) {
    if (!clientId) return
    const productType = candidateProductType[brand.cosh_id] || 'PESTICIDE'
    setAddingCoshId(brand.cosh_id)
    try {
      await api.post(`/client/${clientId}/qr/portfolio`, {
        product_type: productType,
        brand_cosh_id: brand.cosh_id,
      })
      load()
    } finally {
      setAddingCoshId(null)
    }
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
              {t === 'codes' ? `QR Codes (${codes.length})` : t === 'portfolio' ? `Portfolio (${portfolio.length})` : `Mismatches (${mismatches.length})`}
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

        {/* Portfolio tab */}
        {tab === 'portfolio' && (
          <div className="space-y-4">
            {/* Cosh Brands section — pesticide/fertilizer. Auto-loaded
                via the Client → cosh_manufacturer_id link the SA sets
                at approval time. Hidden for pure seed clients. */}
            {showBrandsSection && (candidatesUnlinkedError ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <h3 className="font-semibold text-amber-900 mb-1">Cosh manufacturer not linked</h3>
                <p className="text-sm text-amber-800">
                  Your company hasn&apos;t been linked to a Cosh manufacturer yet, so we can&apos;t auto-load your brand list.
                  Please ask your RootsTalk contact to open your Company Profile in the Super Admin portal and set the Cosh Manufacturer.
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">Your Cosh Brands</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Pesticide &amp; Fertilizer brands registered to your company in Cosh. Pick a product type and add the ones you distribute.
                    </p>
                  </div>
                  <button onClick={loadCandidates} disabled={candidatesLoading}
                    className="text-xs text-green-700 hover:text-green-900 font-medium disabled:opacity-50">
                    {candidatesLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {!candidatesLoading && candidates.length === 0 && (
                  <p className="text-xs text-gray-400 mt-3">
                    No brands found under your Cosh manufacturer entry yet.
                    New brands appear here once RootsTalk adds them to Cosh.
                  </p>
                )}
                {candidates.length > 0 && (
                  <div className="mt-1 border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-96 overflow-y-auto">
                    {candidates.map(b => {
                      const inPortfolio = portfolio.some(p => p.brand_cosh_id === b.cosh_id)
                      return (
                        <div key={b.cosh_id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-800">{b.name}</p>
                          </div>
                          {inPortfolio ? (
                            <span className="text-xs text-green-600 font-medium shrink-0">✓ In portfolio</span>
                          ) : (
                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={candidateProductType[b.cosh_id] || 'PESTICIDE'}
                                onChange={e => setCandidateProductType(m => ({ ...m, [b.cosh_id]: e.target.value }))}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                                <option value="PESTICIDE">Pesticide</option>
                                <option value="FERTILISER">Fertiliser</option>
                              </select>
                              <button onClick={() => addCandidateToPortfolio(b)}
                                disabled={addingCoshId === b.cosh_id}
                                className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200 disabled:opacity-50">
                                {addingCoshId === b.cosh_id ? '…' : 'Add'}
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Seed Varieties section — crop-scoped picker sourced from
                RootsTalk's seed_varieties (not Cosh). Only rendered for
                seed-flavour clients; Bayer-shaped clients see this
                alongside the Cosh Brands section above. */}
            {isSeedClient && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">Your Seed Varieties</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Varieties you&apos;ve entered in Seed → Varieties. Pick a crop to see its varieties, then add the ones you want to authenticate.
                    </p>
                  </div>
                  <button onClick={loadCropCandidates}
                    className="text-xs text-green-700 hover:text-green-900 font-medium">
                    Refresh
                  </button>
                </div>
                {crops.length === 0 ? (
                  <p className="text-xs text-amber-600 mt-3">
                    No varieties entered yet. Add varieties in <span className="font-semibold">Seed → Varieties</span> to see them here.
                  </p>
                ) : (
                  <>
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Crop</label>
                      <select value={selectedCropId}
                        onChange={e => setSelectedCropId(e.target.value)}
                        className="w-full max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                        <option value="">Select a crop…</option>
                        {crops.map(c => (
                          <option key={c.cosh_id} value={c.cosh_id}>
                            {c.name} ({c.variety_count})
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedCropId && (
                      varietiesLoading ? (
                        <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />
                      ) : varieties.length === 0 ? (
                        <p className="text-xs text-gray-400 mt-2">No active varieties for this crop.</p>
                      ) : (
                        <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-96 overflow-y-auto">
                          {varieties.map(v => {
                            const inPortfolio = portfolio.some(p => p.variety_id === v.id)
                            return (
                              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-gray-800">{v.name}</p>
                                </div>
                                {inPortfolio ? (
                                  <span className="text-xs text-green-600 font-medium shrink-0">✓ In portfolio</span>
                                ) : (
                                  <button onClick={() => addVarietyToPortfolio(v)}
                                    disabled={addingVarietyId === v.id}
                                    className="text-xs px-3 py-1.5 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200 disabled:opacity-50 shrink-0">
                                    {addingVarietyId === v.id ? '…' : 'Add'}
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    )}
                  </>
                )}
              </div>
            )}

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
