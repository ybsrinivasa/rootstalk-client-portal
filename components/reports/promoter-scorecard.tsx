'use client'

// Per-promoter scorecard used by /reports/promoters. Row per promoter
// + pooled totals footer. Mirrors DealerScorecard shape.

export interface PromoterScoreRow {
  promoter_user_id: string | null
  name: string
  subscriptions: number
  acres: number
  leads: number
}

interface Props {
  rows: PromoterScoreRow[]
  pooled: PromoterScoreRow | null
  loading: boolean
  brandColour: string
}

function fmtAcres(v: number): string {
  const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10
  return rounded.toLocaleString()
}

export function PromoterScorecard({ rows, pooled, loading, brandColour }: Props) {
  const maxSubs = rows.length > 0 ? Math.max(1, ...rows.map(r => r.subscriptions)) : 1
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Promoter Scorecard
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Subscriptions promoted, acres, and leads generated to your dealers, per promoter.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-sm">No promoter activity with the current filters.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 uppercase tracking-wider text-left border-b border-slate-100">
              <th className="pb-2 font-medium">Promoter</th>
              <th className="pb-2 font-medium text-right w-40">Subscriptions</th>
              <th className="pb-2 font-medium text-right w-24">Acres</th>
              <th className="pb-2 font-medium text-right w-24">Leads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const barWidth = Math.round((r.subscriptions / maxSubs) * 100)
              return (
                <tr key={r.promoter_user_id || 'row'} className="border-b border-slate-50 last:border-b-0">
                  <td className="py-2 truncate max-w-[16rem]" title={r.name}>
                    {r.name}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full"
                          style={{ width: `${barWidth}%`, backgroundColor: brandColour }}
                        />
                      </div>
                      <span className="w-10 font-medium">
                        {r.subscriptions.toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    {fmtAcres(r.acres)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    {r.leads.toLocaleString()}
                  </td>
                </tr>
              )
            })}
            {pooled && (
              <tr className="border-t-2 border-slate-200">
                <td className="pt-3 font-semibold text-slate-800">{pooled.name}</td>
                <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">
                  {pooled.subscriptions.toLocaleString()}
                </td>
                <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">
                  {fmtAcres(pooled.acres)}
                </td>
                <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">
                  {pooled.leads.toLocaleString()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
