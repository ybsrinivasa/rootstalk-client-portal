// 2026-05-17 — client-portal companion to rootstalk-frontend's
// lib/advisory-pipe.ts. Built for Phase 1 of the CA-portal parity
// effort (port the shared authoring modules so CA-CCA/PG/SP/QA can
// adopt the SA-portal practice/timeline modal).
//
// SA repo handles `*_GLOBAL` pipes; client-portal handles `*_CLIENT`.
// Same module shape so a future monorepo extraction is a rename, not
// a rewrite.
//
// URL conventions per pipe (CA side):
//   CCA_CLIENT  parent = `/client/{cid}/packages/{pkg}`
//               practices hang off `/client/{cid}/timelines/{tl}/practices`
//               — historical CCA-CA shape; no package id in practice URL.
//   PG_CLIENT   parent = `/client/{cid}/pg-recommendations/{pg}`
//               practices hang off `<parent>/timelines/{tl}/practices`
//   SP_CLIENT   parent = `/client/{cid}/sp-recommendations/{sp}`
//               practices hang off `<parent>/timelines/{tl}/practices`
//   QA_CLIENT   parent = `/client/{cid}/standard-responses/{sr}`
//               practices hang off `<parent>/timelines/{tl}/practices`

export type AdvisoryPipe =
  | 'CCA_CLIENT'
  | 'PG_CLIENT'
  | 'SP_CLIENT'
  | 'QA_CLIENT'

export interface PipeContext {
  pipe: AdvisoryPipe
  /** The owning client id — every CA endpoint is client-scoped. */
  clientId: string
  /** The parent's id — package, pg-rec, sp-rec, or standard-response. */
  parentId: string
}

function parentSegment(ctx: PipeContext): string {
  switch (ctx.pipe) {
    case 'CCA_CLIENT':
      return `/client/${ctx.clientId}/packages/${ctx.parentId}`
    case 'PG_CLIENT':
      return `/client/${ctx.clientId}/pg-recommendations/${ctx.parentId}`
    case 'SP_CLIENT':
      return `/client/${ctx.clientId}/sp-recommendations/${ctx.parentId}`
    case 'QA_CLIENT':
      return `/client/${ctx.clientId}/standard-responses/${ctx.parentId}`
  }
}

export interface PracticeEndpoints {
  /** POST — create a Practice on a timeline. */
  create: (timelineId: string) => string
  /** PUT — atomic Practice replace by id. */
  update: (timelineId: string, practiceId: string) => string
  /** DELETE — drop a Practice (cascades to Elements). */
  delete: (timelineId: string, practiceId: string) => string
  /** GET — list practices on a timeline with elements + labels. */
  list?: (timelineId: string) => string
}

export function practiceEndpoints(ctx: PipeContext): PracticeEndpoints {
  // CCA-CA is the odd one out for writes: practices live under
  // /client/{cid}/timelines/{tl}/... regardless of which package
  // owns the timeline. PG/SP/QA scope writes through the parent
  // segment so the backend handler can run parent-aware checks.
  //
  // `list` is always the polymorphic timeline-agnostic endpoint —
  // /client/{cid}/timelines/{tl}/practices returns
  // PracticeWithElementsOut for any timeline regardless of pipe.
  // Avoids needing a per-parent practices-GET on every backend.
  const polymorphicList = (tl: string) =>
    `/client/${ctx.clientId}/timelines/${tl}/practices`

  if (ctx.pipe === 'CCA_CLIENT') {
    const base = `/client/${ctx.clientId}`
    return {
      create: (tl) => `${base}/timelines/${tl}/practices`,
      update: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
      delete: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
      list: polymorphicList,
    }
  }
  const base = parentSegment(ctx)
  return {
    create: (tl) => `${base}/timelines/${tl}/practices`,
    update: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
    delete: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
    list: polymorphicList,
  }
}

// ── Relations + Conditional Questions (Batch N1, 2026-05-18) ─────────
//
// CA-side mirror of rootstalk-frontend/lib/advisory-pipe.ts. The
// list / create URLs are timeline-scoped (pipe-agnostic per CA
// convention — /client/{cid}/timelines/{tl}/... works for any
// parent type since Timeline has FK to its parent). PUT / DELETE
// on relations / CQs are by resource id with client_id in the
// path so the request-level tenant guard catches cross-tenant
// access at the gate.

export interface RelationEndpoints {
  /** GET — list relations on a timeline. */
  list: (timelineId: string) => string
  /** POST — create a relation on a timeline. */
  create: (timelineId: string) => string
  /** DELETE — drop a relation by id. */
  delete: (relationId: string) => string
}

export function relationEndpoints(ctx: PipeContext): RelationEndpoints {
  const cid = ctx.clientId
  return {
    list: (tl) => `/client/${cid}/timelines/${tl}/relations`,
    create: (tl) => `/client/${cid}/timelines/${tl}/relations`,
    delete: (rel) => `/client/${cid}/relations/${rel}`,
  }
}

export interface CQEndpoints {
  list: (timelineId: string) => string
  create: (timelineId: string) => string
  /** PUT — atomic replace of question text + YES/NO bindings. */
  update: (cqId: string) => string
  delete: (cqId: string) => string
  /** POST — bind a Practice to a CQ (Path B). */
  bindPractice: (practiceId: string) => string
  /** POST — bind a Relation to a CQ (Path A). */
  bindRelation: (relationId: string) => string
}

export function cqEndpoints(ctx: PipeContext): CQEndpoints {
  const cid = ctx.clientId
  return {
    list: (tl) => `/client/${cid}/timelines/${tl}/conditional-questions`,
    create: (tl) => `/client/${cid}/timelines/${tl}/conditional-questions`,
    update: (cq) => `/client/${cid}/conditional-questions/${cq}`,
    delete: (cq) => `/client/${cid}/conditional-questions/${cq}`,
    bindPractice: (pId) => `/client/${cid}/practices/${pId}/conditionals`,
    bindRelation: (rId) => `/client/${cid}/relations/${rId}/conditionals`,
  }
}
