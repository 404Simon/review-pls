import { db } from "@/db"
import {
  getUserDecisionEvents,
  getUserDecisionRows,
} from "@/lib/review/decisions"
import {
  listBatches,
  loadItems,
  ReviewDataError,
  type BatchSummary,
} from "@/lib/review/load"
import {
  buildUserDecisionLog,
  type UserDecisionBatch,
  type UserDecisionLog,
} from "@/lib/review/user-decisions"

export interface ScopedUserDecisionLog {
  batchId: string | null
  /** The requested `?batch=` value, kept for the not-mounted message. */
  requestedBatchId: string
  unknownBatch: boolean
  log: UserDecisionLog
}

async function loadDecisionBatch(batchId: string): Promise<UserDecisionBatch> {
  try {
    const loaded = await loadItems(batchId)
    return {
      batchId,
      items: loaded.items,
      manifestSha256: loaded.batch.manifestSha256,
    }
  } catch (error) {
    if (!(error instanceof ReviewDataError)) {
      throw error
    }
    return { batchId, items: [], manifestSha256: "" }
  }
}

async function mountedBatches(): Promise<BatchSummary[]> {
  try {
    return await listBatches()
  } catch (error) {
    // A missing review-data root must not hide the rows that are already in the
    // database. The page still renders the selected batch if one was requested.
    if (error instanceof ReviewDataError) {
      return []
    }
    throw error
  }
}

/**
 * One reviewer's decision log for a single batch. The batch comes from the
 * header selector's `?batch=` state and falls back to the first healthy mounted
 * batch. Only that batch is read from the mount.
 */
export async function loadScopedUserDecisionLog(
  userId: string,
  requestedBatchId: string
): Promise<ScopedUserDecisionLog> {
  const summaries = await mountedBatches()
  const healthy = summaries.filter((batch) => batch.error === undefined)
  const requested =
    requestedBatchId === ""
      ? undefined
      : summaries.find((batch) => batch.batchId === requestedBatchId)
  const unknownBatch = requestedBatchId !== "" && requested === undefined
  const selected = unknownBatch
    ? null
    : (requested ?? healthy[0] ?? summaries[0] ?? null)

  if (!selected) {
    return {
      batchId: null,
      requestedBatchId,
      unknownBatch,
      log: buildUserDecisionLog(userId, [], [], []),
    }
  }

  const [rows, events, batch] = await Promise.all([
    getUserDecisionRows(db, userId, selected.batchId),
    getUserDecisionEvents(db, userId, selected.batchId),
    loadDecisionBatch(selected.batchId),
  ])

  return {
    batchId: selected.batchId,
    requestedBatchId,
    unknownBatch,
    log: buildUserDecisionLog(userId, rows, events, [batch]),
  }
}
