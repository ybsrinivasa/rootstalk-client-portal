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
  // CCA-CA is the odd one out: practices live under
  // /client/{cid}/timelines/{tl}/... regardless of which package owns
  // the timeline. PG/SP/QA scope through the parent segment.
  if (ctx.pipe === 'CCA_CLIENT') {
    const base = `/client/${ctx.clientId}`
    return {
      create: (tl) => `${base}/timelines/${tl}/practices`,
      update: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
      delete: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
      list: (tl) => `${base}/timelines/${tl}/practices`,
    }
  }
  const base = parentSegment(ctx)
  return {
    create: (tl) => `${base}/timelines/${tl}/practices`,
    update: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
    delete: (tl, p) => `${base}/timelines/${tl}/practices/${p}`,
    list: (tl) => `${base}/timelines/${tl}/practices`,
  }
}

// Relations / CQ / Lifecycle endpoint builders deliberately omitted
// for Phase 1 — the CA-side surfaces don't expose those features yet
// (Phase 4 may bring them for CA-CCA). Add them here when needed,
// mirroring rootstalk-frontend/lib/advisory-pipe.ts.
