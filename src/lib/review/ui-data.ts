import { db } from "@/db"
import { getBatchClaims } from "@/lib/review/claims"
import {
  getBatchDecisionEvents,
  getBatchDecisionRows,
  getReviewStateForItems,
  type ItemReviewState,
} from "@/lib/review/decisions"
import { loadItems, type LoadedItems } from "@/lib/review/load"
import { collectReviewerIds, getReviewerNames } from "@/lib/review/reviewers"
import type { Claim, DecisionRecord } from "@/lib/review/types"

export { collectReviewerIds } from "@/lib/review/reviewers"

export interface BatchReviewView {
  loaded: LoadedItems
  states: Record<string, ItemReviewState>
  decisions: DecisionRecord[]
  claims: Claim[]
  reviewerNames: Record<string, string>
  /** One read timestamp for every derived state on this page. */
  now: number
}

function toStateRecord(
  map: Map<string, ItemReviewState>
): Record<string, ItemReviewState> {
  return Object.fromEntries(map.entries())
}

/**
 * Load a batch, its items, review state and reviewer display names in one
 * server-only call. Client components only receive plain objects.
 */
export async function loadBatchReviewView(
  batchId: string,
  userId: string
): Promise<BatchReviewView> {
  const loaded = await loadItems(batchId)
  const now = Date.now()
  const [stateMap, decisions, events, claims] = await Promise.all([
    getReviewStateForItems(
      db,
      batchId,
      loaded.items,
      userId,
      loaded.batch.manifestSha256,
      now
    ),
    getBatchDecisionRows(db, batchId),
    getBatchDecisionEvents(db, batchId),
    getBatchClaims(db, batchId, now),
  ])

  return {
    loaded,
    states: toStateRecord(stateMap),
    decisions,
    claims,
    reviewerNames: getReviewerNames(
      db,
      collectReviewerIds(decisions, claims, events)
    ),
    now,
  }
}
