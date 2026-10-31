import type { AppDatabase } from "@/db"
import { getBatchClaimRows, getBatchClaims } from "@/lib/review/claims"
import {
  getBatchDecisionEvents,
  getBatchDecisionRows,
} from "@/lib/review/decisions"
import { loadItems, type LoadedItems } from "@/lib/review/load"
import {
  collectReviewerIds,
  getReviewerIdentities,
} from "@/lib/review/reviewers"
import type {
  Claim,
  DecisionEventRecord,
  DecisionRecord,
} from "@/lib/review/types"
import type { ExportReviewer } from "@/lib/review/export"

export interface ExportData {
  loaded: LoadedItems
  decisions: DecisionRecord[]
  events: DecisionEventRecord[]
  claims: Claim[]
  reviewers: ExportReviewer[]
  exportedAt: number
}

export interface LoadExportOptions {
  root?: string
  now?: number
  /** Dataset exports keep expired claim rows; the admin UI uses live claims. */
  includeExpiredClaims?: boolean
}

/**
 * Server-side export loader. The builders in `export.ts` stay pure; this is the
 * only place exports touch the mount and the database.
 */
export async function loadExportData(
  db: AppDatabase,
  batchId: string,
  options: LoadExportOptions = {}
): Promise<ExportData> {
  const loaded = await loadItems(batchId, { root: options.root })
  const [decisions, events, claims] = await Promise.all([
    getBatchDecisionRows(db, batchId),
    getBatchDecisionEvents(db, batchId),
    options.includeExpiredClaims === false
      ? getBatchClaims(db, batchId, options.now ?? Date.now())
      : getBatchClaimRows(db, batchId),
  ])
  const reviewers = getReviewerIdentities(
    db,
    collectReviewerIds(decisions, claims, events)
  )

  return {
    loaded,
    decisions,
    events,
    claims,
    reviewers,
    exportedAt: options.now ?? Date.now(),
  }
}
