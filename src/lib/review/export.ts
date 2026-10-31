import { z } from "zod"

import { latestClosedDecision, isDecisionStale } from "@/lib/review/decisions"
import { KIND_ORDER } from "@/lib/review/ids"
import type { LoadedItems } from "@/lib/review/load"
import {
  computeBatchStats,
  computePaperStats,
  computeReviewerStats,
  type ReviewerStats,
  type ReviewStats,
} from "@/lib/review/stats"
import {
  batchSchema,
  evidenceSideSchema,
  findingSchema,
  findingStatusSchema,
  findingVerdictSchema,
  itemKindSchema,
  overlapSchema,
  proposedLinkSchema,
  severitySchema,
  verificationSchema,
  type Claim,
  type ComparatorInfo,
  type DecisionEventRecord,
  type DecisionRecord,
  type Finding,
  type ItemKind,
  type Overlap,
  type ReviewFinding,
  type ReviewItem,
} from "@/lib/review/types"

export const EXPORT_SCHEMA_VERSION = 1

export const exportTypeSchema = z.enum(["dataset", "decisions", "both"])
export type ExportType = z.infer<typeof exportTypeSchema>

export interface ExportReviewer {
  id: string
  name: string
  email: string
}

export interface ExportInput {
  loaded: LoadedItems
  decisions: readonly DecisionRecord[]
  events: readonly DecisionEventRecord[]
  claims: readonly Claim[]
  reviewers: readonly ExportReviewer[]
  /** Epoch milliseconds. Kept explicit so tests get deterministic output. */
  exportedAt: number
}

const severityCountsSchema = z.object({
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
})

const itemKindCountsSchema = severityCountsSchema.extend({
  total: z.number().int().nonnegative(),
})

const reviewStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  bySeverity: severityCountsSchema,
  byKind: z.object({
    cluster: itemKindCountsSchema,
    agent_only: itemKindCountsSchema,
    auditowl_only: itemKindCountsSchema,
    related: itemKindCountsSchema,
  }),
  byStatus: z.object({
    open: z.number().int().nonnegative(),
    claimed: z.number().int().nonnegative(),
    unsure: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
  }),
  closed: z.number().int().nonnegative(),
  unsure: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  completion: z.number().min(0).max(1),
}) satisfies z.ZodType<ReviewStats>

const reviewerStatsSchema = z.object({
  userId: z.string(),
  closed: z.number().int().nonnegative(),
  unsure: z.number().int().nonnegative(),
  drafts: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}) satisfies z.ZodType<ReviewerStats>

const exportStatsSchema = z.object({
  batch: reviewStatsSchema,
  papers: z.array(
    z.object({
      paperId: z.string(),
      stats: reviewStatsSchema,
    })
  ),
  reviewers: z.array(reviewerStatsSchema),
})

export type ExportStats = z.infer<typeof exportStatsSchema>

const datasetReviewerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
})

const compactReviewerSchema = z.object({
  id: z.string(),
  name: z.string(),
})

const datasetFindingSchema = findingSchema

/**
 * The archival dataset keeps the built item unchanged, including both finding
 * bodies and the comparator. `passthrough()` is deliberate: future source
 * fields must survive an export instead of being silently dropped.
 */
const datasetReviewFindingSchema = z
  .object({
    id: z.string(),
    idLocal: z.string(),
    side: evidenceSideSchema,
    category: z.string().nullable(),
    topic: z.string().nullable(),
    title: z.string(),
    severity: severitySchema,
    status: findingStatusSchema,
    file: z.string(),
    quote: z.string().nullable(),
    claim: z.string().nullable(),
    concern: z.string().nullable(),
    resolution: z.string().nullable(),
    lineStart: z.number().int().nullable(),
    lineEnd: z.number().int().nullable(),
    paperRef: z.string().nullable(),
    checkScript: z.string().nullable(),
    auditMdLine: z.number().int().nullable(),
    verdict: findingVerdictSchema,
    reason: z.string().nullable(),
    changed: z.unknown(),
    confidence: z.string().nullable(),
    verification: verificationSchema.nullable(),
    crossRefs: z.array(z.string()),
  })
  .passthrough() satisfies z.ZodType<ReviewFinding>

const datasetComparatorSchema = z
  .object({
    relation: z.string().nullable(),
    coverage: z.string().nullable(),
    strength: z.string().nullable(),
    severityAgreement: z.string().nullable(),
    statusAgreement: z.string().nullable(),
    verification: verificationSchema.nullable(),
    anchor: z.string().nullable(),
    agentAdds: z.string().nullable(),
    auditowlAdds: z.string().nullable(),
    note: z.string().nullable(),
    missReason: z.string().nullable(),
    proposedAssessment: z.string().nullable(),
    proposedNovelty: z.string().nullable(),
    closestAuditowl: z.array(z.string()),
    closestAgent: z.array(z.string()),
    relatedReason: z.string().nullable(),
  })
  .passthrough() satisfies z.ZodType<ComparatorInfo>

const datasetItemSchema = z
  .object({
    kind: itemKindSchema,
    paperId: z.string(),
    ref: z.string(),
    id: z.string(),
    severity: severitySchema,
    title: z.string(),
    summary: z.string().nullable(),
    auditowlIds: z.array(z.string()),
    agentIds: z.array(z.string()),
    findings: z.object({
      auditowl: z.array(datasetReviewFindingSchema),
      agent: z.array(datasetReviewFindingSchema),
    }),
    comparator: datasetComparatorSchema,
    itemHash: z.string(),
  })
  .passthrough() satisfies z.ZodType<ReviewItem>

const datasetPaperSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    comparisonEligible: z.boolean(),
    scopeNote: z.string().nullable(),
    /** The full overlap.json object, not a projection of its match lists. */
    overlap: overlapSchema satisfies z.ZodType<Overlap>,
    /** Both raw findings files, with every field preserved. */
    findings: z.object({
      auditowl: z.array(datasetFindingSchema) satisfies z.ZodType<Finding[]>,
      agent: z.array(datasetFindingSchema) satisfies z.ZodType<Finding[]>,
    }),
    repositories: z.array(
      z.object({
        name: z.string(),
        dir: z.string(),
        role: z.enum(["repository", "supplement", "workspace"]),
        commit: z.string().nullable(),
      })
    ),
    counts: z.object({
      total: z.number().int().nonnegative(),
      bySeverity: severityCountsSchema,
      byKind: z.object({
        cluster: itemKindCountsSchema,
        agent_only: itemKindCountsSchema,
        auditowl_only: itemKindCountsSchema,
        related: itemKindCountsSchema,
      }),
    }),
    items: z.array(datasetItemSchema),
  })
  // Future paper fields must survive validation of old exports.
  .passthrough()

const datasetClaimSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  itemKind: z.enum(["cluster", "agent_only", "auditowl_only", "related"]),
  itemRef: z.string(),
  reviewer: datasetReviewerSchema,
  claimedAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
})

const datasetDecisionSchema = z.object({
  paperId: z.string(),
  itemKind: z.enum(["cluster", "agent_only", "auditowl_only", "related"]),
  itemRef: z.string(),
  itemHash: z.string(),
  manifestSha256: z.string(),
  status: z.enum(["draft", "closed", "unsure"]),
  payload: z.unknown(),
  reviewer: datasetReviewerSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  stale: z.boolean(),
})

const datasetEventSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  itemKind: z.enum(["cluster", "agent_only", "auditowl_only", "related"]),
  itemRef: z.string(),
  itemHash: z.string(),
  manifestSha256: z.string(),
  status: z.enum(["closed", "unsure", "reopened"]),
  payload: z.unknown(),
  reviewer: datasetReviewerSchema,
  createdAt: z.string(),
  stale: z.boolean(),
})

export const reviewDatasetExportSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  batchId: z.string(),
  exportedAt: z.string(),
  source: z.object({ manifestSha256: z.string() }),
  batch: batchSchema,
  papers: z.array(datasetPaperSchema),
  claims: z.array(datasetClaimSchema),
  decisions: z.array(datasetDecisionSchema),
  decisionEvents: z.array(datasetEventSchema),
  stats: exportStatsSchema,
})
export type ReviewDatasetExport = z.infer<typeof reviewDatasetExportSchema>

const compactDecisionSchema = z.object({
  paperId: z.string(),
  itemKind: z.enum(["cluster", "agent_only", "auditowl_only", "related"]),
  itemRef: z.string(),
  itemHash: z.string(),
  decision: z.unknown(),
  reviewer: compactReviewerSchema,
  decidedAt: z.string(),
  proposedLink: proposedLinkSchema.nullable(),
  stale: z.boolean(),
})

const compactUnsureSchema = z.object({
  paperId: z.string(),
  itemKind: z.enum(["cluster", "agent_only", "auditowl_only", "related"]),
  itemRef: z.string(),
  note: z.string(),
  reviewer: compactReviewerSchema,
  at: z.string(),
})

export const decisionsExportSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  batchId: z.string(),
  exportedAt: z.string(),
  source: z.object({ manifestSha256: z.string() }),
  decisions: z.array(compactDecisionSchema),
  unsure: z.array(compactUnsureSchema),
  stats: exportStatsSchema,
})
export type DecisionsExport = z.infer<typeof decisionsExportSchema>

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

function compareItemKey(
  a: { paperId: string; itemKind: ItemKind; itemRef: string },
  b: { paperId: string; itemKind: ItemKind; itemRef: string }
): number {
  return (
    compareText(a.paperId, b.paperId) ||
    KIND_ORDER[a.itemKind] - KIND_ORDER[b.itemKind] ||
    compareText(a.itemRef, b.itemRef)
  )
}

function compareDecisions(a: DecisionRecord, b: DecisionRecord): number {
  return (
    compareItemKey(a, b) ||
    compareText(a.userId, b.userId) ||
    a.updatedAt - b.updatedAt ||
    a.createdAt - b.createdAt ||
    compareText(a.id, b.id)
  )
}

function compareEvents(a: DecisionEventRecord, b: DecisionEventRecord): number {
  return (
    compareItemKey(a, b) ||
    compareText(a.userId, b.userId) ||
    a.createdAt - b.createdAt ||
    compareText(a.id, b.id)
  )
}

function compareClaims(a: Claim, b: Claim): number {
  return (
    compareItemKey(a, b) ||
    compareText(a.userId, b.userId) ||
    a.claimedAt - b.claimedAt ||
    compareText(a.id, b.id)
  )
}

function isoTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}

function itemMap(items: readonly ReviewItem[]): Map<string, ReviewItem> {
  return new Map(
    items.map((item) => [
      `${item.paperId}\u0000${item.kind}\u0000${item.ref}`,
      item,
    ])
  )
}

function decisionStale(
  record: Pick<
    DecisionRecord,
    "paperId" | "itemKind" | "itemRef" | "itemHash" | "manifestSha256"
  >,
  items: ReadonlyMap<string, ReviewItem>,
  manifestSha256: string
): boolean {
  const item = items.get(
    `${record.paperId}\u0000${record.itemKind}\u0000${record.itemRef}`
  )
  return item ? isDecisionStale(record, item.itemHash, manifestSha256) : true
}

function reviewerDirectory(
  reviewers: readonly ExportReviewer[]
): Map<string, ExportReviewer> {
  return new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]))
}

function datasetReviewer(
  directory: ReadonlyMap<string, ExportReviewer>,
  userId: string
): { id: string; name: string; email: string | null } {
  const reviewer = directory.get(userId)
  return {
    id: userId,
    name: reviewer?.name ?? userId,
    email: reviewer?.email ?? null,
  }
}

function compactReviewer(
  directory: ReadonlyMap<string, ExportReviewer>,
  userId: string
): { id: string; name: string } {
  const reviewer = directory.get(userId)
  return { id: userId, name: reviewer?.name ?? userId }
}

function buildStats(input: ExportInput): ExportStats {
  const { loaded, exportedAt } = input
  const base = {
    batchId: loaded.batch.manifest.batchId,
    items: loaded.items,
    decisions: input.decisions,
    claims: input.claims,
    manifestSha256: loaded.batch.manifestSha256,
    now: exportedAt,
  }
  const paperStats = loaded.papers
    .map((paper) => ({
      paperId: paper.manifest.id,
      stats: computePaperStats(base, paper.manifest.id),
    }))
    .sort((a, b) => compareText(a.paperId, b.paperId))
  const reviewerStats = computeReviewerStats(
    loaded.batch.manifest.batchId,
    input.decisions
  )
    .slice()
    .sort((a, b) => compareText(a.userId, b.userId))

  return {
    batch: computeBatchStats(base),
    papers: paperStats,
    reviewers: reviewerStats,
  }
}

export function buildReviewDataset(input: ExportInput): ReviewDatasetExport {
  const { loaded, exportedAt } = input
  const batchId = loaded.batch.manifest.batchId
  const manifestSha256 = loaded.batch.manifestSha256
  const items = itemMap(loaded.items)
  const reviewers = reviewerDirectory(input.reviewers)
  const sources = new Map(
    loaded.sources.map((source) => [source.manifest.id, source])
  )

  const papers = loaded.papers
    .map((paper) => {
      const source = sources.get(paper.manifest.id)
      if (!source) {
        throw new Error(
          `Missing raw review source for paper ${paper.manifest.id}; the dataset would not be archival.`
        )
      }
      return {
        id: paper.manifest.id,
        title: paper.manifest.title,
        category: paper.manifest.category,
        comparisonEligible: paper.manifest.comparisonEligible,
        scopeNote: paper.manifest.scopeNote,
        overlap: source.overlap,
        findings: {
          auditowl: source.auditowlFindings,
          agent: source.agentFindings,
        },
        repositories: paper.manifest.code
          .map((repo) => ({
            name: repo.name,
            dir: repo.dir,
            role: repo.role,
            commit: repo.commit,
          }))
          .sort((a, b) => compareText(a.name, b.name)),
        counts: {
          total: paper.counts.total,
          bySeverity: paper.counts.bySeverity,
          byKind: paper.counts.byKind,
        },
        items: paper.items
          .slice()
          .sort(
            (a, b) =>
              KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
              compareText(a.ref, b.ref)
          ),
      }
    })
    .sort((a, b) => compareText(a.id, b.id))

  const claims = input.claims
    .slice()
    .sort(compareClaims)
    .map((claim) => ({
      id: claim.id,
      paperId: claim.paperId,
      itemKind: claim.itemKind,
      itemRef: claim.itemRef,
      reviewer: datasetReviewer(reviewers, claim.userId),
      claimedAt: isoTimestamp(claim.claimedAt),
      lastSeenAt: isoTimestamp(claim.lastSeenAt),
      expiresAt: isoTimestamp(claim.expiresAt),
    }))

  const decisions = input.decisions
    .slice()
    .sort(compareDecisions)
    .map((decision) => ({
      paperId: decision.paperId,
      itemKind: decision.itemKind,
      itemRef: decision.itemRef,
      itemHash: decision.itemHash,
      manifestSha256: decision.manifestSha256,
      status: decision.status,
      payload: decision.payload,
      reviewer: datasetReviewer(reviewers, decision.userId),
      createdAt: isoTimestamp(decision.createdAt),
      updatedAt: isoTimestamp(decision.updatedAt),
      stale: decisionStale(decision, items, manifestSha256),
    }))

  const decisionEvents = input.events
    .slice()
    .sort(compareEvents)
    .map((event) => ({
      id: event.id,
      paperId: event.paperId,
      itemKind: event.itemKind,
      itemRef: event.itemRef,
      itemHash: event.itemHash,
      manifestSha256: event.manifestSha256,
      status: event.status,
      payload: event.payload,
      reviewer: datasetReviewer(reviewers, event.userId),
      createdAt: isoTimestamp(event.createdAt),
      stale: decisionStale(event, items, manifestSha256),
    }))

  return reviewDatasetExportSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    batchId,
    exportedAt: isoTimestamp(exportedAt),
    source: { manifestSha256 },
    batch: loaded.batch.manifest,
    papers,
    claims,
    decisions,
    decisionEvents,
    stats: buildStats(input),
  })
}

const proposedLinkPayloadSchema = z
  .object({ proposedLink: z.unknown() })
  .passthrough()

function proposedLinkFor(
  payload: unknown
): z.infer<typeof proposedLinkSchema> | null {
  const candidate = proposedLinkPayloadSchema.safeParse(payload)
  if (!candidate.success) {
    return null
  }
  const link = proposedLinkSchema.safeParse(candidate.data.proposedLink)
  return link.success ? link.data : null
}

const notePayloadSchema = z.object({ note: z.string() }).passthrough()

function noteFor(payload: unknown): string {
  const candidate = notePayloadSchema.safeParse(payload)
  return candidate.success ? candidate.data.note : ""
}

export function buildDecisionsExport(input: ExportInput): DecisionsExport {
  const { loaded, exportedAt } = input
  const manifestSha256 = loaded.batch.manifestSha256
  const items = itemMap(loaded.items)
  const reviewers = reviewerDirectory(input.reviewers)

  const grouped = new Map<string, DecisionRecord[]>()
  for (const decision of input.decisions) {
    const key = `${decision.paperId}\u0000${decision.itemKind}\u0000${decision.itemRef}`
    const bucket = grouped.get(key)
    if (bucket) {
      bucket.push(decision)
    } else {
      grouped.set(key, [decision])
    }
  }

  const finals = [...grouped.values()]
    .map((rows) => latestClosedDecision(rows))
    .filter((decision): decision is DecisionRecord => decision !== null)
    .sort(compareDecisions)
    .map((decision) => ({
      paperId: decision.paperId,
      itemKind: decision.itemKind,
      itemRef: decision.itemRef,
      itemHash: decision.itemHash,
      decision: decision.payload,
      reviewer: compactReviewer(reviewers, decision.userId),
      decidedAt: isoTimestamp(decision.updatedAt),
      proposedLink: proposedLinkFor(decision.payload),
      stale: decisionStale(decision, items, manifestSha256),
    }))

  const unsure = input.events
    .filter((event) => event.status === "unsure")
    .slice()
    .sort(compareEvents)
    .map((event) => ({
      paperId: event.paperId,
      itemKind: event.itemKind,
      itemRef: event.itemRef,
      note: noteFor(event.payload),
      reviewer: compactReviewer(reviewers, event.userId),
      at: isoTimestamp(event.createdAt),
    }))

  return decisionsExportSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    batchId: loaded.batch.manifest.batchId,
    exportedAt: isoTimestamp(exportedAt),
    source: { manifestSha256 },
    decisions: finals,
    unsure,
    stats: buildStats(input),
  })
}

/** A filesystem-safe, stable base name for both the CLI and the download route. */
export function exportFileName(
  type: "dataset" | "decisions",
  at: number
): string {
  const stamp = isoTimestamp(at).replace(/[:.]/g, "-")
  return type === "dataset"
    ? `review-dataset-${stamp}.json`
    : `decisions-${stamp}.json`
}
