'use client'
import { useEffect, useState } from 'react'
import api from '@/lib/api'

// RM-facing list of nearby contacts (facilitators + dealers + company
// promoters) at the sub's effective client. Purpose: let the RM scan
// "who's around" before considering any assignment change (which is a
// separate v2 mutation surface — this panel is purely read).

type PromoterType = 'FACILITATOR' | 'DEALER'
// 2026-11-14 pt2 — filter chips are orthogonal: a Facilitator can
// also be a Promoter, so these aren't a disjoint partition. Each
// chip represents a BOOLEAN capability the RM might want to pick
// from (with counts inclusive).
type RoleFilter = 'ALL' | 'FACILITATOR' | 'DEALER' | 'PROMOTER' | 'PROMOTER_PUNDIT'

interface Contact {
  user_id: string
  name: string | null
  phone: string | null
  promoter_types: PromoterType[]
  is_promoter: boolean
  is_promoter_pundit: boolean
  distance_km: number | null
  gps_lat: number | null
  gps_lng: number | null
  address_line: string | null
  state_name: string | null
  district_name: string | null
  sub_district_name: string | null
}
interface Payload {
  farmer_has_gps: boolean
  contacts: Contact[]
}

const TYPE_LABEL: Record<string, string> = {
  FACILITATOR: 'Facilitator',
  DEALER: 'Dealer',
}
const TYPE_TONE: Record<string, string> = {
  FACILITATOR: 'bg-emerald-100 text-emerald-800',
  DEALER: 'bg-sky-100 text-sky-800',
}

function joinAddr(c: Contact): string {
  const parts = [
    c.address_line,
    c.sub_district_name,
    c.district_name,
    c.state_name,
  ].filter(Boolean)
  return parts.join(', ') || '—'
}

export default function NearbyContactsPanel({
  clientId,
  farmerUserId,
  subscriptionId,
  currentAlertReceiverUserId,
  currentAlertReceiverName,
  currentAlertReceiverPhone,
  currentPromoterPunditUserId,
  currentPromoterPunditName,
  currentPromoterPunditPhone,
  currentFollowupPromoterUserId,
  currentFollowupPromoterName,
  currentFollowupPromoterPhone,
  subscriptionIsSelfSubscribed,
  canAssignAlertReceiver,
  onReceiverChanged,
}: {
  clientId: string
  farmerUserId: string
  subscriptionId: string
  // 2026-11-14 pt4 — Alert Receiver reassignment. Parent passes the
  // current state so the panel can highlight the row + enable the
  // radio. `canAssignAlertReceiver` gates the mutation (CA can view
  // but not change — same asymmetry as the call log).
  currentAlertReceiverUserId: string | null
  currentAlertReceiverName: string | null
  currentAlertReceiverPhone: string | null
  // 2026-11-14 pt6 — RM-pinned Promoter-Pundit. Same gate as Alert
  // Receiver (canAssignAlertReceiver). Radio enabled only for rows
  // where is_promoter_pundit=true — the backend rejects otherwise.
  currentPromoterPunditUserId: string | null
  currentPromoterPunditName: string | null
  currentPromoterPunditPhone: string | null
  // 2026-11-14 pt7 — RM-delegated Follow-up Promoter (SELF subs only).
  // subscriptionIsSelfSubscribed gates the column visibility — for
  // ASSIGNED subs the backend rejects the mutation anyway.
  currentFollowupPromoterUserId: string | null
  currentFollowupPromoterName: string | null
  currentFollowupPromoterPhone: string | null
  subscriptionIsSelfSubscribed: boolean
  canAssignAlertReceiver: boolean
  // Fires after ANY assignment change (alert receiver / promoter-
  // pundit / follow-up promoter). Parent refetches subs so
  // selectedSub reflects the new state.
  onReceiverChanged: () => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<RoleFilter>('ALL')
  // Pending-assignment state tracks WHICH field is being changed so
  // the confirm modal + the mutation call can route correctly.
  type PendingField = 'ALERT_RECEIVER' | 'PROMOTER_PUNDIT' | 'FOLLOWUP_PROMOTER'
  const [pendingField, setPendingField] = useState<PendingField | null>(null)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [pendingClear, setPendingClear] = useState<boolean>(false)
  const [mutating, setMutating] = useState<boolean>(false)
  const [mutErr, setMutErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    api.get<Payload>(
      `/client/${clientId}/farmer-support/farmers/${farmerUserId}/subscriptions/${subscriptionId}/nearby-contacts`,
    )
      .then(r => { if (!cancelled) setData(r.data) })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { detail?: string } }; message?: string }
        if (!cancelled) setError(err?.response?.data?.detail || err?.message || 'Failed to load contacts.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId, farmerUserId, subscriptionId])

  async function doSetAssignment(field: PendingField, newUserId: string | null) {
    setMutating(true); setMutErr(null)
    const endpoint = field === 'ALERT_RECEIVER'
      ? 'alert-receiver'
      : field === 'PROMOTER_PUNDIT'
        ? 'promoter-pundit'
        : 'followup-promoter'
    try {
      await api.put(
        `/client/${clientId}/farmer-support/farmers/${farmerUserId}/subscriptions/${subscriptionId}/${endpoint}`,
        { user_id: newUserId },
      )
      onReceiverChanged()
      setPendingUserId(null)
      setPendingClear(false)
      setPendingField(null)
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { detail?: string | { message?: string } } }; message?: string }
      const detail = err?.response?.data?.detail
      const detailMsg = typeof detail === 'object' ? detail?.message : (detail as string)
      const label = field === 'ALERT_RECEIVER'
        ? 'Alert Receiver'
        : field === 'PROMOTER_PUNDIT'
          ? 'Promoter-Pundit'
          : 'Follow-up Promoter'
      setMutErr(`${err?.response?.status || ''} ${detailMsg || err?.message || `Failed to update ${label}.`}`.trim())
    } finally {
      setMutating(false)
    }
  }

  if (loading) return <p className="text-xs text-slate-400 italic">Loading nearby contacts…</p>
  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!data) return null

  // Filter predicates — each chip expresses one capability, and
  // they're inclusive (a Facilitator-who-is-also-Promoter matches
  // both the Facilitator chip AND the Promoter chip). Counts shown
  // on each chip reflect how many contacts would match that chip.
  function matches(c: Contact, f: RoleFilter): boolean {
    switch (f) {
      case 'ALL': return true
      case 'FACILITATOR': return c.promoter_types.includes('FACILITATOR')
      case 'DEALER': return c.promoter_types.includes('DEALER')
      case 'PROMOTER': return c.is_promoter
      case 'PROMOTER_PUNDIT': return c.is_promoter_pundit
    }
  }
  const filtered = data.contacts.filter(c => matches(c, typeFilter))
  const countBy = (f: RoleFilter) => data.contacts.filter(c => matches(c, f)).length

  const pendingNewUser = pendingUserId
    ? data.contacts.find(c => c.user_id === pendingUserId)
    : null

  return (
    <div className="space-y-3">
      {/* Current assignments header — always visible at top of panel.
          Shows BOTH the Alert Receiver and the pinned Promoter-Pundit.
          Each has its own Clear button (RM-only). */}
      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Current Alert Receiver
            </p>
            {currentAlertReceiverUserId ? (
              <p className="text-slate-800 font-semibold">
                {currentAlertReceiverName || '—'}
                {currentAlertReceiverPhone && (
                  <>
                    {' · '}
                    <a href={`tel:${currentAlertReceiverPhone}`} className="text-blue-700 hover:underline">
                      {currentAlertReceiverPhone}
                    </a>
                  </>
                )}
              </p>
            ) : (
              <p className="text-slate-500 italic">None assigned — alerts fall back to this sub&apos;s promoter.</p>
            )}
          </div>
          {canAssignAlertReceiver && currentAlertReceiverUserId && (
            <button type="button"
              onClick={() => { setPendingField('ALERT_RECEIVER'); setPendingClear(true); setMutErr(null) }}
              disabled={mutating}
              className="text-[11px] text-rose-700 hover:text-rose-900 hover:underline font-semibold disabled:opacity-50">
              Clear (restore default)
            </button>
          )}
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap border-t border-slate-100 pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Current Promoter-Pundit
            </p>
            {currentPromoterPunditUserId ? (
              <p className="text-slate-800 font-semibold">
                {currentPromoterPunditName || '—'}
                {currentPromoterPunditPhone && (
                  <>
                    {' · '}
                    <a href={`tel:${currentPromoterPunditPhone}`} className="text-blue-700 hover:underline">
                      {currentPromoterPunditPhone}
                    </a>
                  </>
                )}
              </p>
            ) : (
              <p className="text-slate-500 italic">None pinned — queries route via default rules.</p>
            )}
          </div>
          {canAssignAlertReceiver && currentPromoterPunditUserId && (
            <button type="button"
              onClick={() => { setPendingField('PROMOTER_PUNDIT'); setPendingClear(true); setMutErr(null) }}
              disabled={mutating}
              className="text-[11px] text-rose-700 hover:text-rose-900 hover:underline font-semibold disabled:opacity-50">
              Clear (restore default)
            </button>
          )}
        </div>
        {/* Follow-up Promoter — SELF subs only (RM-delegated
            facilitator for farmers who signed up without a promoter). */}
        {subscriptionIsSelfSubscribed && (
          <div className="flex items-start justify-between gap-3 flex-wrap border-t border-slate-100 pt-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                Current Follow-up Promoter
              </p>
              {currentFollowupPromoterUserId ? (
                <p className="text-slate-800 font-semibold">
                  {currentFollowupPromoterName || '—'}
                  {currentFollowupPromoterPhone && (
                    <>
                      {' · '}
                      <a href={`tel:${currentFollowupPromoterPhone}`} className="text-blue-700 hover:underline">
                        {currentFollowupPromoterPhone}
                      </a>
                    </>
                  )}
                </p>
              ) : (
                <p className="text-slate-500 italic">
                  None assigned — this farmer self-subscribed. Delegate a facilitator-promoter to share follow-up.
                </p>
              )}
            </div>
            {canAssignAlertReceiver && currentFollowupPromoterUserId && (
              <button type="button"
                onClick={() => { setPendingField('FOLLOWUP_PROMOTER'); setPendingClear(true); setMutErr(null) }}
                disabled={mutating}
                className="text-[11px] text-rose-700 hover:text-rose-900 hover:underline font-semibold disabled:opacity-50">
                Clear (remove delegation)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Confirmation modal — appears either for a new assignment
          (pendingNewUser set) or a Clear (pendingClear). pendingField
          decides which field (Alert Receiver vs Promoter-Pundit)
          is being changed. */}
      {(pendingNewUser || pendingClear) && pendingField && (() => {
        const fieldLabel = pendingField === 'ALERT_RECEIVER'
          ? 'Alert Receiver'
          : pendingField === 'PROMOTER_PUNDIT'
            ? 'Promoter-Pundit'
            : 'Follow-up Promoter'
        const currentName = pendingField === 'ALERT_RECEIVER'
          ? currentAlertReceiverName
          : pendingField === 'PROMOTER_PUNDIT'
            ? currentPromoterPunditName
            : currentFollowupPromoterName
        const effectBlurb = pendingField === 'ALERT_RECEIVER'
          ? "They'll start receiving alerts immediately."
          : pendingField === 'PROMOTER_PUNDIT'
            ? "They'll start receiving the farmer's expert queries immediately."
            : "They'll gain access to the farmer's advisory and start helping with follow-up."
        const clearBlurb = pendingField === 'ALERT_RECEIVER'
          ? "Alerts will go to the default contact (this subscription's promoter)."
          : pendingField === 'PROMOTER_PUNDIT'
            ? "Queries will route via the default rules again."
            : "The facilitator will lose advisory access on this subscription. Your RM remains the farmer's primary contact."
        return (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl">
            <p className="text-sm font-bold text-slate-900 mb-2">
              {pendingClear ? `Clear ${fieldLabel}?` : `Change ${fieldLabel}?`}
            </p>
            <p className="text-xs text-slate-700 mb-3">
              {pendingClear ? clearBlurb : (
                <>
                  Change from{' '}
                  <strong>{currentName || 'None'}</strong>
                  {' '}to{' '}
                  <strong>{pendingNewUser?.name || '—'}</strong>
                  . {effectBlurb}
                </>
              )}
            </p>
            <p className="text-[11px] text-slate-500 italic mb-4">
              The farmer will be notified by SMS (best-effort). This change is permanent-logged in the audit trail.
            </p>
            {mutErr && (
              <p className="text-xs text-red-600 mb-3">{mutErr}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button"
                onClick={() => { setPendingUserId(null); setPendingClear(false); setPendingField(null); setMutErr(null) }}
                disabled={mutating}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded disabled:opacity-50">
                Cancel
              </button>
              <button type="button"
                onClick={() => doSetAssignment(pendingField, pendingClear ? null : (pendingUserId as string))}
                disabled={mutating}
                className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded hover:bg-slate-900 disabled:opacity-50">
                {mutating ? 'Saving…' : (pendingClear ? 'Clear' : 'Change')}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {!data.farmer_has_gps && (
        <p className="text-[11px] text-amber-700 italic">
          Farmer has no GPS on file — distances are not shown. Contacts are still listed.
        </p>
      )}
      {data.contacts.length === 0 ? (
        <p className="text-xs text-slate-500 italic">No onboarded contacts at this client.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 text-[11px]">
            {(['ALL', 'FACILITATOR', 'DEALER', 'PROMOTER', 'PROMOTER_PUNDIT'] as RoleFilter[]).map(f => {
              const n = countBy(f)
              if (f !== 'ALL' && n === 0) return null
              const label = f === 'ALL' ? 'All'
                : f === 'FACILITATOR' ? 'Facilitator'
                : f === 'DEALER' ? 'Dealer'
                : f === 'PROMOTER' ? 'Promoter'
                : 'Promoter-Pundit'
              return (
                <button key={f} type="button"
                  onClick={() => setTypeFilter(f)}
                  className={`px-2 py-0.5 rounded-full border ${
                    typeFilter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-300 hover:border-slate-500'
                  }`}>
                  {label} ({n})
                </button>
              )
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  {canAssignAlertReceiver && (
                    <>
                      <th className="text-center px-2 py-2 w-16">Alert<br />Receiver</th>
                      <th className="text-center px-2 py-2 w-16">Promoter-<br />Pundit</th>
                      {subscriptionIsSelfSubscribed && (
                        <th className="text-center px-2 py-2 w-16">Follow-up<br />Promoter</th>
                      )}
                    </>
                  )}
                  <th className="text-left px-2 py-2">Name</th>
                  <th className="text-left px-2 py-2">Role</th>
                  <th className="text-left px-2 py-2">Distance</th>
                  <th className="text-left px-2 py-2">Phone</th>
                  <th className="text-left px-2 py-2">Address</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const isCurrentAR = c.user_id === currentAlertReceiverUserId
                  const isCurrentPP = c.user_id === currentPromoterPunditUserId
                  const isCurrentFP = c.user_id === currentFollowupPromoterUserId
                  // Follow-up Promoter eligibility: Facilitator (any
                  // promoter_type incl. FACILITATOR) AND is_promoter=TRUE.
                  // Backend rejects otherwise with 422.
                  const isEligibleFP = c.promoter_types.includes('FACILITATOR') && c.is_promoter
                  const rowHighlight = isCurrentAR
                    ? 'bg-amber-50 border-l-4 border-l-amber-400'
                    : isCurrentPP
                      ? 'bg-violet-50 border-l-4 border-l-violet-400'
                      : isCurrentFP
                        ? 'bg-emerald-50 border-l-4 border-l-emerald-500'
                        : ''
                  return (
                  <tr key={c.user_id} className={`border-b border-slate-50 ${rowHighlight}`}>
                    {canAssignAlertReceiver && (
                      <>
                        <td className="px-2 py-2 text-center">
                          <input type="radio"
                            name="alert-receiver"
                            checked={isCurrentAR}
                            disabled={mutating}
                            onChange={() => {
                              if (isCurrentAR) return
                              setPendingField('ALERT_RECEIVER')
                              setPendingUserId(c.user_id)
                              setMutErr(null)
                            }}
                            aria-label={`Assign ${c.name || 'contact'} as Alert Receiver`} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          {/* Only P-Ps are eligible — radio hidden on
                              non-P-P rows to make the valid set obvious. */}
                          {c.is_promoter_pundit ? (
                            <input type="radio"
                              name="promoter-pundit"
                              checked={isCurrentPP}
                              disabled={mutating}
                              onChange={() => {
                                if (isCurrentPP) return
                                setPendingField('PROMOTER_PUNDIT')
                                setPendingUserId(c.user_id)
                                setMutErr(null)
                              }}
                              aria-label={`Pin ${c.name || 'contact'} as Promoter-Pundit`} />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        {subscriptionIsSelfSubscribed && (
                          <td className="px-2 py-2 text-center">
                            {/* Only Facilitator-Promoters eligible for
                                Follow-up Promoter — dealer-promoters
                                are deliberately excluded (commerce-
                                primary role). */}
                            {isEligibleFP ? (
                              <input type="radio"
                                name="followup-promoter"
                                checked={isCurrentFP}
                                disabled={mutating}
                                onChange={() => {
                                  if (isCurrentFP) return
                                  setPendingField('FOLLOWUP_PROMOTER')
                                  setPendingUserId(c.user_id)
                                  setMutErr(null)
                                }}
                                aria-label={`Delegate ${c.name || 'contact'} as Follow-up Promoter`} />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                      </>
                    )}
                    <td className="px-2 py-2 font-medium text-slate-800">
                      {c.name || '—'}
                      {isCurrentAR && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-amber-400 text-slate-900">
                          Current Alert Receiver
                        </span>
                      )}
                      {isCurrentPP && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-violet-500 text-white">
                          Current Promoter-Pundit
                        </span>
                      )}
                      {isCurrentFP && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-[1px] rounded bg-emerald-500 text-white">
                          Current Follow-up Promoter
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.promoter_types.map(t => (
                          <span key={t}
                            className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              TYPE_TONE[t] || 'bg-slate-100 text-slate-700'
                            }`}>
                            {TYPE_LABEL[t] || t}
                          </span>
                        ))}
                        {c.is_promoter && (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-800">
                            Promoter
                          </span>
                        )}
                        {c.is_promoter_pundit && (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold bg-violet-100 text-violet-800">
                            Promoter-Pundit
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {c.distance_km != null ? `${c.distance_km} km` : <span className="text-slate-400 italic">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} className="text-blue-700 hover:underline font-mono text-[11px]">
                          {c.phone}
                        </a>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-2 py-2 text-slate-600 text-[11px]">
                      {joinAddr(c)}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
