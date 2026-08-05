'use client'

// Per-pundit scorecard used by /reports/queries. Event counts, not
// distinct-query counts — sum across rows will NOT equal total queries
// (a forwarded query is counted on both pundits). The caption on the
// panel says so explicitly.
//
// Role influences which column reads as populated: PANEL pundits fill
// "Returned", PRIMARY / PROMOTER_PUNDIT fill "Forwarded".

export interface PunditScoreRow {
  pundit_id: string | null
  name: string
  role: 'PRIMARY' | 'PANEL' | 'PROMOTER_PUNDIT' | null
  direct: number
  forwarded_in: number
  responded: number
  forwarded_out: number
  returned: number
  expired: number
  avg_response_seconds: number
}

interface Props {
  rows: PunditScoreRow[]
  pooled: PunditScoreRow | null
  loading: boolean
  brandColour: string
}

function fmtAvgResponse(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const mins = seconds / 60
  if (mins < 60) return `${Math.round(mins)}m`
  const hours = mins / 60
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${Math.round(hours / 24)}d`
}

function roleLabel(role: PunditScoreRow['role']): string {
  if (role === 'PRIMARY') return 'Company Expert'
  if (role === 'PANEL') return 'Panel Expert'
  if (role === 'PROMOTER_PUNDIT') return 'Promoter Expert'
  return '—'
}

export function PunditScorecard({ rows, pooled, loading, brandColour }: Props) {
  const maxReceptions = rows.length > 0
    ? Math.max(1, ...rows.map(r => r.direct + r.forwarded_in))
    : 1
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Pundit Scorecard
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Event counts per pundit — receptions, responses, hand-offs, expiries. Receptions = direct + forwarded-in; a query that was forwarded shows on BOTH pundits' rows, so summing here won't equal total queries.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-sm">No pundit activity with the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wider text-left border-b border-slate-100">
                <th className="pb-2 font-medium">Pundit</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium text-right w-40">Receptions</th>
                <th className="pb-2 font-medium text-right w-20">Resp.</th>
                <th className="pb-2 font-medium text-right w-20">Fwd out</th>
                <th className="pb-2 font-medium text-right w-20">Returned</th>
                <th className="pb-2 font-medium text-right w-20">Expired</th>
                <th className="pb-2 font-medium text-right w-24">Avg time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const total = r.direct + r.forwarded_in
                const barWidth = Math.round((total / maxReceptions) * 100)
                return (
                  <tr key={r.pundit_id || 'row'} className="border-b border-slate-50 last:border-b-0">
                    <td className="py-2 truncate max-w-[14rem]" title={r.name}>
                      {r.name}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {roleLabel(r.role)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-700">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-14 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full"
                            style={{ width: `${barWidth}%`, backgroundColor: brandColour }}
                          />
                        </div>
                        <span className="w-24 text-xs">
                          <span className="font-medium">{total.toLocaleString()}</span>
                          <span className="text-slate-400"> = {r.direct.toLocaleString()} + {r.forwarded_in.toLocaleString()}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{r.responded.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{r.forwarded_out.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{r.returned.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-slate-700">{r.expired.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500 text-xs">
                      {fmtAvgResponse(r.avg_response_seconds)}
                    </td>
                  </tr>
                )
              })}
              {pooled && (
                <tr className="border-t-2 border-slate-200">
                  <td className="pt-3 font-semibold text-slate-800">{pooled.name}</td>
                  <td className="pt-3"></td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">
                    <span>{(pooled.direct + pooled.forwarded_in).toLocaleString()}</span>
                    <span className="text-slate-400 font-normal"> = {pooled.direct.toLocaleString()} + {pooled.forwarded_in.toLocaleString()}</span>
                  </td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">{pooled.responded.toLocaleString()}</td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">{pooled.forwarded_out.toLocaleString()}</td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">{pooled.returned.toLocaleString()}</td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">{pooled.expired.toLocaleString()}</td>
                  <td className="pt-3 text-right tabular-nums font-semibold text-slate-800 text-xs">
                    {fmtAvgResponse(pooled.avg_response_seconds)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
