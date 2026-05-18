'use client'
import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { getClient } from '@/lib/auth'

interface PortalUser {
  id: string; email: string | null; name: string | null
  role: string; status: string; created_at: string
  // Batch D (2026-05-18) — author bio captured here, not per-package.
  // Surfaces on the farmer PWA next to the author's name on practice
  // cards. Currently shown only in the Add/Edit modals when role=SE.
  designation: string | null
  professional_profile: string | null
}

const ROLES = [
  { value: 'SUBJECT_EXPERT', label: 'Subject Expert' },
  { value: 'FIELD_MANAGER', label: 'Field Manager' },
  { value: 'SEED_DATA_MANAGER', label: 'Seed Data Manager' },
  { value: 'REPORT_USER', label: 'Report User' },
  { value: 'PRODUCT_MANAGER', label: 'Product Manager' },
  { value: 'CLIENT_RM', label: 'Relationship Manager' },
]

const ROLE_COLOUR: Record<string, string> = {
  CA: 'bg-green-100 text-green-700',
  SUBJECT_EXPERT: 'bg-blue-100 text-blue-700',
  FIELD_MANAGER: 'bg-purple-100 text-purple-700',
  SEED_DATA_MANAGER: 'bg-amber-100 text-amber-700',
  REPORT_USER: 'bg-slate-100 text-slate-600',
  PRODUCT_MANAGER: 'bg-pink-100 text-pink-700',
  CLIENT_RM: 'bg-teal-100 text-teal-700',
}

export default function UsersPage() {
  const client = getClient()
  const clientId = client?.id
  const colour = client?.primary_colour || '#1A5C2A'

  const [users, setUsers] = useState<PortalUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [form, setForm] = useState({
    email: '', name: '', role: 'SUBJECT_EXPERT', password: '',
    designation: '', professional_profile: '',
  })

  // Edit-user modal (Batch D, 2026-05-18). Holds the user being
  // edited + the editable fields (name + bio). Role and email
  // changes go through other flows (CA-exclusivity gate / not
  // editable post-creation).
  const [editing, setEditing] = useState<PortalUser | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', designation: '', professional_profile: '',
  })

  const load = () => {
    if (!clientId) return
    api.get<PortalUser[]>(`/client/${clientId}/users`)
      .then(r => setUsers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [clientId])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true); setError(''); setSuccess('')
    try {
      // Only send bio fields when adding a Subject Expert. The
      // backend column lives on User so other roles could carry
      // it too — we just don't expose the inputs for them yet.
      const body = form.role === 'SUBJECT_EXPERT'
        ? form
        : { ...form, designation: '', professional_profile: '' }
      await api.post(`/client/${clientId}/users`, body)
      setSuccess(`${form.name || form.email} has been added as ${ROLES.find(r => r.value === form.role)?.label}.`)
      setShowInvite(false)
      setForm({
        email: '', name: '', role: 'SUBJECT_EXPERT', password: '',
        designation: '', professional_profile: '',
      })
      load()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to add user.'))
    } finally { setInviting(false) }
  }

  function openEdit(user: PortalUser) {
    setEditing(user)
    setEditForm({
      name: user.name || '',
      designation: user.designation || '',
      professional_profile: user.professional_profile || '',
    })
    setError('')
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editing || !clientId) return
    setSavingEdit(true); setError('')
    try {
      const body: Record<string, string> = { name: editForm.name }
      if (editing.role === 'SUBJECT_EXPERT') {
        body.designation = editForm.designation
        body.professional_profile = editForm.professional_profile
      }
      await api.put(`/client/${clientId}/users/${editing.id}`, body)
      setEditing(null)
      setSuccess('User details updated.')
      load()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to save user.'))
    } finally { setSavingEdit(false) }
  }

  async function toggleStatus(userId: string, currentStatus: string) {
    if (!clientId) return
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    setToggling(userId)
    try {
      await api.put(`/client/${clientId}/users/${userId}/status`, { status: newStatus })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u))
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update user status.'))
    } finally { setToggling(null) }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Portal Users</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage who can access {client?.display_name}'s portal</p>
        </div>
        <button onClick={() => { setShowInvite(true); setError(''); setSuccess('') }}
          className="text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm"
          style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
          + Add User
        </button>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">{success}</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl p-10 text-center text-slate-400 border border-slate-100">Loading…</div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">No users yet. Add Subject Experts and Field Managers to your portal.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">User</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Added</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-800">{user.name || '—'}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOUR[user.role] || 'bg-slate-100 text-slate-600'}`}>
                      {ROLES.find(r => r.value === user.role)?.label || user.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs hidden sm:table-cell">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-2">
                      {user.role !== 'CA' && (
                        <button onClick={() => openEdit(user)}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">
                          ✎ Edit
                        </button>
                      )}
                      {user.role !== 'CA' && (
                        <button
                          onClick={() => toggleStatus(user.id, user.status)}
                          disabled={toggling === user.id}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors ${
                            user.status === 'ACTIVE'
                              ? 'border border-red-100 text-red-500 hover:bg-red-50'
                              : 'border border-green-200 text-green-600 hover:bg-green-50'
                          }`}>
                          {toggling === user.id ? '…' : user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add User Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Portal User</h2>
              <p className="text-slate-500 text-sm mt-0.5">Create login credentials for a Subject Expert or other team member</p>
            </div>
            <form onSubmit={handleInvite} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Dr. Ravi Kumar"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  required placeholder="ravi@company.com"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Temporary Password</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required placeholder="Set a temporary password"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                <p className="text-xs text-slate-400 mt-1">The user will use this password to sign in</p>
              </div>

              {/* Subject Expert bio (Batch D, 2026-05-18). Surfaced
                  on the farmer PWA next to the author's name on
                  practice cards. Optional at create time. */}
              {form.role === 'SUBJECT_EXPERT' && (
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Author bio <span className="text-slate-300">(optional)</span>
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Designation</label>
                    <input value={form.designation}
                      onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                      placeholder="e.g. Senior Agronomist"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Professional Profile</label>
                    <textarea value={form.professional_profile}
                      onChange={e => setForm(f => ({ ...f, professional_profile: e.target.value }))}
                      rows={3}
                      placeholder="e.g. 25 years in Karnataka rice cultivation; author of 12 peer-reviewed papers on IPM."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500" />
                    <p className="text-xs text-slate-400 mt-1">Shown next to this expert&apos;s name on advisory cards in the farmer app.</p>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowInvite(false); setError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={inviting}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {inviting ? 'Adding…' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User modal (Batch D, 2026-05-18). Edits name + bio
          fields. Role + email + password go through separate flows
          (CA-exclusivity / password-reset). */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Edit User</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                {editing.email} · {ROLES.find(r => r.value === editing.role)?.label || editing.role}
              </p>
            </div>
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
                <input value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>

              {editing.role === 'SUBJECT_EXPERT' && (
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Author bio <span className="text-slate-300">(optional)</span>
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Designation</label>
                    <input value={editForm.designation}
                      onChange={e => setEditForm(f => ({ ...f, designation: e.target.value }))}
                      placeholder="e.g. Senior Agronomist"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Professional Profile</label>
                    <textarea value={editForm.professional_profile}
                      onChange={e => setEditForm(f => ({ ...f, professional_profile: e.target.value }))}
                      rows={3}
                      placeholder="e.g. 25 years in Karnataka rice cultivation; author of 12 peer-reviewed papers on IPM."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500" />
                    <p className="text-xs text-slate-400 mt-1">Changes reflect immediately on every advisory card this expert authored.</p>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setEditing(null); setError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingEdit}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
