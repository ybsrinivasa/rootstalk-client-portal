'use client'

// Batch 39P-b2 (2026-05-16) — shared Relations section for the
// "Practices" UCAT shape across every advisory pipe (CCA, CHA-PG,
// future SP / Q&A). Encapsulates:
//
//   • the Relations list rendered under an expanded Timeline,
//   • the "+ Add Relation" entry-point,
//   • the full chain-builder modal (linear chain with AND/OR ops,
//     Add-to-List for reusable sub-expressions, Gate-1 L0/L1
//     restrictions, mixed AND-OR resolver into the backend's
//     `parts[part][option][position]` shape),
//   • Delete on existing relations.
//
// Every callsite supplies the timeline id, the practices on that
// timeline, and the pipe context (CCA-Global Package or CHA-PG-
// Global). The component derives the right endpoint URLs from
// `lib/advisory-pipe`, so the same code drives every pipe.
//
// Lifted verbatim from `app/advisory/global/[id]/page.tsx` (Batches
// 39B / 39C-rev2 / 39C-checks / 39C-checks2 / 39C-checks4 /
// 39C-bugfix1) — only the URL plumbing and prop shape changed.

import { useEffect, useState, FormEvent } from 'react'
import api from '@/lib/api'
import { extractErrorMessage } from '@/lib/errors'
import { relationEndpoints, type PipeContext } from '@/lib/advisory-pipe'

// ── Public types re-used by callers ────────────────────────────────────

export interface RelationsPractice {
  id: string
  l0_type: string
  l1_type: string | null
  l2_type: string | null
  is_special_input: boolean
  /** Optional — when supplied, the labeller prefers Common Name + Trade
   *  Name over the L2 token. CCA's practice list bundles elements; PG's
   *  doesn't (yet), so this is optional and the labeller degrades
   *  gracefully. */
  elements?: Array<{
    element_type: string
    value: string | null
    display_value?: string | null
  }>
}

export interface RelationOut {
  id: string
  relation_type: 'AND' | 'OR' | 'IF'
  expression: string | null
  parts: string[][][]
  conditional: {
    question_id: string
    question_text: string | null
    answer: 'YES' | 'NO' | 'BOTH'
  } | null
}

interface RelationListItem {
  id: string
  slots: string[]
  ops: ('AND' | 'OR')[]
}

// ── Public labeller (also used by the parent page for chip rendering) ──

export function humanize(s: string): string {
  return s.toLowerCase().split('_').map(
    w => (w[0]?.toUpperCase() || '') + w.slice(1),
  ).join(' ')
}

export function practiceLabel(p: RelationsPractice): string {
  const tokens: string[] = []
  if (p.l2_type) tokens.push(humanize(p.l2_type))
  const cn = p.elements?.find(e => e.element_type === 'COMMON_NAME')
  if (cn?.display_value) tokens.push(cn.display_value)
  const bn = p.elements?.find(e => e.element_type === 'BRAND_NAME')
  if (bn?.display_value) tokens.push(bn.display_value)
  return tokens.length > 0 ? tokens.join(' • ') : p.l0_type
}

// ── Component ──────────────────────────────────────────────────────────

interface Props {
  timelineId: string
  timelineName?: string
  practices: RelationsPractice[]
  pipe: PipeContext
  /** Fires whenever the section finishes loading or refreshing
   *  relations. Parents like the CCA Global page use this to keep a
   *  `relationsByTimeline` map for downstream features (e.g., CQ
   *  attachment-label lookup) without re-fetching themselves. */
  onRelationsChange?: (timelineId: string, relations: RelationOut[]) => void
}

export function RelationsSection({
  timelineId, timelineName, practices, pipe, onRelationsChange,
}: Props) {
  const endpoints = relationEndpoints(pipe)

  const [relations, setRelations] = useState<RelationOut[] | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [chainSlots, setChainSlots] = useState<string[]>([])
  const [chainOps, setChainOps] = useState<('AND' | 'OR')[]>([])
  const [pickingOp, setPickingOp] = useState(false)
  const [listItems, setListItems] = useState<RelationListItem[]>([])
  const [relationForm, setRelationForm] = useState<{ expression: string }>({ expression: '' })
  const [savingRelation, setSavingRelation] = useState(false)
  const [relationError, setRelationError] = useState('')

  // ── Load relations on mount + reload after writes ────────────────────

  async function loadRelations() {
    try {
      const { data } = await api.get<RelationOut[]>(endpoints.list(timelineId))
      setRelations(data)
      onRelationsChange?.(timelineId, data)
    } catch {
      setRelations([])
      onRelationsChange?.(timelineId, [])
    }
  }

  useEffect(() => { loadRelations() }, [timelineId])

  // ── Pure helpers (preserved from CCA's inline implementation) ────────

  function slotDisplay(
    slot: string, ps: RelationsPractice[], items: RelationListItem[],
  ): string {
    if (slot.startsWith('list:')) {
      const id = slot.slice(5)
      const item = items.find(i => i.id === id)
      if (!item) return id
      return `${item.id}: ${renderChainText(item.slots, item.ops, ps, items)}`
    }
    const p = ps.find(x => x.id === slot)
    if (!p) return slot.slice(0, 8)
    return practiceLabel(p)
  }

  function renderChainText(
    slots: string[], ops: ('AND' | 'OR')[],
    ps: RelationsPractice[], items: RelationListItem[],
  ): string {
    if (slots.length === 0) return ''
    const parts: string[] = []
    for (let i = 0; i < slots.length; i++) {
      if (i > 0) parts.push(ops[i - 1])
      const slot = slots[i]
      if (slot.startsWith('list:')) {
        const id = slot.slice(5)
        const item = items.find(it => it.id === id)
        if (item) {
          parts.push('(' + renderChainText(item.slots, item.ops, ps, items) + ')')
        } else {
          parts.push(id)
        }
      } else {
        const p = ps.find(x => x.id === slot)
        parts.push(p ? practiceLabel(p) : slot.slice(0, 8))
      }
    }
    return parts.join(' ')
  }

  function chainIsPureOR(): boolean {
    return chainOps.length > 0 && chainOps.every(o => o === 'OR')
  }
  function chainIsPureAND(): boolean {
    return chainOps.length > 0 && chainOps.every(o => o === 'AND')
  }
  function chainIsPure(): boolean {
    return chainIsPureOR() || chainIsPureAND()
  }

  // Gate-1 echo (CCA Batch 39C-checks2): refuses non-L0:INPUT and
  // cross-L1 OR shapes before the backend would 422.
  function gate1Failure(): string | null {
    const resolved: Array<{ l0: string; l1: string | null; special: boolean }> = []
    for (const slot of chainSlots) {
      if (slot.startsWith('list:')) {
        const item = listItems.find(i => i.id === slot.slice(5))
        if (!item) continue
        for (const sub of item.slots) {
          if (sub.startsWith('list:')) continue
          const p = practices.find(x => x.id === sub)
          if (p) resolved.push({ l0: p.l0_type, l1: p.l1_type, special: p.is_special_input })
        }
      } else {
        const p = practices.find(x => x.id === slot)
        if (p) resolved.push({ l0: p.l0_type, l1: p.l1_type, special: p.is_special_input })
      }
    }
    for (const r of resolved) {
      if (r.l0 !== 'INPUT') {
        return 'Relations are L0:INPUT only — drop the non-input slot.'
      }
    }
    if (chainIsPureOR()) {
      const l1s = new Set<string>()
      for (const r of resolved) {
        if (r.special) continue
        if (r.l1) l1s.add(r.l1)
      }
      if (l1s.size > 1) {
        return `OR is restricted to a single L1 group (chain spans ${[...l1s].join(', ')}).`
      }
    }
    return null
  }

  // Add-to-List: list items must be built from raw practices only —
  // referencing an existing List item would double-bracket the saved
  // Relation. SAVE remains free of this check (compose at save time).
  function addToListShapeFailure(): string | null {
    const refs: string[] = []
    for (const slot of chainSlots) {
      if (slot.startsWith('list:')) refs.push(slot.slice(5))
    }
    if (refs.length > 0) {
      const list = refs.join(', ')
      return `A List item must be built from practices only. The chain already references ${list} from the List — compose List items together at SAVE time, not inside another List item.`
    }
    return null
  }

  function canAddToList(): boolean {
    if (chainSlots.length < 2) return false
    if (!chainIsPure()) return false
    if (gate1Failure()) return false
    if (addToListShapeFailure()) return false
    return true
  }
  function addToListBlockedReason(): string {
    if (chainSlots.length < 2) return 'Pick at least 2 slots first.'
    if (!chainIsPure()) return 'ADD TO LIST needs a single operator type (all AND or all OR).'
    const f = gate1Failure()
    if (f) return f
    const s = addToListShapeFailure()
    if (s) return s
    return 'Save the current chain as a reusable List item.'
  }

  function canSave(): boolean {
    return chainSlots.length >= 2
  }
  function saveBlockedReason(): string {
    if (chainSlots.length < 2) return 'A Relation needs at least 2 slots.'
    return ''
  }

  // L0/L1 anchors in chain, used by canPickOR + slotOptions.
  function chainAnchorL1s(): Set<string> {
    const l1s = new Set<string>()
    const collect = (pid: string) => {
      const p = practices.find(x => x.id === pid)
      if (!p || p.is_special_input) return
      if (p.l0_type === 'INPUT' && p.l1_type) l1s.add(p.l1_type)
    }
    for (const slot of chainSlots) {
      if (slot.startsWith('list:')) {
        const item = listItems.find(it => it.id === slot.slice(5))
        if (item) for (const sub of item.slots) {
          if (!sub.startsWith('list:')) collect(sub)
        }
      } else {
        collect(slot)
      }
    }
    return l1s
  }

  function canPickOR(): boolean {
    const anchors = chainAnchorL1s()
    return !(anchors.has('PESTICIDE') && anchors.has('FERTILIZER'))
  }

  function practiceIdsInAnyRelation(): Set<string> {
    const out = new Set<string>()
    for (const r of (relations || [])) {
      for (const part of r.parts) for (const opt of part) for (const pid of opt) {
        out.add(pid)
      }
    }
    return out
  }

  function slotOptions(
    isFirstSlot: boolean, nextOp: 'AND' | 'OR' | null,
  ): Array<{ value: string; label: string; kind: 'PRACTICE' | 'LIST'; eligible: boolean; reason?: string }> {
    const inOther = practiceIdsInAnyRelation()
    const usedInChain = new Set(chainSlots)
    const anchors = chainAnchorL1s()

    const evaluate = (
      candidatePractices: Array<{ l0: string; l1: string | null; special: boolean }>,
    ): { eligible: boolean; reason?: string } => {
      for (const cp of candidatePractices) {
        if (cp.l0 !== 'INPUT') {
          return { eligible: false, reason: 'not L0:INPUT (Relations are input-only)' }
        }
      }
      if (isFirstSlot || nextOp === 'AND') return { eligible: true }
      if (nextOp === 'OR') {
        if (anchors.size === 0) return { eligible: true }
        for (const cp of candidatePractices) {
          if (cp.special) continue
          if (cp.l1 && !anchors.has(cp.l1)) {
            return {
              eligible: false,
              reason: `OR is locked to ${[...anchors].join('/')} group (or Special Inputs)`,
            }
          }
        }
        return { eligible: true }
      }
      return { eligible: true }
    }

    const out: Array<{ value: string; label: string; kind: 'PRACTICE' | 'LIST'; eligible: boolean; reason?: string }> = []
    for (const p of practices) {
      if (inOther.has(p.id)) continue
      if (usedInChain.has(p.id)) continue
      const { eligible, reason } = evaluate([{ l0: p.l0_type, l1: p.l1_type, special: p.is_special_input }])
      out.push({ value: p.id, label: practiceLabel(p), kind: 'PRACTICE', eligible, reason })
    }
    for (const item of listItems) {
      const key = `list:${item.id}`
      if (usedInChain.has(key)) continue
      const subPractices = item.slots
        .filter(s => !s.startsWith('list:'))
        .map(s => practices.find(x => x.id === s))
        .filter((x): x is RelationsPractice => !!x)
        .map(p => ({ l0: p.l0_type, l1: p.l1_type, special: p.is_special_input }))
      const { eligible, reason } = evaluate(subPractices)
      out.push({
        value: key, kind: 'LIST',
        label: `${item.id}: ${renderChainText(item.slots, item.ops, practices, listItems)}`,
        eligible, reason,
      })
    }
    out.sort((a, b) => Number(b.eligible) - Number(a.eligible))
    return out
  }

  // ── Chain-builder actions ────────────────────────────────────────────

  function appendSlotValue(value: string) {
    setChainSlots(s => [...s, value])
    setRelationError('')
    setPickingOp(false)
  }
  function appendOp(op: 'AND' | 'OR') {
    setChainOps(o => [...o, op])
    setPickingOp(false)
  }
  function backOneSlot() {
    setChainSlots(s => s.slice(0, -1))
    setChainOps(o => o.slice(0, -1))
    setPickingOp(false)
  }
  function clearChain() {
    setChainSlots([])
    setChainOps([])
    setPickingOp(false)
    setRelationError('')
  }

  function addCurrentChainToList() {
    if (!canAddToList()) {
      setRelationError(addToListBlockedReason())
      return
    }
    const id = `L${listItems.length + 1}`
    setListItems(items => [...items, { id, slots: chainSlots.slice(), ops: chainOps.slice() }])
    clearChain()
  }

  function deleteListItem(itemId: string) {
    setListItems(items => items.filter(i => i.id !== itemId))
    const ref = `list:${itemId}`
    setChainSlots(slots => slots.filter(s => s !== ref))
    setChainOps(ops => {
      const before = chainSlots.length
      const dropped = chainSlots.filter(s => s === ref).length
      if (dropped === 0) return ops
      return ops.slice(0, Math.max(0, before - dropped - 1))
    })
  }

  // ── Save-time resolver: chain + listItems → backend 3-D parts ────────

  function resolveListItemKind(item: RelationListItem): 'AND' | 'OR' {
    if (item.ops.every(o => o === 'AND')) return 'AND'
    return 'OR'
  }

  function expandSlotForOR(
    slot: string, items: RelationListItem[],
  ): { kind: 'options'; options: string[][] } {
    if (slot.startsWith('list:')) {
      const item = items.find(i => i.id === slot.slice(5))
      if (item) {
        const k = resolveListItemKind(item)
        if (k === 'AND') return { kind: 'options', options: [item.slots.slice()] }
        return { kind: 'options', options: item.slots.map(s => [s]) }
      }
    }
    return { kind: 'options', options: [[slot]] }
  }

  function resolveChain(
    slots: string[], ops: ('AND' | 'OR')[], items: RelationListItem[],
  ): { relation_type: 'AND' | 'OR'; parts: string[][][] } {
    const allOR = ops.length > 0 && ops.every(o => o === 'OR')
    const allAND = ops.length > 0 && ops.every(o => o === 'AND')

    if (allOR) {
      const options: string[][] = []
      for (const slot of slots) {
        const exp = expandSlotForOR(slot, items)
        for (const opt of exp.options) options.push(opt)
      }
      return { relation_type: 'OR', parts: [options] }
    }

    if (allAND) {
      const parts: string[][][] = []
      let pending: string[] = []
      for (const slot of slots) {
        if (slot.startsWith('list:')) {
          const item = items.find(i => i.id === slot.slice(5))
          if (item) {
            if (resolveListItemKind(item) === 'OR') {
              if (pending.length > 0) {
                parts.push([pending])
                pending = []
              }
              parts.push(item.slots.map(s => [s]))
              continue
            }
            pending.push(...item.slots)
            continue
          }
        }
        pending.push(slot)
      }
      if (pending.length > 0) parts.push([pending])
      return { relation_type: 'AND', parts }
    }

    // Mixed chain — AND-tighter precedence; split on OR.
    const orSegments: string[][] = []
    let cur: string[] = [slots[0]]
    for (let i = 0; i < ops.length; i++) {
      if (ops[i] === 'AND') cur.push(slots[i + 1])
      else { orSegments.push(cur); cur = [slots[i + 1]] }
    }
    orSegments.push(cur)
    const options: string[][] = []
    for (const seg of orSegments) {
      const positions: string[] = []
      for (const slot of seg) {
        if (slot.startsWith('list:')) {
          const item = items.find(i => i.id === slot.slice(5))
          if (item) {
            if (resolveListItemKind(item) === 'OR') {
              throw new Error(
                `Mixed chain references list item ${item.id} (OR-group) inside an AND-segment. ` +
                `Add the OR-group as a separate List item and rebuild — or split into two saves.`,
              )
            }
            positions.push(...item.slots)
            continue
          }
        }
        positions.push(slot)
      }
      options.push(positions)
    }
    return { relation_type: 'OR', parts: [options] }
  }

  // ── Submit + delete ─────────────────────────────────────────────────

  async function handleSaveRelation(e: FormEvent) {
    e.preventDefault()
    if (!canSave()) {
      setRelationError(saveBlockedReason() || 'A Relation needs at least 2 slots.')
      return
    }
    setSavingRelation(true); setRelationError('')
    let resolved: { relation_type: 'AND' | 'OR'; parts: string[][][] }
    try {
      resolved = resolveChain(chainSlots, chainOps, listItems)
    } catch (err) {
      setRelationError(err instanceof Error ? err.message : 'Failed to resolve chain.')
      setSavingRelation(false)
      return
    }
    const expression = relationForm.expression.trim() ||
      renderChainText(chainSlots, chainOps, practices, listItems)
    try {
      await api.post(endpoints.create(timelineId), {
        relation_type: resolved.relation_type, parts: resolved.parts, expression,
      })
      await loadRelations()
      closeModal()
    } catch (err: unknown) {
      setRelationError(extractErrorMessage(err, 'Failed to save Relation.'))
    } finally { setSavingRelation(false) }
  }

  async function handleDeleteRelation(relId: string) {
    if (!confirm('Delete this Relation? The practices stay; only the grouping is removed.')) return
    try {
      await api.delete(endpoints.delete(relId))
      await loadRelations()
    } catch (err: unknown) {
      alert(extractErrorMessage(err, 'Failed to delete Relation.'))
    }
  }

  function openModal() {
    setModalOpen(true)
    clearChain()
    setListItems([])
    setRelationForm({ expression: '' })
  }
  function closeModal() {
    setModalOpen(false)
    setRelationError('')
  }

  // ── Render ───────────────────────────────────────────────────────────

  const liveExpression = renderChainText(chainSlots, chainOps, practices, listItems)
  const slotsCount = chainSlots.length
  const opsCount = chainOps.length
  const atSlotStateNeedFirst = slotsCount === 0
  const atSlotStateNeedNext = !atSlotStateNeedFirst && opsCount === slotsCount
  const atSlotStateAtOp = !atSlotStateNeedFirst && !atSlotStateNeedNext && pickingOp
  const atSlotStateAtSlot = !atSlotStateNeedFirst && !atSlotStateNeedNext && !pickingOp

  return (
    <>
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Relations</h4>
          <button onClick={openModal}
            className="text-xs font-medium text-blue-600 hover:underline">
            + Add Relation
          </button>
        </div>
        {!relations || relations.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No Relations on this Timeline yet.</p>
        ) : (
          <div className="space-y-2">
            {relations.map(rel => {
              const labelFor = (pid: string): string => {
                const p = practices.find(x => x.id === pid)
                if (!p) return pid.slice(0, 8)
                return practiceLabel(p)
              }
              const renderParts = (): string => {
                const partTexts: string[] = []
                for (const part of rel.parts) {
                  const optTexts: string[] = []
                  for (const opt of part) {
                    if (opt.length === 0) continue
                    if (opt.length === 1) optTexts.push(labelFor(opt[0]))
                    else optTexts.push('(' + opt.map(labelFor).join(' + ') + ')')
                  }
                  if (optTexts.length === 0) continue
                  partTexts.push(optTexts.length === 1 ? optTexts[0] : optTexts.join(' or '))
                }
                const outer = rel.relation_type === 'OR' ? ' or ' : ' + '
                return partTexts.join(outer)
              }
              const text = rel.expression || renderParts()
              const typeColour = rel.relation_type === 'AND'
                ? 'bg-blue-100 text-blue-700'
                : rel.relation_type === 'OR'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-purple-100 text-purple-700'
              return (
                <div key={rel.id} className="flex items-start gap-2 text-xs bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${typeColour} shrink-0`}>
                    {rel.relation_type}
                  </span>
                  <span className="text-slate-700 flex-1 min-w-0 break-words">{text}</span>
                  <button onClick={() => handleDeleteRelation(rel.id)}
                    className="text-slate-300 hover:text-red-500 shrink-0"
                    title="Delete Relation">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Add Relation</h2>
              {timelineName && (
                <p className="text-xs text-slate-500 mt-1">
                  Timeline: <span className="font-medium text-slate-700">{timelineName}</span>
                </p>
              )}
            </div>

            <form onSubmit={handleSaveRelation} className="overflow-y-auto p-6 space-y-5">
              <div>
                <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Building</span>
                <div className="mt-1 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-sm text-slate-700 min-h-[2.5rem] break-words">
                  {liveExpression || <span className="text-slate-400 italic">— pick a practice to start —</span>}
                </div>
              </div>

              {practices.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  No practices on this Timeline yet — add practices first, then come back.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    {chainSlots.map((slot, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        {i > 0 && (
                          <span className="text-[10px] uppercase tracking-wider text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                            {chainOps[i - 1]}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1.5 text-sm rounded-lg px-3 py-1.5 border ${slot.startsWith('list:') ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
                          <span className="font-medium">Slot {i + 1}:</span>
                          <span className="font-medium">{slotDisplay(slot, practices, listItems)}</span>
                        </span>
                      </div>
                    ))}

                    {atSlotStateNeedNext && (() => {
                      const lastOp = chainOps[chainOps.length - 1]
                      const opts = slotOptions(false, lastOp)
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-semibold">
                            {lastOp}
                          </span>
                          <select autoFocus value=""
                            onChange={e => { if (e.target.value) appendSlotValue(e.target.value) }}
                            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px]">
                            <option value="">— pick practice or List item —</option>
                            {opts.map(opt => (
                              <option key={opt.value} value={opt.value} disabled={!opt.eligible}>
                                {opt.kind === 'LIST' ? '↪ ' : ''}{opt.label}
                                {!opt.eligible && opt.reason ? ` — ${opt.reason}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    })()}

                    {atSlotStateNeedFirst && (() => {
                      const opts = slotOptions(true, null)
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-slate-600">Pick a practice:</span>
                          <select autoFocus value=""
                            onChange={e => { if (e.target.value) appendSlotValue(e.target.value) }}
                            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[280px]">
                            <option value="">— pick practice —</option>
                            {opts.map(opt => (
                              <option key={opt.value} value={opt.value} disabled={!opt.eligible}>
                                {opt.kind === 'LIST' ? '↪ ' : ''}{opt.label}
                                {!opt.eligible && opt.reason ? ` — ${opt.reason}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    })()}

                    {atSlotStateAtOp && (() => {
                      const orAllowed = canPickOR()
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 mr-1">Next operator:</span>
                          {(['AND', 'OR'] as const).map(op => {
                            const disabled = op === 'OR' && !orAllowed
                            return (
                              <button key={op} type="button" disabled={disabled}
                                onClick={() => appendOp(op)}
                                title={disabled ? 'OR not available — chain spans both Pesticides and Fertilizers.' : ''}
                                className="text-sm font-semibold px-4 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                {op}
                              </button>
                            )
                          })}
                          <button type="button" onClick={() => setPickingOp(false)}
                            className="text-xs text-slate-400 hover:text-slate-600 ml-2">cancel</button>
                        </div>
                      )
                    })()}

                    {atSlotStateAtSlot && slotsCount === 1 && (() => {
                      const orAllowed = canPickOR()
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 mr-1">Pick operator:</span>
                          {(['AND', 'OR'] as const).map(op => {
                            const disabled = op === 'OR' && !orAllowed
                            return (
                              <button key={op} type="button" disabled={disabled}
                                onClick={() => appendOp(op)}
                                title={disabled ? 'OR not available — chain spans both Pesticides and Fertilizers.' : ''}
                                className="text-sm font-semibold px-4 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed">
                                {op}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {atSlotStateAtSlot && slotsCount >= 2 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button type="button" onClick={addCurrentChainToList}
                          disabled={!canAddToList()}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={addToListBlockedReason()}>
                          + Add to List
                        </button>
                        <button type="button" onClick={() => setPickingOp(true)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
                          + Extend chain
                        </button>
                        <button type="button" onClick={backOneSlot}
                          className="text-xs text-slate-500 hover:text-red-500 px-2 py-1.5">
                          ← Remove last
                        </button>
                        <div className="flex-1" />
                        <span className="text-[11px] text-slate-400">
                          {chainIsPure()
                            ? `pure ${chainIsPureAND() ? 'AND' : 'OR'} chain`
                            : 'mixed AND/OR — only SAVE is allowed'}
                        </span>
                      </div>
                    )}
                  </div>

                  {listItems.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                        List <span className="text-slate-400 font-normal">(reusable in slots above)</span>
                      </h3>
                      <div className="space-y-1.5">
                        {listItems.map(item => (
                          <div key={item.id} className="flex items-start gap-2 text-xs bg-purple-50 border border-purple-100 rounded-lg px-3 py-1.5">
                            <span className="font-bold text-purple-700 shrink-0">{item.id}:</span>
                            <span className="text-slate-700 flex-1 min-w-0 break-words">
                              {renderChainText(item.slots, item.ops, practices, listItems)}
                            </span>
                            <button type="button" onClick={() => deleteListItem(item.id)}
                              className="text-purple-300 hover:text-red-500 shrink-0"
                              title="Delete List item">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Expression label <span className="text-slate-400 font-normal">(optional override)</span>
                </label>
                <input type="text"
                  placeholder={liveExpression || '— auto-built from the chain —'}
                  value={relationForm.expression}
                  onChange={e => setRelationForm(f => ({ ...f, expression: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {relationError && <p className="text-sm text-red-600">{relationError}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal}
                  className="flex-1 border border-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingRelation || !canSave()}
                  title={saveBlockedReason()}
                  className="flex-1 bg-blue-600 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50">
                  {savingRelation ? 'Saving…' : 'SAVE Relation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
