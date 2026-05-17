// 2026-05-17 — extracted from app/advisory/global/[id]/page.tsx so the
// SA-portal PG editor (and any future UCAT-pipe authoring surface)
// can share the same humanised practice label without copy-paste.
// Per feedback_ucat_no_shortcuts.md: "Practices is the heart;
// default to shared helper."

export interface PracticeElementLike {
  element_type: string
  value: string | null
  display_value: string | null
}

export interface PracticeLike {
  l0_type: string
  l2_type: string | null
  elements?: PracticeElementLike[]
}

export function humanize(s: string): string {
  return s.toLowerCase().split('_').map(w => (w[0]?.toUpperCase() || '') + w.slice(1)).join(' ')
}

// L2 + Common Name + Trade Name (separator: bullet). Falls back to the
// L0 token when no L2 and no identity-bearing element are present.
export function practiceLabel(p: PracticeLike): string {
  const tokens: string[] = []
  if (p.l2_type) tokens.push(humanize(p.l2_type))
  const cn = p.elements?.find(e => e.element_type === 'COMMON_NAME')
  if (cn?.display_value) tokens.push(cn.display_value)
  const bn = p.elements?.find(e => e.element_type === 'BRAND_NAME')
  if (bn?.display_value) tokens.push(bn.display_value)
  return tokens.length > 0 ? tokens.join(' • ') : p.l0_type
}

// Per-L0 distinguishing label for the Practice row in the Timeline
// expansion (Batch 39H, 2026-05-15):
//   INPUT       → L2 • Common Name • Trade Name (practiceLabel)
//   INSTRUCTION → L2 • TITLE
//   MEDIA       → L2 • TITLE
//   NON_INPUT   → L2 • first non-INSTRUCTIONS element value
//                 (with adjacent unit appended when the next element
//                 is a *_UNIT field)
export function practiceShortLabel(p: PracticeLike): string {
  if (!p.l2_type) return 'No sub-type'
  const l2Human = humanize(p.l2_type)
  if (p.l0_type === 'INPUT') return practiceLabel(p)
  if (p.l0_type === 'INSTRUCTION' || p.l0_type === 'MEDIA') {
    const title = p.elements?.find(e => e.element_type === 'TITLE')
    const t = title?.display_value || title?.value
    return t ? `${l2Human} • ${t}` : l2Human
  }
  // NON_INPUT: walk elements in display order; pick the first non-
  // INSTRUCTIONS field with a value. If the next element is its
  // matching *_UNIT, append it for context.
  const els = p.elements || []
  for (let i = 0; i < els.length; i++) {
    const e = els[i]
    if (e.element_type === 'INSTRUCTIONS') continue
    const v = e.display_value || e.value
    if (!v) continue
    const next = els[i + 1]
    if (next && next.element_type.endsWith('_UNIT')) {
      const u = next.display_value || next.value
      if (u) return `${l2Human} • ${v} ${u}`
    }
    return `${l2Human} • ${v}`
  }
  return l2Human
}
