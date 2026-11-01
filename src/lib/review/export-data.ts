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
import {
  buildDecisionsExport,
  buildReviewDataset,
  exportFileName,
  type ExportReviewer,
} from "@/lib/review/export"

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
  /**
   * Keep claim rows that already expired. Only the dataset emits claims, and
   * `computeStats` filters expired claims by `now` regardless, so this never
   * changes an export's stats.
   */
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

export type ExportDocumentType = "dataset" | "decisions"

export interface ExportDocument {
  type: ExportDocumentType
  fileName: string
  /** The exact bytes the download route sends and the CLI writes. */
  content: string
}

export interface BuildExportDocumentOptions {
  root?: string
  now?: number
}

/**
 * Single source of truth for an export payload. The admin download route and
 * `pnpm review:export` both call this, so a download and a written file of the
 * same type and timestamp are byte-identical.
 *
 * The dataset is archival and keeps expired claim rows. The decisions export is
 * a results snapshot; it emits no claims at all.
 */
export async function buildExportDocument(
  db: AppDatabase,
  batchId: string,
  type: ExportDocumentType,
  options: BuildExportDocumentOptions = {}
): Promise<ExportDocument> {
  const now = options.now ?? Date.now()
  const data = await loadExportData(db, batchId, {
    root: options.root,
    now,
    includeExpiredClaims: type === "dataset",
  })
  const document =
    type === "dataset" ? buildReviewDataset(data) : buildDecisionsExport(data)

  return {
    type,
    fileName: exportFileName(type, now),
    content: `${JSON.stringify(document, null, 2)}\n`,
  }
}
