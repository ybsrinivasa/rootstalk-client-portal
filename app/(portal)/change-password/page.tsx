'use client'
import { useState, FormEvent } from 'react'
import { getClient } from '@/lib/auth'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'

export default function ChangePasswordPage() {
  const client = getClient()
  const colour = client?.primary_colour || '#1A5C2A'
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    if (form.new_password !== form.confirm) { setError('New passwords do not match'); return }
    if (form.new_password.length < 8) { setError('New password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await api.put('/auth/admin/change-password', {
        current_password: form.current_password,
        new_password: form.new_password,
      })
      setSuccess('Password changed successfully.')
      setForm({ current_password: '', new_password: '', confirm: '' })
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to change password'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-1 text-center">Change Password</h1>
        <p className="text-gray-500 text-sm mb-6 text-center">Update your portal login password</p>
        <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
          {[
            { key: 'current_password', label: 'Current password' },
            { key: 'new_password', label: 'New password (min 8 chars)' },
            { key: 'confirm', label: 'Confirm new password' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input type="password"
                value={(form as Record<string, string>)[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          ))}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">⚠ {error}</p>}
          {success && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-4 py-2">✓ {success}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${colour}cc, ${colour})` }}>
            {loading ? 'Saving…' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
