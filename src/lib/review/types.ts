import { z } from "zod"

export const severitySchema = z.enum(["high", "medium", "low"])
export type Severity = z.infer<typeof severitySchema>

export const itemKindSchema = z.enum([
  "cluster",
  "agent_only",
  "auditowl_only",
  "related",
])
export type ItemKind = z.infer<typeof itemKindSchema>

export const evidenceSideSchema = z.enum(["auditowl", "agent"])
export type EvidenceSide = z.infer<typeof evidenceSideSchema>

export const findingStatusSchema = z.enum(["finding", "question"])
export type FindingStatus = z.infer<typeof findingStatusSchema>

export const findingVerdictSchema = z.enum([
  "keep",
  "lowered",
  "missing",
  "reject",
])
export type FindingVerdict = z.infer<typeof findingVerdictSchema>

export type ItemStatus = "open" | "claimed" | "unsure" | "closed"

export const decisionStatusSchema = z.enum(["draft", "closed", "unsure"])
export type DecisionStatus = z.infer<typeof decisionStatusSchema>

export const decisionEventStatusSchema = z.enum([
  "closed",
  "unsure",
  "reopened",
])
export type DecisionEventStatus = z.infer<typeof decisionEventStatusSchema>

/** A reviewer note is stored in SQLite; keep it bounded at the server edge. */
export const MAX_DECISION_NOTE_LENGTH = 10_000

export const decisionNoteSchema = z
  .string()
  .max(
    MAX_DECISION_NOTE_LENGTH,
    `the note must be at most ${MAX_DECISION_NOTE_LENGTH.toLocaleString("en-US")} characters`
  )

export const verificationSchema = z
  .object({
    status: z.string().optional(),
    checked: z.array(z.string()).optional(),
    note: z.string().nullish(),
  })
  .passthrough()
export type Verification = z.infer<typeof verificationSchema>

export const validatorPassSchema = z
  .object({
    quote_match: z.boolean().optional(),
    control_flow: z.boolean().optional(),
    condition_satisfiable: z.boolean().optional(),
  })
  .passthrough()
export type ValidatorPass = z.infer<typeof validatorPassSchema>

export const findingSchema = z
  .object({
    id: z.string(),
    id_local: z.string().optional(),
    category: z.string().optional(),
    topic: z.string().optional(),
    title: z.string(),
    severity: severitySchema,
    confidence: z.string().optional(),
    status: findingStatusSchema.optional(),
    file: z.string(),
    quote: z.string().optional(),
    claim: z.string().optional(),
    concern: z.string().optional(),
    resolution: z.string().optional(),
    line_start: z.number().int().nullish(),
    line_end: z.number().int().nullish(),
    cross_refs: z.array(z.string()).optional(),
    validator_pass: validatorPassSchema.nullish(),
    verification: verificationSchema.nullish(),
    paper_ref: z.string().nullish(),
    check_script: z.string().nullish(),
    csv_row: z.number().int().nullish(),
    audit_md_line: z.number().int().nullish(),
    sources: z.array(z.string()).optional(),
    verdict: findingVerdictSchema.optional(),
    reason: z.string().optional(),
    changed: z.unknown().optional(),
    audit: z.string().optional(),
    url_retrieved_at: z.string().nullable().optional(),
  })
  .passthrough()
export type Finding = z.infer<typeof findingSchema>

export const findingsFileSchema = z
  .object({
    schema_version: z.string().optional(),
    audit: z.string().optional(),
    audit_md: z.string().optional(),
    generated_at: z.string().optional(),
    findings: z.array(findingSchema),
  })
  .passthrough()
export type FindingsFile = z.infer<typeof findingsFileSchema>

export const paperMetadataSchema = z
  .object({
    paper_number: z.number().optional(),
    title: z.string(),
    authors: z.array(z.string()).optional(),
    abstract_url: z.string().optional(),
    track: z.string().optional(),
    pdf_url: z.string().optional(),
    category: z.string().optional(),
    author_repos: z.array(z.unknown()).optional(),
    other_repos: z.array(z.unknown()).optional(),
    files: z.record(z.string(), z.string()).optional(),
    manifest: z.record(z.string(), z.unknown()).optional(),
    fetched_at: z.string().optional(),
  })
  .passthrough()
export type PaperMetadata = z.infer<typeof paperMetadataSchema>

const overlapPaperSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    auditowl_status: z.string(),
    comparison_eligible: z.boolean(),
    scope_note: z.string().nullish(),
  })
  .passthrough()
export type OverlapPaper = z.infer<typeof overlapPaperSchema>

const matchSeveritySchema = z
  .object({
    auditowl: z.array(severitySchema),
    agent: z.array(severitySchema),
    agreement: z.string().optional(),
  })
  .passthrough()

const matchStatusSchema = z
  .object({
    auditowl: z.array(findingStatusSchema),
    agent: z.array(findingStatusSchema),
    agreement: z.string().optional(),
  })
  .passthrough()

export const overlapMatchSchema = z
  .object({
    match_id: z.string(),
    relation: z.string(),
    coverage: z.string(),
    strength: z.string(),
    auditowl: z.array(z.string()),
    agent: z.array(z.string()),
    shared_defect: z.string(),
    anchor: z.string().nullish(),
    severity: matchSeveritySchema,
    status: matchStatusSchema,
    verification: verificationSchema.nullish(),
    agent_adds: z.string().nullish(),
    auditowl_adds: z.string().nullish(),
  })
  .passthrough()
export type OverlapMatch = z.infer<typeof overlapMatchSchema>

export const overlapOnlyFindingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    severity: severitySchema,
    status: findingStatusSchema,
    verdict: findingVerdictSchema.optional(),
    novelty: z.string().optional(),
    assessment: z.string().optional(),
    miss_reason: z.string().optional(),
    verification: verificationSchema.nullish(),
    closest_auditowl: z.array(z.string()).optional(),
    closest_agent: z.array(z.string()).optional(),
    notes: z.string().nullish(),
  })
  .passthrough()
export type OverlapOnlyFinding = z.infer<typeof overlapOnlyFindingSchema>

export const relatedPairSchema = z
  .object({
    auditowl: z.array(z.string()),
    agent: z.array(z.string()),
    reason: z.string(),
  })
  .passthrough()
export type RelatedPair = z.infer<typeof relatedPairSchema>

/** One repository entry in `overlap.json`, used for revision-mismatch banners. */
export const overlapRepositorySchema = z
  .object({
    name: z.string(),
    role: z.string().optional(),
    auditowl_commit: z.string().nullish(),
    agent_commit: z.string().nullish(),
    revision_match: z.boolean().nullish(),
    note: z.string().nullish(),
  })
  .passthrough()
export type OverlapRepository = z.infer<typeof overlapRepositorySchema>

export const overlapSchema = z
  .object({
    schema_version: z.string().optional(),
    paper: overlapPaperSchema,
    comparison: z.record(z.string(), z.unknown()).optional(),
    sources: z.record(z.string(), z.unknown()).optional(),
    repositories: z.array(overlapRepositorySchema).optional(),
    counts: z.record(z.string(), z.unknown()).optional(),
    matches: z.array(overlapMatchSchema),
    auditowl_only: z.array(overlapOnlyFindingSchema),
    agent_only: z.array(overlapOnlyFindingSchema),
    related_not_matched: z.array(relatedPairSchema),
    caveats: z.array(z.string()).optional(),
  })
  .passthrough()
export type Overlap = z.infer<typeof overlapSchema>

export const paperFilesSchema = z.object({
  overlap: z.string(),
  agentFindings: z.string(),
  auditowlFindings: z.string(),
  paper: z.string(),
  paperText: z.string(),
  paperPdf: z.string(),
  agentRun: z.string(),
  auditowlDir: z.string(),
})
export type PaperFiles = z.infer<typeof paperFilesSchema>

export const codeRepoRoleSchema = z.enum([
  "repository",
  "supplement",
  "workspace",
])
export type CodeRepoRole = z.infer<typeof codeRepoRoleSchema>

export const codeRepoManifestSchema = z.object({
  name: z.string(),
  dir: z.string(),
  role: codeRepoRoleSchema,
  commit: z.string().nullable(),
})
export type CodeRepoManifest = z.infer<typeof codeRepoManifestSchema>

export const paperCountsSchema = z.object({
  clusters: z.number().int().nonnegative(),
  agentOnly: z.number().int().nonnegative(),
  auditowlOnly: z.number().int().nonnegative(),
  related: z.number().int().nonnegative(),
  bySeverity: z.object({
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
})
export type PaperCounts = z.infer<typeof paperCountsSchema>

export const paperManifestSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    auditowlStatus: z.string(),
    comparisonEligible: z.boolean(),
    scopeNote: z.string().nullable(),
    dir: z.string(),
    files: paperFilesSchema,
    code: z.array(codeRepoManifestSchema),
    sha256: z.object({
      overlap: z.string(),
      agentFindings: z.string(),
      auditowlFindings: z.string(),
    }),
    counts: paperCountsSchema,
  })
  .passthrough()
export type PaperManifest = z.infer<typeof paperManifestSchema>

export const excludedPaperSchema = z.object({
  paperId: z.string(),
  reason: z.string(),
})
export type ExcludedPaper = z.infer<typeof excludedPaperSchema>

export const batchSchema = z
  .object({
    schemaVersion: z.literal(1),
    batchId: z.string(),
    label: z.string(),
    generatedAt: z.string(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    protocol: z.object({
      name: z.string(),
      version: z.string(),
      path: z.string(),
    }),
    excluded: z.array(excludedPaperSchema),
    papers: z.array(paperManifestSchema),
  })
  .passthrough()
export type Batch = z.infer<typeof batchSchema>

export const proposedLinkSchema = z.object({
  kind: z.enum(["agent_only", "auditowl_only"]),
  ref: z.string().min(1),
})
export type ProposedLink = z.infer<typeof proposedLinkSchema>

function requireNote(
  value: { note: string },
  ctx: z.RefinementCtx,
  message: string
): void {
  if (value.note.trim() === "") {
    ctx.addIssue({ code: "custom", path: ["note"], message })
  }
}

export const clusterDecisionSchema = z
  .object({
    verdict: z.enum(["same_defect", "not_a_match", "unsure"]),
    acceptedAsProposed: z.boolean().optional(),
    strength: z.enum(["exact", "strong", "weak"]).optional(),
    coverage: z
      .enum(["equivalent", "agent_broader", "auditowl_broader", "partial"])
      .optional(),
    verification: z
      .enum(["confirmed", "partly_confirmed", "refuted", "not_checked"])
      .optional(),
    note: decisionNoteSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === "not_a_match" || value.verdict === "unsure") {
      requireNote(value, ctx, "a note is required for this verdict")
    }
    if (value.acceptedAsProposed === true && value.verdict !== "same_defect") {
      ctx.addIssue({
        code: "custom",
        path: ["acceptedAsProposed"],
        message: "acceptedAsProposed is only valid for the same_defect verdict",
      })
    }
  })
export type ClusterDecision = z.infer<typeof clusterDecisionSchema>

export const agentOnlyDecisionSchema = z
  .object({
    verdict: z.enum([
      "confirmed_valid",
      "partly_valid",
      "invalid",
      "not_checked",
      "unsure",
    ]),
    severity: severitySchema.optional(),
    novelty: z
      .enum([
        "genuine_addition",
        "variant_of_auditowl",
        "out_of_scope",
        "invalid",
      ])
      .optional(),
    note: decisionNoteSchema,
    proposedLink: proposedLinkSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === "unsure" || value.verdict === "not_checked") {
      requireNote(value, ctx, "a note is required for this verdict")
    }
  })
export type AgentOnlyDecision = z.infer<typeof agentOnlyDecisionSchema>

export const auditowlOnlyDecisionSchema = z
  .object({
    verdict: z.enum([
      "agent_missed",
      "scope_difference",
      "revision_difference",
      "invalid_original_finding",
      "unclear",
      "unsure",
    ]),
    assessment: z.enum([
      "confirmed_valid",
      "partly_valid",
      "invalid",
      "not_checked",
    ]),
    note: decisionNoteSchema,
    proposedLink: proposedLinkSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === "unsure") {
      requireNote(value, ctx, "a note is required for this verdict")
    }
  })
export type AuditOwlOnlyDecision = z.infer<typeof auditowlOnlyDecisionSchema>

export const relatedDecisionSchema = z
  .object({
    verdict: z.enum(["agree_not_matched", "same_defect", "unsure"]),
    note: decisionNoteSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === "unsure") {
      requireNote(value, ctx, "a note is required for this verdict")
    }
  })
export type RelatedDecision = z.infer<typeof relatedDecisionSchema>

export type DecisionPayload =
  ClusterDecision | AgentOnlyDecision | AuditOwlOnlyDecision | RelatedDecision

/** Schemas are selected by item kind; there is no ambiguous merged union. */
export const decisionSchemasByKind = {
  cluster: clusterDecisionSchema,
  agent_only: agentOnlyDecisionSchema,
  auditowl_only: auditowlOnlyDecisionSchema,
  related: relatedDecisionSchema,
} as const

/**
 * Drafts are intentionally more permissive than final decisions: a reviewer can
 * stop halfway through a form and `s` still saves the work in progress. The
 * strict per-kind schema is enforced only when the row becomes closed/unsure.
 */
export const draftDecisionSchema = z
  .object({
    verdict: z.enum([
      "same_defect",
      "not_a_match",
      "confirmed_valid",
      "partly_valid",
      "invalid",
      "not_checked",
      "agent_missed",
      "scope_difference",
      "revision_difference",
      "invalid_original_finding",
      "unclear",
      "agree_not_matched",
      "unsure",
    ]),
    note: decisionNoteSchema,
    acceptedAsProposed: z.boolean().optional(),
    strength: z.string().optional(),
    coverage: z.string().optional(),
    verification: z.string().optional(),
    severity: severitySchema.optional(),
    novelty: z.string().optional(),
    assessment: z.string().optional(),
    proposedLink: proposedLinkSchema.optional(),
  })
  .strict()
export type DraftDecision = z.infer<typeof draftDecisionSchema>

export function validateDraftDecisionPayload(value: unknown): DraftDecision {
  return draftDecisionSchema.parse(value)
}

export function parseDecisionPayload(
  kind: "cluster",
  value: unknown
): ClusterDecision
export function parseDecisionPayload(
  kind: "agent_only",
  value: unknown
): AgentOnlyDecision
export function parseDecisionPayload(
  kind: "auditowl_only",
  value: unknown
): AuditOwlOnlyDecision
export function parseDecisionPayload(
  kind: "related",
  value: unknown
): RelatedDecision
export function parseDecisionPayload(
  kind: ItemKind,
  value: unknown
): DecisionPayload
export function parseDecisionPayload(
  kind: ItemKind,
  value: unknown
): DecisionPayload {
  switch (kind) {
    case "cluster":
      return clusterDecisionSchema.parse(value)
    case "agent_only":
      return agentOnlyDecisionSchema.parse(value)
    case "auditowl_only":
      return auditowlOnlyDecisionSchema.parse(value)
    case "related":
      return relatedDecisionSchema.parse(value)
  }
}

/**
 * Full validation including item-specific rules that need the item severity.
 * `not_checked` is only allowed for low-severity agent-only findings.
 */
export function validateDecisionPayload(
  kind: ItemKind,
  value: unknown,
  severity: Severity
): DecisionPayload {
  if (kind !== "agent_only") {
    return parseDecisionPayload(kind, value)
  }
  const payload = agentOnlyDecisionSchema.parse(value)
  if (payload.verdict === "not_checked" && severity !== "low") {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["verdict"],
        message:
          "not_checked is only allowed for low-severity agent-only items",
        input: value,
      },
    ])
  }
  return payload
}

export interface Claim {
  id: string
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
  userId: string
  claimedAt: number
  lastSeenAt: number
  expiresAt: number
}

export interface DecisionRecord {
  id: string
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
  userId: string
  status: DecisionStatus
  payload: unknown
  itemHash: string
  manifestSha256: string
  createdAt: number
  updatedAt: number
}

/**
 * Append-only audit trail. Unlike `review_decision`, these rows are never
 * overwritten, so an unsure note survives a later draft or closure by the same
 * reviewer.
 */
export interface DecisionEventRecord {
  id: string
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
  userId: string
  status: DecisionEventStatus
  payload: unknown
  itemHash: string
  manifestSha256: string
  createdAt: number
}

export interface SeverityCounts {
  high: number
  medium: number
  low: number
}

export interface ItemKindCounts extends SeverityCounts {
  total: number
}

export interface ReviewCounts {
  total: number
  clusters: number
  agentOnly: number
  auditowlOnly: number
  related: number
  bySeverity: SeverityCounts
  byKind: Record<ItemKind, ItemKindCounts>
}

export interface ReviewFinding {
  id: string
  idLocal: string
  side: EvidenceSide
  category: string | null
  topic: string | null
  title: string
  severity: Severity
  status: FindingStatus
  file: string
  quote: string | null
  claim: string | null
  concern: string | null
  resolution: string | null
  lineStart: number | null
  lineEnd: number | null
  paperRef: string | null
  checkScript: string | null
  auditMdLine: number | null
  verdict: FindingVerdict
  reason: string | null
  changed: unknown
  confidence: string | null
  verification: Verification | null
  crossRefs: string[]
}

export interface ComparatorInfo {
  relation: string | null
  coverage: string | null
  strength: string | null
  severityAgreement: string | null
  statusAgreement: string | null
  verification: Verification | null
  anchor: string | null
  agentAdds: string | null
  auditowlAdds: string | null
  note: string | null
  missReason: string | null
  proposedAssessment: string | null
  proposedNovelty: string | null
  closestAuditowl: string[]
  closestAgent: string[]
  relatedReason: string | null
}

export interface ReviewItem {
  kind: ItemKind
  paperId: string
  ref: string
  id: string
  severity: Severity
  title: string
  summary: string | null
  auditowlIds: string[]
  agentIds: string[]
  findings: {
    auditowl: ReviewFinding[]
    agent: ReviewFinding[]
  }
  comparator: ComparatorInfo
  itemHash: string
}

export interface ValidationIssue {
  paperId: string
  code: string
  message: string
}

export interface PaperReview {
  manifest: PaperManifest
  items: ReviewItem[]
  counts: ReviewCounts
  issues: ValidationIssue[]
}

export interface BuildResult {
  papers: PaperReview[]
  items: ReviewItem[]
  counts: ReviewCounts
  issues: ValidationIssue[]
  excluded: ExcludedPaper[]
}

export interface PaperInput {
  manifest: PaperManifest
  overlap: Overlap
  agentFindings: readonly Finding[]
  auditowlFindings: readonly Finding[]
}

export interface BuildReviewInput {
  papers: readonly PaperInput[]
  excluded?: readonly ExcludedPaper[]
}
