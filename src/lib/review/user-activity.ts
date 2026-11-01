import { computeReviewerStats, type ReviewerStats } from "@/lib/review/stats"
import type {
  Claim,
  DecisionEventRecord,
  DecisionEventStatus,
  DecisionRecord,
} from "@/lib/review/types"

/** One reviewer's decision counts inside a single mounted batch. */
export interface UserBatchActivity extends ReviewerStats {
  batchId: string
}

/**
 * Append-only event counts. Unlike `review_decision`, these rows are never
 * overwritten, so the unsure history stays visible after a later draft or
 * closure by the same reviewer.
 */
export interface UserEventActivity {
  closed: number
  unsure: number
  reopened: number
  total: number
  lastAt: number | null
}

export interface UserActivity {
  /** Batches with at least one decision row by this reviewer, unsorted. */
  batches: UserBatchActivity[]
  events: UserEventActivity
  /** Live claims held now (expired leases are not counted). */
  activeClaims: number
  /** Latest decision write or event for this reviewer, if any. */
  lastActivityAt: number | null
}

export interface UserActivityBatch {
  batchId: string
  decisions: readonly DecisionRecord[]
  events: readonly DecisionEventRecord[]
  /** Active claims only; the caller reaps stale rows before building this. */
  claims: readonly Claim[]
}

const EVENT_KEYS: Readonly<
  Record<
    DecisionEventStatus,
    keyof Pick<UserEventActivity, "closed" | "unsure" | "reopened">
  >
> = {
  closed: "closed",
  unsure: "unsure",
  reopened: "reopened",
}

/**
 * Activity summary for the admin user details dialog. Pure: the admin page
 * passes the rows it already loaded, so this adds no database reads.
 */
export function summarizeUserActivity(
  userId: string,
  batches: readonly UserActivityBatch[],
  now: number
): UserActivity {
  const perBatch: UserBatchActivity[] = []
  const events: UserEventActivity = {
    closed: 0,
    unsure: 0,
    reopened: 0,
    total: 0,
    lastAt: null,
  }
  let activeClaims = 0
  let lastActivityAt: number | null = null

  for (const batch of batches) {
    const stats = computeReviewerStats(batch.batchId, batch.decisions).find(
      (candidate) => candidate.userId === userId
    )
    if (stats) {
      perBatch.push({ batchId: batch.batchId, ...stats })
      for (const decision of batch.decisions) {
        if (decision.userId !== userId) {
          continue
        }
        lastActivityAt = maxTimestamp(lastActivityAt, decision.updatedAt)
      }
    }

    for (const event of batch.events) {
      if (event.userId !== userId) {
        continue
      }
      events[EVENT_KEYS[event.status]] += 1
      events.total += 1
      events.lastAt = maxTimestamp(events.lastAt, event.createdAt)
      lastActivityAt = maxTimestamp(lastActivityAt, event.createdAt)
    }

    for (const claim of batch.claims) {
      if (claim.userId === userId && claim.expiresAt > now) {
        activeClaims += 1
      }
    }
  }

  return {
    batches: perBatch.sort((a, b) => a.batchId.localeCompare(b.batchId)),
    events,
    activeClaims,
    lastActivityAt,
  }
}

function maxTimestamp(current: number | null, candidate: number): number {
  return current === null || candidate > current ? candidate : current
}
