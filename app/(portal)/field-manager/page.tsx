'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { getClient } from '@/lib/auth'

interface Promoter {
  id: string; user_id: string; name: string | null; phone: string | null
  promoter_type: string; status: string; territory_notes: string | null; registered_at: string
}
interface Farmer {
  user_id: string; name: string | null; phone: string | null
  subscription_id: string; package_id: string; subscription_status: string
}

export default function FieldManagerPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [tab, setTab] = useState<'dealers' | 'facilitators' | 'farmers' | 'assign'>('dealers')
  const [dealers, setDealers] = useState<Promoter[]>([])
  const [facilitators, setFacilitators] = useState<Promoter[]>([])
  const [farmers, setFarmers] = useState<Farmer[]>([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [addingType, setAddingType] = useState<'DEALER' | 'FACILITATOR'>('DEALER')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [addForm, setAddForm] = useState({ name: '', phone: '', territory_notes: '' })

  // Assignment
  const [assignForm, setAssignForm] = useState({
    farmer_subscription_id: '',
    promoter_user_id: '',
    promoter_type: 'DEALER',
  })
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignSuccess, setAssignSuccess] = useState('')

  const load = async () => {
    if (!clientId) return
    const [d, f, fa] = await Promise.all([
      api.get<Promoter[]>(`/client/${clientId}/field-manager/promoters?promoter_type=DEALER`).catch(() => ({ data: [] as Promoter[] })),
      api.get<Promoter[]>(`/client/${clientId}/field-manager/promoters?promoter_type=FACILITATOR`).catch(() => ({ data: [] as Promoter[] })),
      api.get<Farmer[]>(`/client/${clientId}/field-manager/farmers`).catch(() => ({ data: [] as Farmer[] })),
    ])
    setDealers(d.data)
    setFacilitators(f.data)
    setFarmers(fa.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [clientId])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setAdding(true); setAddError('')
    try {
      await api.post(`/client/${clientId}/field-manager/promoters`, {
        ...addForm, promoter_type: addingType,
      })
      setShowAdd(false)
      setAddForm({ name: '', phone: '', territory_notes: '' })
      load()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddError(msg || 'Failed to register.')
    } finally { setAdding(false) }
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault()
    setAssigning(true); setAssignError(''); setAssignSuccess('')
    try {
      await api.post('/promoter/assignments/initiate', {
        subscription_id: assignForm.farmer_subscription_id,
        promoter_user_id: assignForm.promoter_user_id,
        promoter_type: assignForm.promoter_type,
      })
      setAssignSuccess('Assignment sent. The farmer will be notified.')
      setAssignForm({ farmer_subscription_id: '', promoter_user_id: '', promoter_type: 'DEALER' })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAssignError(msg || 'Failed to assign.')
    } finally { setAssigning(false) }
  }

  const PromoterTable = ({ list, type }: { list: Promoter[], type: string }) => (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setAddingType(type as 'DEALER' | 'FACILITATOR'); setShowAdd(true); setAddError('') }}
          className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
          style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
          + Register {type === 'DEALER' ? 'Dealer' : 'Facilitator'}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">
            No {type.toLowerCase()}s registered yet. Register {type.toLowerCase()}s to route farmer orders to them.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Phone</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Territory</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-800">{p.name || '—'}</p>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-slate-600 hidden sm:table-cell">{p.phone || '—'}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs hidden md:table-cell">{p.territory_notes || '—'}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Field Manager</h1>
        <p className="text-slate-500 text-sm mt-0.5">Register dealers and facilitators, manage farmer assignments</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit overflow-x-auto">
        {(['dealers', 'facilitators', 'farmers', 'assign'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'dealers' ? `Dealers (${dealers.length})` :
             t === 'facilitators' ? `Facilitators (${facilitators.length})` :
             t === 'farmers' ? `Farmers (${farmers.length})` : 'Assign Advisory'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : tab === 'dealers' ? (
        <PromoterTable list={dealers} type="DEALER" />
      ) : tab === 'facilitators' ? (
        <PromoterTable list={facilitators} type="FACILITATOR" />
      ) : tab === 'farmers' ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {farmers.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-slate-500 text-sm">No farmers have subscriptions with this client yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Farmer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Phone</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {farmers.map(f => (
                  <tr key={f.user_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-800">{f.name || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600 hidden sm:table-cell">{f.phone || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.subscription_status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {f.subscription_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* Assignment Tab */
        <div className="max-w-lg space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-1">Assign a Dealer or Facilitator to a Farmer</h3>
            <p className="text-slate-500 text-sm mb-5">
              The promoter will be associated with this farmer's subscription. The farmer receives a notification and must accept.
            </p>
            <form onSubmit={handleAssign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Farmer's Subscription</label>
                <select value={assignForm.farmer_subscription_id}
                  onChange={e => setAssignForm(f => ({ ...f, farmer_subscription_id: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Select farmer…</option>
                  {farmers.filter(f => f.subscription_status === 'ACTIVE').map(f => (
                    <option key={f.subscription_id} value={f.subscription_id}>
                      {f.name || f.phone || f.user_id} — {f.subscription_status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Assign to</label>
                <select value={assignForm.promoter_type}
                  onChange={e => setAssignForm(f => ({ ...f, promoter_type: e.target.value, promoter_user_id: '' }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 mb-2">
                  <option value="DEALER">Dealer</option>
                  <option value="FACILITATOR">Facilitator</option>
                </select>
                <select value={assignForm.promoter_user_id}
                  onChange={e => setAssignForm(f => ({ ...f, promoter_user_id: e.target.value }))}
                  required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  <option value="">Select {assignForm.promoter_type.toLowerCase()}…</option>
                  {(assignForm.promoter_type === 'DEALER' ? dealers : facilitators)
                    .filter(p => p.status === 'ACTIVE')
                    .map(p => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.name || p.phone || p.user_id}
                      </option>
                    ))}
                </select>
              </div>
              {assignError && <p className="text-sm text-red-600">{assignError}</p>}
              {assignSuccess && <p className="text-sm text-green-700">{assignSuccess}</p>}
              <button type="submit" disabled={assigning}
                className="w-full text-white font-semibold py-3 rounded-xl text-sm disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                {assigning ? 'Assigning…' : 'Send Assignment'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Promoter Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Register {addingType === 'DEALER' ? 'Dealer' : 'Facilitator'}</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                A user account will be created for their phone number. They can log in via the RootsTalk PWA.
              </p>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
                <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  required placeholder="Name"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Mobile Number</label>
                <input value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
                  required placeholder="+91XXXXXXXXXX"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono" />
                <p className="text-xs text-slate-400 mt-1">They will use OTP on this number to log into the PWA</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Territory / Notes</label>
                <textarea value={addForm.territory_notes} onChange={e => setAddForm(f => ({ ...f, territory_notes: e.target.value }))}
                  rows={2} placeholder="e.g. Covers Warangal district, 3 mandals"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
              </div>
              {addError && <p className="text-sm text-red-600">{addError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAdd(false); setAddError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={adding}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {adding ? 'Registering…' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
