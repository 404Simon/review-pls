import {
  deriveItemStatus,
  isDecisionStale,
  latestClosedDecision,
  latestDraftDecision,
  latestUnsureDecision,
} from "@/lib/review/decisions"
import type {
  Claim,
  DecisionRecord,
  DecisionStatus,
  ItemKind,
  ItemKindCounts,
  ItemStatus,
  ReviewItem,
  SeverityCounts,
} from "@/lib/review/types"

export interface ReviewStatsInput {
  batchId: string
  items: readonly ReviewItem[]
  decisions: readonly DecisionRecord[]
  claims: readonly Claim[]
  /** Current batch content fingerprint, used for stale detection. */
  manifestSha256: string
  now: number
}

export interface ReviewStats {
  total: number
  bySeverity: SeverityCounts
  byKind: Record<ItemKind, ItemKindCounts>
  byStatus: Record<ItemStatus, number>
  closed: number
  unsure: number
  /** Items whose latest closed decision no longer matches the current source. */
  stale: number
  /** Closed items divided by all items, in the range 0..1. */
  completion: number
}

export interface ReviewerStats {
  userId: string
  closed: number
  unsure: number
  drafts: number
  total: number
}

function emptySeverityCounts(): SeverityCounts {
  return { high: 0, medium: 0, low: 0 }
}

function emptyKindCounts(): ItemKindCounts {
  return { high: 0, medium: 0, low: 0, total: 0 }
}

function emptyStats(): ReviewStats {
  return {
    total: 0,
    bySeverity: emptySeverityCounts(),
    byKind: {
      cluster: emptyKindCounts(),
      agent_only: emptyKindCounts(),
      auditowl_only: emptyKindCounts(),
      related: emptyKindCounts(),
    },
    byStatus: { open: 0, claimed: 0, unsure: 0, closed: 0 },
    closed: 0,
    unsure: 0,
    stale: 0,
    completion: 0,
  }
}

function itemKey(
  batchId: string,
  paperId: string,
  kind: ItemKind,
  ref: string
): string {
  return `${batchId}\u0000${paperId}\u0000${kind}\u0000${ref}`
}

function groupDecisions(
  decisions: readonly DecisionRecord[]
): Map<string, DecisionRecord[]> {
  const grouped = new Map<string, DecisionRecord[]>()
  for (const row of decisions) {
    const key = itemKey(row.batchId, row.paperId, row.itemKind, row.itemRef)
    const bucket = grouped.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      grouped.set(key, [row])
    }
  }
  return grouped
}

function groupClaims(
  claims: readonly Claim[],
  now: number
): Map<string, Claim> {
  const grouped = new Map<string, Claim>()
  for (const claim of claims) {
    if (claim.expiresAt <= now) {
      continue
    }
    grouped.set(
      itemKey(claim.batchId, claim.paperId, claim.itemKind, claim.itemRef),
      claim
    )
  }
  return grouped
}

function computeStats(
  input: ReviewStatsInput,
  items: readonly ReviewItem[]
): ReviewStats {
  const stats = emptyStats()
  const decisionsByItem = groupDecisions(input.decisions)
  const claimsByItem = groupClaims(input.claims, input.now)

  for (const item of items) {
    stats.total += 1
    stats.bySeverity[item.severity] += 1
    stats.byKind[item.kind][item.severity] += 1
    stats.byKind[item.kind].total += 1

    const key = itemKey(input.batchId, item.paperId, item.kind, item.ref)
    const rows = decisionsByItem.get(key) ?? []
    const finalDecision = latestClosedDecision(rows)
    const unsureDecision = latestUnsureDecision(rows)
    const draftDecision = latestDraftDecision(rows)
    const claim = claimsByItem.get(key) ?? null
    const status = deriveItemStatus(
      finalDecision,
      unsureDecision,
      claim,
      draftDecision
    )

    stats.byStatus[status] += 1
    if (status === "closed") {
      stats.closed += 1
    }
    if (status === "unsure") {
      stats.unsure += 1
    }
    if (
      finalDecision &&
      isDecisionStale(finalDecision, item.itemHash, input.manifestSha256)
    ) {
      stats.stale += 1
    }
  }

  stats.completion = stats.total === 0 ? 0 : stats.closed / stats.total
  return stats
}

export function computeBatchStats(input: ReviewStatsInput): ReviewStats {
  return computeStats(input, input.items)
}

export function computePaperStats(
  input: ReviewStatsInput,
  paperId: string
): ReviewStats {
  return computeStats(
    input,
    input.items.filter((item) => item.paperId === paperId)
  )
}

function emptyReviewerStats(userId: string): ReviewerStats {
  return { userId, closed: 0, unsure: 0, drafts: 0, total: 0 }
}

const REVIEWER_STATUS_KEYS: Readonly<
  Record<
    DecisionStatus,
    keyof Pick<ReviewerStats, "closed" | "unsure" | "drafts">
  >
> = {
  closed: "closed",
  unsure: "unsure",
  draft: "drafts",
}

/** Per-reviewer decision counts for one batch. */
export function computeReviewerStats(
  batchId: string,
  decisions: readonly DecisionRecord[]
): ReviewerStats[] {
  const byUser = new Map<string, ReviewerStats>()

  for (const decision of decisions) {
    if (decision.batchId !== batchId) {
      continue
    }
    let stats = byUser.get(decision.userId)
    if (!stats) {
      stats = emptyReviewerStats(decision.userId)
      byUser.set(decision.userId, stats)
    }
    stats[REVIEWER_STATUS_KEYS[decision.status]] += 1
    stats.total += 1
  }

  return [...byUser.values()].sort((a, b) => {
    if (a.closed !== b.closed) {
      return b.closed - a.closed
    }
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  })
}
