'use client'
import { useEffect, useMemo, useState, FormEvent } from 'react'
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

// Batch X (2026-05-19) — SEED_DATA_MANAGER removed from the role
// picker. Seed-data access is now a client-scoped privilege held by
// one Subject Expert; assigned via the "Client Responsibilities"
// panel at the top of this page. Legacy SEED_DATA_MANAGER rows were
// migrated to SUBJECT_EXPERT + ClientUserPrivilege(SEED_DATA), but
// the role label is kept in ROLE_COLOUR / ROLE_LABEL so any stragglers
// still render correctly.
const ROLES = [
  { value: 'SUBJECT_EXPERT', label: 'Subject Expert' },
  { value: 'FIELD_MANAGER', label: 'Field Manager' },
  { value: 'REPORT_USER', label: 'Report User' },
  { value: 'PRODUCT_MANAGER', label: 'Product Manager' },
  { value: 'CLIENT_RM', label: 'Relationship Manager' },
]

const ROLE_LABEL: Record<string, string> = {
  CA: 'Company Admin',
  SUBJECT_EXPERT: 'Subject Expert',
  FIELD_MANAGER: 'Field Manager',
  SEED_DATA_MANAGER: 'Seed Data',  // legacy migration safety
  REPORT_USER: 'Report User',
  PRODUCT_MANAGER: 'Product Manager',
  CLIENT_RM: 'Relationship Manager',
}

const ROLE_COLOUR: Record<string, string> = {
  CA: 'bg-green-100 text-green-700',
  SUBJECT_EXPERT: 'bg-blue-100 text-blue-700',
  FIELD_MANAGER: 'bg-purple-100 text-purple-700',
  SEED_DATA_MANAGER: 'bg-amber-100 text-amber-700',  // legacy
  REPORT_USER: 'bg-slate-100 text-slate-600',
  PRODUCT_MANAGER: 'bg-pink-100 text-pink-700',
  CLIENT_RM: 'bg-teal-100 text-teal-700',
}

interface PrivilegeOwner {
  privilege: string
  user_id: string | null
  name: string | null
  email: string | null
}

const PRIVILEGE_LABEL: Record<string, string> = {
  SEED_DATA: 'Seed Data',
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

  // 2026-07-28 — Multi-role invite: `roles` is an array of role
  // values. Backend enforces per-role add via one POST each; the
  // handler loops and reports partial-failure honestly.
  const [form, setForm] = useState({
    email: '', name: '', roles: [] as string[], password: '',
    designation: '', professional_profile: '',
  })

  function toggleRole(role: string) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(role)
        ? f.roles.filter(r => r !== role)
        : [...f.roles, role],
    }))
  }

  // Edit-user modal (Batch D, 2026-05-18). Holds the user being
  // edited + the editable fields (name + bio). Role and email
  // changes go through other flows (CA-exclusivity gate / not
  // editable post-creation).
  const [editing, setEditing] = useState<PortalUser | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '', designation: '', professional_profile: '',
  })

  // 2026-07-28 — Edit Roles modal. Multi-select checkboxes, pre-checked
  // with the user's current ACTIVE roles. Save reconciles the exact
  // set via PUT /users/{uid}/roles.
  const [editingRoles, setEditingRoles] = useState<{
    userId: string; name: string; email: string; roles: string[];
  } | null>(null)
  const [savingRoles, setSavingRoles] = useState(false)

  // Batch X (2026-05-19) — per-client privilege holders + assign UI.
  // Visible only for Seed Companies (currently the only privilege).
  const [privileges, setPrivileges] = useState<PrivilegeOwner[]>([])
  const [savingPriv, setSavingPriv] = useState<string | null>(null)
  // 2026-05-22: org types switched from legacy slugs to live Cosh
  // UUIDs. "Seed Company" row in Cosh `organization_types` Core
  // is `4b0847f9-…` — mirror of backend SEED_COMPANY_COSH_ID in
  // app/modules/seed_mgmt/router.py. Keep both in sync; if Cosh
  // ever replaces this row, update both constants.
  const isSeedCompany = client?.org_type_cosh_ids?.includes(
    '4b0847f9-a590-452f-9129-ee0e2d946dd9',
  ) ?? false

  const load = () => {
    if (!clientId) return
    Promise.all([
      api.get<PortalUser[]>(`/client/${clientId}/users`)
        .then(r => setUsers(r.data))
        .catch(() => {}),
      api.get<PrivilegeOwner[]>(`/client/${clientId}/privileges`)
        .then(r => setPrivileges(r.data))
        .catch(() => setPrivileges([])),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [clientId])

  async function setPrivilegeHolder(privilege: string, userId: string | null) {
    if (!clientId) return
    setSavingPriv(privilege); setError('')
    try {
      await api.put(`/client/${clientId}/privileges/${privilege}`, { user_id: userId })
      await load()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to assign privilege.'))
    } finally { setSavingPriv(null) }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (form.roles.length === 0) {
      setError('Pick at least one role.')
      return
    }
    setInviting(true); setError(''); setSuccess('')

    // Backend accepts one role per POST. Loop sequentially so a
    // partial failure (e.g. CA-exclusivity 409 on a specific role)
    // surfaces with a clear "added X, failed Y" message rather than
    // being swallowed. Bio fields only travel when SUBJECT_EXPERT
    // is one of the roles.
    const includesSE = form.roles.includes('SUBJECT_EXPERT')
    const baseBody = {
      email: form.email,
      name: form.name,
      password: form.password,
      designation: includesSE ? form.designation : '',
      professional_profile: includesSE ? form.professional_profile : '',
    }
    const added: string[] = []
    let failedRole: string | null = null
    let failedMessage = ''
    for (const role of form.roles) {
      try {
        await api.post(`/client/${clientId}/users`, { ...baseBody, role })
        added.push(role)
      } catch (err: unknown) {
        failedRole = role
        failedMessage = extractErrorMessage(err, 'Failed to add role.')
        break
      }
    }

    const addedLabels = added
      .map(r => ROLES.find(x => x.value === r)?.label)
      .filter(Boolean)
      .join(', ')

    if (failedRole) {
      const failedLabel = ROLES.find(x => x.value === failedRole)?.label ?? failedRole
      if (added.length > 0) {
        setError(`Added ${addedLabels}. Failed on ${failedLabel}: ${failedMessage}`)
      } else {
        setError(failedMessage)
      }
    } else {
      setSuccess(`${form.name || form.email} added as: ${addedLabels}.`)
      setShowInvite(false)
      setForm({
        email: '', name: '', roles: [], password: '',
        designation: '', professional_profile: '',
      })
    }
    load()
    setInviting(false)
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

  // Group PortalUser rows by user.id — the API returns one row per
  // (user, role) pair (Batch K multi-role), which would show duplicates
  // in the table. Grouping collapses to one row per user with all role
  // pills. "anyActive" drives the status pill and the Deactivate/
  // Reactivate button's target state.
  const grouped = useMemo(() => {
    type G = {
      userId: string; name: string | null; email: string | null
      designation: string | null; professional_profile: string | null
      roles: string[]; anyActive: boolean; createdAt: string
    }
    const byId = new Map<string, G>()
    for (const u of users) {
      let g = byId.get(u.id)
      if (!g) {
        g = {
          userId: u.id, name: u.name, email: u.email,
          designation: u.designation, professional_profile: u.professional_profile,
          roles: [], anyActive: false, createdAt: u.created_at,
        }
        byId.set(u.id, g)
      }
      g.roles.push(u.role)
      if (u.status === 'ACTIVE') g.anyActive = true
    }
    return Array.from(byId.values())
  }, [users])

  function openEditRoles(g: {
    userId: string; name: string | null; email: string | null; roles: string[];
  }) {
    setEditingRoles({
      userId: g.userId,
      name: g.name || '',
      email: g.email || '',
      // Only offer roles the picker knows about — CA is deliberately
      // NOT in ROLES, so a CA user's row won't reach this handler.
      roles: g.roles.filter(r => ROLES.some(x => x.value === r)),
    })
    setError('')
  }

  function toggleEditingRole(role: string) {
    setEditingRoles(prev => prev && ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter(r => r !== role)
        : [...prev.roles, role],
    }))
  }

  async function handleSaveRoles(e: FormEvent) {
    e.preventDefault()
    if (!editingRoles) return
    if (editingRoles.roles.length === 0) {
      setError('Pick at least one role. To remove the user entirely, use the Deactivate button.')
      return
    }
    setSavingRoles(true); setError('')
    try {
      await api.put(
        `/client/${clientId}/users/${editingRoles.userId}/roles`,
        { roles: editingRoles.roles },
      )
      setEditingRoles(null)
      setSuccess(`${editingRoles.name || editingRoles.email} roles updated.`)
      load()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to update roles.'))
    } finally {
      setSavingRoles(false)
    }
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

      {/* Batch X (2026-05-19) — per-client single-holder
          responsibilities. Visible only on Seed Companies for now
          (Seed Data is the only privilege). Mirrors the SA-Portal
          "Content Manager Responsibilities" panel; the privilege
          holder is always one Subject Expert. Selecting a different
          SE atomically demotes the previous holder. */}
      {isSeedCompany && !loading && (
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Client Responsibilities
          </h2>
          <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
            {Object.keys(PRIVILEGE_LABEL).map(p => {
              const owner = privileges.find(o => o.privilege === p)
              const ses = users.filter(u =>
                u.role === 'SUBJECT_EXPERT' && u.status === 'ACTIVE',
              )
              return (
                <div key={p} className="flex items-center justify-between px-5 py-4 gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{PRIVILEGE_LABEL[p]}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {owner?.user_id
                        ? `Currently held by ${owner.name || owner.email}.`
                        : 'No one is responsible yet. Assign a Subject Expert.'}
                    </p>
                  </div>
                  <select
                    value={owner?.user_id || ''}
                    disabled={savingPriv === p || ses.length === 0}
                    onChange={e => setPrivilegeHolder(p, e.target.value || null)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 bg-white disabled:bg-slate-50 min-w-[14rem]">
                    <option value="">(unassigned)</option>
                    {ses.map(s => (
                      <option key={s.id} value={s.id}>{s.name || s.email}</option>
                    ))}
                  </select>
                </div>
              )
            })}
            {users.filter(u => u.role === 'SUBJECT_EXPERT' && u.status === 'ACTIVE').length === 0 && (
              <p className="px-5 py-3 text-xs text-slate-400">
                Add at least one Subject Expert below to assign responsibilities.
              </p>
            )}
          </div>
        </section>
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
              {grouped.map(g => {
                const isCA = g.roles.includes('CA')
                const status = g.anyActive ? 'ACTIVE' : 'INACTIVE'
                return (
                  <tr key={g.userId} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-800">{g.name || '—'}</p>
                      <p className="text-xs text-slate-400">{g.email}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {g.roles.map(r => (
                          <span key={r} className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOUR[r] || 'bg-slate-100 text-slate-600'}`}>
                            {ROLE_LABEL[r] || r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 text-xs hidden sm:table-cell">
                      {new Date(g.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        {!isCA && (
                          <button onClick={() => openEditRoles(g)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">
                            Roles
                          </button>
                        )}
                        {!isCA && (
                          <button onClick={() => openEdit({
                            id: g.userId, name: g.name, email: g.email,
                            role: g.roles[0], status,
                            designation: g.designation, professional_profile: g.professional_profile,
                            created_at: g.createdAt,
                          } as PortalUser)}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">
                            ✎ Bio
                          </button>
                        )}
                        {!isCA && (
                          <button
                            onClick={() => toggleStatus(g.userId, status)}
                            disabled={toggling === g.userId}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors ${
                              status === 'ACTIVE'
                                ? 'border border-red-100 text-red-500 hover:bg-red-50'
                                : 'border border-green-200 text-green-600 hover:bg-green-50'
                            }`}>
                            {toggling === g.userId ? '…' : status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add User Modal.
          2026-08-16 — Card constrained to max-h-[90vh] with a scrollable
          body + shrink-0 header/footer. Prevents the "Add User" button
          from disappearing off the bottom of the viewport when the
          Subject Expert bio fields expand the form on shorter screens. */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 shrink-0">
              <h2 className="font-bold text-slate-900">Add Portal User</h2>
              <p className="text-slate-500 text-sm mt-0.5">Create login credentials for a Subject Expert or other team member</p>
            </div>
            <form onSubmit={handleInvite} className="flex flex-col flex-1 min-h-0">
              <div className="p-6 pb-4 space-y-4 overflow-y-auto flex-1">
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
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Roles
                </label>
                <div className="border border-slate-200 rounded-xl px-3 py-2 space-y-1.5">
                  {ROLES.map(r => {
                    const checked = form.roles.includes(r.value)
                    return (
                      <label
                        key={r.value}
                        className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer py-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRole(r.value)}
                          className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                        />
                        {r.label}
                      </label>
                    )
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  A user can hold multiple roles. CA is exclusive and is
                  managed separately.
                </p>
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
                  practice cards. Optional at create time. Shown when
                  SUBJECT_EXPERT is one of the selected roles. */}
              {form.roles.includes('SUBJECT_EXPERT') && (
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
              </div>
              <div className="flex gap-3 p-6 pt-4 border-t border-slate-100 shrink-0">
                <button type="button" onClick={() => { setShowInvite(false); setError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={inviting || form.roles.length === 0}
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 shrink-0">
              <h2 className="font-bold text-slate-900">Edit User</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                {editing.email} · {ROLE_LABEL[editing.role] || editing.role}
              </p>
            </div>
            <form onSubmit={handleSaveEdit} className="flex flex-col flex-1 min-h-0">
              <div className="p-6 pb-4 space-y-4 overflow-y-auto flex-1">
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
              </div>
              <div className="flex gap-3 p-6 pt-4 border-t border-slate-100 shrink-0">
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

      {/* Edit Roles Modal — reconciles the user's ACTIVE roles at
          this client to the exact selected set via a single PUT.
          Same checkbox pattern as the invite form. */}
      {editingRoles && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 pt-5 pb-3 border-b border-slate-100 shrink-0">
              <h2 className="font-bold text-slate-900">Edit Roles</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {editingRoles.name || editingRoles.email}
              </p>
            </div>
            <form onSubmit={handleSaveRoles} className="flex flex-col flex-1 min-h-0">
              <div className="p-6 pb-4 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Roles
                </label>
                <div className="border border-slate-200 rounded-xl px-3 py-2 space-y-1.5">
                  {ROLES.map(r => {
                    const checked = editingRoles.roles.includes(r.value)
                    return (
                      <label
                        key={r.value}
                        className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer py-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEditingRole(r.value)}
                          className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                        />
                        {r.label}
                      </label>
                    )
                  })}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Unchecking a role deactivates that assignment. To remove
                  the user entirely, use the Deactivate button on their row.
                </p>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <div className="flex gap-3 p-6 pt-4 border-t border-slate-100 shrink-0">
                <button type="button" onClick={() => { setEditingRoles(null); setError('') }}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingRoles || editingRoles.roles.length === 0}
                  className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
                  {savingRoles ? 'Saving…' : 'Save Roles'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
