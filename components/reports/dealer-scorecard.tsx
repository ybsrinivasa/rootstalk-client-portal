'use client'

// Per-dealer leads/conversion summary. Row per dealer + pooled footer.
// Bar shows the conversion rate visually; % coloured green/amber/red.

export interface DealerScoreRow {
  dealer_user_id: string | null
  dealer_name: string
  leads: number
  converted: number
  pooled?: boolean
}

interface Props {
  rows: DealerScoreRow[]
  pooled: DealerScoreRow | null
  loading: boolean
  brandColour: string
}

function pct(a: number, b: number): number {
  if (b <= 0) return 0
  return Math.round((a / b) * 100)
}

function pctColour(p: number): string {
  if (p >= 85) return '#15803d'
  if (p >= 60) return '#B45309'
  return '#B91C1C'
}

export function DealerScorecard({ rows, pooled, loading, brandColour }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Dealer Scorecard
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Leads received vs converted, per dealer. Pesticide + fertilizer + seed leads combined.
          </p>
        </div>
      </div>
      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-sm">No dealer activity with the current filters.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 uppercase tracking-wider text-left border-b border-slate-100">
              <th className="pb-2 font-medium">Dealer</th>
              <th className="pb-2 font-medium text-right">Leads</th>
              <th className="pb-2 font-medium text-right">Converted</th>
              <th className="pb-2 font-medium text-right w-32">Conv %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const p = pct(r.converted, r.leads)
              return (
                <tr key={r.dealer_user_id || 'row'} className="border-b border-slate-50 last:border-b-0">
                  <td className="py-2 truncate max-w-[16rem]" title={r.dealer_name}>
                    {r.dealer_name}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    {r.leads.toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-700">
                    {r.converted.toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full"
                          style={{ width: `${p}%`, backgroundColor: brandColour }}
                        />
                      </div>
                      <span className="w-10 font-medium" style={{ color: pctColour(p) }}>
                        {p}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
            {pooled && (
              <tr className="border-t-2 border-slate-200">
                <td className="pt-3 font-semibold text-slate-800">{pooled.dealer_name}</td>
                <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">
                  {pooled.leads.toLocaleString()}
                </td>
                <td className="pt-3 text-right tabular-nums font-semibold text-slate-800">
                  {pooled.converted.toLocaleString()}
                </td>
                <td className="pt-3 text-right tabular-nums font-semibold">
                  <span style={{ color: pctColour(pct(pooled.converted, pooled.leads)) }}>
                    {pct(pooled.converted, pooled.leads)}%
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
