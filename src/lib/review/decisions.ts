import { randomUUID } from "node:crypto"

import { and, asc, desc, eq, inArray } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import {
  itemClaim,
  reviewDecision,
  reviewDecisionEvent,
} from "@/db/review-schema"
import {
  ClaimExpiredError,
  CLAIM_LEASE_MS,
  claimItemConditions,
  ensureClaim,
  getItemClaim,
  ItemClosedError,
  reapExpiredClaims,
  toClaim,
  type ItemKey,
  type ReviewTransaction,
} from "@/lib/review/claims"
import {
  validateDecisionAgainstItem,
  validateDraftAgainstItem,
} from "@/lib/review/decision-rules"
import {
  validateDecisionPayload,
  validateDraftDecisionPayload,
  type Claim,
  type DecisionEventRecord,
  type DecisionEventStatus,
  type DecisionPayload,
  type DecisionRecord,
  type DecisionStatus,
  type DraftDecision,
  type ItemKind,
  type ItemStatus,
  type ReviewItem,
} from "@/lib/review/types"

export { ItemClosedError }

export interface ItemWithHash {
  id: string
  kind: ItemKind
  paperId: string
  ref: string
  itemHash: string
}

type DecisionRow = typeof reviewDecision.$inferSelect
type DecisionEventRow = typeof reviewDecisionEvent.$inferSelect

export class DecisionStatusError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DecisionStatusError"
  }
}

export interface DecisionView {
  record: DecisionRecord
  stale: boolean
}

export interface DecisionEventView {
  record: DecisionEventRecord
  stale: boolean
}

export interface ItemReviewState {
  status: ItemStatus
  claim: Claim | null
  finalDecision: DecisionView | null
  /**
   * The current row's unsure status. This is null after the same reviewer
   * replaces the row with a draft, so use `unsureHistory` for the note.
   */
  latestUnsure: DecisionView | null
  /** Append-only unsure events, newest first. Never overwritten by a draft. */
  unsureHistory: DecisionEventView[]
  draft: DecisionView | null
}

export interface SaveDecisionInput {
  batchId: string
  item: ReviewItem
  /** Every item in the same batch, used to validate `proposedLink` targets. */
  batchItems: readonly ReviewItem[]
  manifestSha256: string
  userId: string
  status: DecisionStatus
  payload: unknown
}

function toDecisionRecord(row: DecisionRow): DecisionRecord {
  const payload: unknown = JSON.parse(row.payload)
  return {
    id: row.id,
    batchId: row.batchId,
    paperId: row.paperId,
    itemKind: row.itemKind,
    itemRef: row.itemRef,
    userId: row.userId,
    status: row.status,
    payload,
    itemHash: row.itemHash,
    manifestSha256: row.manifestSha256,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDecisionEventRecord(row: DecisionEventRow): DecisionEventRecord {
  const payload: unknown = JSON.parse(row.payload)
  return {
    id: row.id,
    batchId: row.batchId,
    paperId: row.paperId,
    itemKind: row.itemKind,
    itemRef: row.itemRef,
    userId: row.userId,
    status: row.status,
    payload,
    itemHash: row.itemHash,
    manifestSha256: row.manifestSha256,
    createdAt: row.createdAt,
  }
}

function withBatch(item: ItemWithHash, batchId: string): ItemKey {
  return {
    batchId,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
  }
}

function itemConditions(key: ItemKey) {
  return and(
    eq(reviewDecision.batchId, key.batchId),
    eq(reviewDecision.paperId, key.paperId),
    eq(reviewDecision.itemKind, key.itemKind),
    eq(reviewDecision.itemRef, key.itemRef)
  )
}

function eventConditions(key: ItemKey) {
  return and(
    eq(reviewDecisionEvent.batchId, key.batchId),
    eq(reviewDecisionEvent.paperId, key.paperId),
    eq(reviewDecisionEvent.itemKind, key.itemKind),
    eq(reviewDecisionEvent.itemRef, key.itemRef)
  )
}

function isNewer(a: DecisionRecord, b: DecisionRecord): boolean {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt > b.createdAt
  }
  return a.id > b.id
}

function latest(
  rows: readonly DecisionRecord[],
  status: DecisionStatus
): DecisionRecord | null {
  let result: DecisionRecord | null = null
  for (const row of rows) {
    if (row.status !== status) {
      continue
    }
    if (!result || isNewer(row, result)) {
      result = row
    }
  }
  return result
}

/** The latest closed decision, regardless of reviewer, wins. */
export function latestClosedDecision(
  rows: readonly DecisionRecord[]
): DecisionRecord | null {
  return latest(rows, "closed")
}

export function latestUnsureDecision(
  rows: readonly DecisionRecord[]
): DecisionRecord | null {
  return latest(rows, "unsure")
}

export function latestDraftDecision(
  rows: readonly DecisionRecord[]
): DecisionRecord | null {
  return latest(rows, "draft")
}

/**
 * PLAN §8.2: closed wins; else unsure while it is still the current row; else
 * an active claim; else open.
 *
 * A draft written after an unsure marker means the reviewer resumed work. The
 * item is then claimed/open again, while the unsure event remains in the
 * append-only history.
 */
export function deriveItemStatus(
  finalDecision: DecisionRecord | null,
  unsureDecision: DecisionRecord | null,
  activeClaim: Claim | null,
  latestDraft: DecisionRecord | null = null
): ItemStatus {
  if (finalDecision) {
    return "closed"
  }
  if (
    unsureDecision &&
    (!latestDraft || !isNewer(latestDraft, unsureDecision))
  ) {
    return "unsure"
  }
  if (activeClaim) {
    return "claimed"
  }
  return "open"
}

export function isDecisionStale(
  record: Pick<DecisionRecord, "itemHash" | "manifestSha256">,
  itemHash: string,
  manifestSha256: string
): boolean {
  return (
    record.itemHash !== itemHash || record.manifestSha256 !== manifestSha256
  )
}

function decisionView(
  record: DecisionRecord | null,
  item: ItemWithHash,
  manifestSha256: string
): DecisionView | null {
  if (!record) {
    return null
  }
  return {
    record,
    stale: isDecisionStale(record, item.itemHash, manifestSha256),
  }
}

function decisionEventView(
  record: DecisionEventRecord,
  item: ItemWithHash,
  manifestSha256: string
): DecisionEventView {
  return {
    record,
    stale: isDecisionStale(record, item.itemHash, manifestSha256),
  }
}

function toEventRecord(record: DecisionRecord): DecisionEventRecord {
  return {
    id: record.id,
    batchId: record.batchId,
    paperId: record.paperId,
    itemKind: record.itemKind,
    itemRef: record.itemRef,
    userId: record.userId,
    status: record.status === "closed" ? "closed" : "unsure",
    payload: record.payload,
    itemHash: record.itemHash,
    manifestSha256: record.manifestSha256,
    createdAt: record.updatedAt,
  }
}

function buildUnsureHistory(
  events: readonly DecisionEventRecord[],
  latestUnsure: DecisionRecord | null,
  item: ItemWithHash,
  manifestSha256: string
): DecisionEventView[] {
  const history = events
    .filter((event) => event.status === "unsure")
    .slice()
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return b.createdAt - a.createdAt
      }
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
    .map((event) => decisionEventView(event, item, manifestSha256))

  // Databases migrated from before the event table still show their current
  // unsure row even though no event exists for it.
  if (
    latestUnsure &&
    !history.some(
      (entry) =>
        entry.record.userId === latestUnsure.userId &&
        entry.record.createdAt === latestUnsure.updatedAt
    )
  ) {
    history.unshift(
      decisionEventView(toEventRecord(latestUnsure), item, manifestSha256)
    )
  }
  return history
}

function deriveState(
  rows: readonly DecisionRecord[],
  events: readonly DecisionEventRecord[],
  claim: Claim | null,
  userId: string,
  item: ItemWithHash,
  manifestSha256: string
): ItemReviewState {
  const finalDecision = latestClosedDecision(rows)
  const latestUnsure = latestUnsureDecision(rows)
  const latestDraft = latestDraftDecision(rows)
  const draft = latest(
    rows.filter((row) => row.userId === userId),
    "draft"
  )

  return {
    status: deriveItemStatus(finalDecision, latestUnsure, claim, latestDraft),
    claim,
    finalDecision: decisionView(finalDecision, item, manifestSha256),
    latestUnsure: decisionView(latestUnsure, item, manifestSha256),
    unsureHistory: buildUnsureHistory(
      events,
      latestUnsure,
      item,
      manifestSha256
    ),
    draft: decisionView(draft, item, manifestSha256),
  }
}

function assertStatusMatchesPayload(
  status: DecisionStatus,
  payload: DecisionPayload
): void {
  if (status === "unsure" && payload.verdict !== "unsure") {
    throw new DecisionStatusError(
      "An unsure decision must use the unsure verdict."
    )
  }
  if (status === "closed" && payload.verdict === "unsure") {
    throw new DecisionStatusError(
      "The unsure verdict cannot be saved as a closed decision."
    )
  }
}

function assertNoClosedDecision(tx: ReviewTransaction, key: ItemKey): void {
  const closed = tx
    .select()
    .from(reviewDecision)
    .where(and(itemConditions(key), eq(reviewDecision.status, "closed")))
    .orderBy(desc(reviewDecision.updatedAt), desc(reviewDecision.createdAt))
    .get()

  if (closed) {
    throw new ItemClosedError()
  }
}

function upsertDecision(
  tx: ReviewTransaction,
  key: ItemKey,
  input: SaveDecisionInput,
  payload: DecisionPayload | DraftDecision,
  now: number
): DecisionRecord {
  const existing = tx
    .select()
    .from(reviewDecision)
    .where(and(itemConditions(key), eq(reviewDecision.userId, input.userId)))
    .get()

  const fields = {
    status: input.status,
    payload: JSON.stringify(payload),
    itemHash: input.item.itemHash,
    manifestSha256: input.manifestSha256,
    updatedAt: now,
  }

  const row = existing
    ? tx
        .update(reviewDecision)
        .set(fields)
        .where(eq(reviewDecision.id, existing.id))
        .returning()
        .get()
    : tx
        .insert(reviewDecision)
        .values({
          id: randomUUID(),
          batchId: key.batchId,
          paperId: key.paperId,
          itemKind: key.itemKind,
          itemRef: key.itemRef,
          userId: input.userId,
          createdAt: now,
          ...fields,
        })
        .returning()
        .get()

  return toDecisionRecord(row)
}

function insertDecisionEvent(
  tx: ReviewTransaction,
  key: ItemKey,
  input: SaveDecisionInput,
  status: DecisionEventStatus,
  payload: DecisionPayload | DraftDecision,
  now: number
): void {
  tx.insert(reviewDecisionEvent)
    .values({
      id: randomUUID(),
      batchId: key.batchId,
      paperId: key.paperId,
      itemKind: key.itemKind,
      itemRef: key.itemRef,
      userId: input.userId,
      status,
      payload: JSON.stringify(payload),
      itemHash: input.item.itemHash,
      manifestSha256: input.manifestSha256,
      createdAt: now,
    })
    .run()
}

/**
 * Save a draft, a final decision or an unsure marker.
 *
 * Everything runs in one transaction: payload validation, the closed-item
 * guard, claim acquisition and the decision row. An invalid payload therefore
 * cannot leave a claim behind. Drafts keep the lease; closed/unsure release it.
 *
 * An expired claim held by the same reviewer is rejected: the reviewer must
 * explicitly re-claim instead of silently extending the old lease. A missing
 * claim row may still atomically claim a free item, and an expired claim held
 * by another reviewer is treated as free.
 */
export async function saveDecision(
  db: AppDatabase,
  input: SaveDecisionInput,
  now: number = Date.now()
): Promise<DecisionRecord> {
  return db.transaction((tx) => {
    let payload: DecisionPayload | DraftDecision
    if (input.status === "draft") {
      const draftPayload = validateDraftDecisionPayload(input.payload)
      validateDraftAgainstItem(input.item, draftPayload, input.batchItems)
      payload = draftPayload
    } else {
      const finalPayload = validateDecisionPayload(
        input.item.kind,
        input.payload,
        input.item.severity
      )
      validateDecisionAgainstItem(input.item, finalPayload, input.batchItems)
      assertStatusMatchesPayload(input.status, finalPayload)
      payload = finalPayload
    }

    const key = withBatch(input.item, input.batchId)
    assertNoClosedDecision(tx, key)

    const existingClaim = tx
      .select()
      .from(itemClaim)
      .where(claimItemConditions(key))
      .get()
    if (
      existingClaim &&
      existingClaim.userId === input.userId &&
      existingClaim.expiresAt <= now
    ) {
      throw new ClaimExpiredError()
    }

    const claim = ensureClaim(tx, key, input.userId, now)
    const record = upsertDecision(tx, key, input, payload, now)

    if (input.status === "draft") {
      tx.update(itemClaim)
        .set({ lastSeenAt: now, expiresAt: now + CLAIM_LEASE_MS })
        .where(eq(itemClaim.id, claim.id))
        .run()
    } else {
      insertDecisionEvent(
        tx,
        key,
        input,
        input.status === "closed" ? "closed" : "unsure",
        payload,
        now
      )
      tx.delete(itemClaim).where(eq(itemClaim.id, claim.id)).run()
    }

    return record
  })
}

export async function getItemReviewState(
  db: AppDatabase,
  batchId: string,
  item: ItemWithHash,
  userId: string,
  manifestSha256: string,
  now: number = Date.now()
): Promise<ItemReviewState> {
  const key = withBatch(item, batchId)
  const rows = db
    .select()
    .from(reviewDecision)
    .where(itemConditions(key))
    .all()
    .map(toDecisionRecord)
  const events = db
    .select()
    .from(reviewDecisionEvent)
    .where(eventConditions(key))
    .orderBy(desc(reviewDecisionEvent.createdAt))
    .all()
    .map(toDecisionEventRecord)
  const claim = await getItemClaim(db, key, now)

  return deriveState(rows, events, claim, userId, item, manifestSha256)
}

/**
 * Load review state for a list of items in one pass. Returns a map keyed by
 * the item id used in routes (`<kind>:<paperId>:<encoded ref>`).
 */
export async function getReviewStateForItems(
  db: AppDatabase,
  batchId: string,
  items: readonly ItemWithHash[],
  userId: string,
  manifestSha256: string,
  now: number = Date.now()
): Promise<Map<string, ItemReviewState>> {
  // Reap before reading so expired rows do not accumulate on list pages.
  await reapExpiredClaims(db, now, batchId)
  const decisionRows = db
    .select()
    .from(reviewDecision)
    .where(eq(reviewDecision.batchId, batchId))
    .all()
    .map(toDecisionRecord)
  const eventRows = db
    .select()
    .from(reviewDecisionEvent)
    .where(eq(reviewDecisionEvent.batchId, batchId))
    .orderBy(desc(reviewDecisionEvent.createdAt))
    .all()
    .map(toDecisionEventRecord)
  const claimRows = db
    .select()
    .from(itemClaim)
    .where(eq(itemClaim.batchId, batchId))
    .all()

  const decisionsByItem = new Map<string, DecisionRecord[]>()
  const eventsByItem = new Map<string, DecisionEventRecord[]>()
  const closedItemKeys = new Set<string>()
  for (const row of decisionRows) {
    const key = `${row.paperId}\u0000${row.itemKind}\u0000${row.itemRef}`
    const bucket = decisionsByItem.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      decisionsByItem.set(key, [row])
    }
    if (row.status === "closed") {
      closedItemKeys.add(key)
    }
  }
  for (const event of eventRows) {
    const key = `${event.paperId}\u0000${event.itemKind}\u0000${event.itemRef}`
    const bucket = eventsByItem.get(key)
    if (bucket) {
      bucket.push(event)
    } else {
      eventsByItem.set(key, [event])
    }
  }

  const claimsByItem = new Map<string, Claim>()
  const staleClaimIds: string[] = []
  for (const row of claimRows) {
    const key = `${row.paperId}\u0000${row.itemKind}\u0000${row.itemRef}`
    if (row.expiresAt <= now || closedItemKeys.has(key)) {
      staleClaimIds.push(row.id)
      continue
    }
    claimsByItem.set(key, toClaim(row))
  }
  // A live claim on a closed item must never be exposed; it is stale state
  // from a tab that was open when the item closed. Remove it with the read.
  if (staleClaimIds.length > 0) {
    db.delete(itemClaim).where(inArray(itemClaim.id, staleClaimIds)).run()
  }

  const state = new Map<string, ItemReviewState>()
  for (const item of items) {
    const key = `${item.paperId}\u0000${item.kind}\u0000${item.ref}`
    state.set(
      item.id,
      deriveState(
        decisionsByItem.get(key) ?? [],
        eventsByItem.get(key) ?? [],
        claimsByItem.get(key) ?? null,
        userId,
        item,
        manifestSha256
      )
    )
  }
  return state
}

export async function getBatchDecisionRows(
  db: AppDatabase,
  batchId: string
): Promise<DecisionRecord[]> {
  return db
    .select()
    .from(reviewDecision)
    .where(eq(reviewDecision.batchId, batchId))
    .orderBy(
      asc(reviewDecision.paperId),
      asc(reviewDecision.itemKind),
      asc(reviewDecision.itemRef),
      desc(reviewDecision.updatedAt)
    )
    .all()
    .map(toDecisionRecord)
}

/** Every attempt for one item, newest first (drafts included). */
export async function getItemDecisionRows(
  db: AppDatabase,
  batchId: string,
  item: ItemWithHash
): Promise<DecisionRecord[]> {
  const key = withBatch(item, batchId)
  return db
    .select()
    .from(reviewDecision)
    .where(itemConditions(key))
    .orderBy(
      desc(reviewDecision.updatedAt),
      desc(reviewDecision.createdAt),
      desc(reviewDecision.id)
    )
    .all()
    .map(toDecisionRecord)
}

/** Append-only history for one item, newest first. Phase 5 exports consume it. */
export async function getItemDecisionEvents(
  db: AppDatabase,
  batchId: string,
  item: ItemWithHash
): Promise<DecisionEventRecord[]> {
  const key = withBatch(item, batchId)
  return db
    .select()
    .from(reviewDecisionEvent)
    .where(eventConditions(key))
    .orderBy(desc(reviewDecisionEvent.createdAt), desc(reviewDecisionEvent.id))
    .all()
    .map(toDecisionEventRecord)
}

/** Append-only history for a whole batch, newest first. */
export async function getBatchDecisionEvents(
  db: AppDatabase,
  batchId: string
): Promise<DecisionEventRecord[]> {
  return db
    .select()
    .from(reviewDecisionEvent)
    .where(eq(reviewDecisionEvent.batchId, batchId))
    .orderBy(
      desc(reviewDecisionEvent.createdAt),
      desc(reviewDecisionEvent.paperId),
      desc(reviewDecisionEvent.itemRef)
    )
    .all()
    .map(toDecisionEventRecord)
}

export async function getPaperDecisionRows(
  db: AppDatabase,
  batchId: string,
  paperId: string
): Promise<DecisionRecord[]> {
  return db
    .select()
    .from(reviewDecision)
    .where(
      and(
        eq(reviewDecision.batchId, batchId),
        eq(reviewDecision.paperId, paperId)
      )
    )
    .orderBy(
      asc(reviewDecision.itemKind),
      asc(reviewDecision.itemRef),
      desc(reviewDecision.updatedAt)
    )
    .all()
    .map(toDecisionRecord)
}

/**
 * Delete the reviewer's own draft row. Final/unsure rows are untouched, and the
 * append-only event history is never modified.
 */
export async function discardDraft(
  db: AppDatabase,
  key: ItemKey,
  userId: string
): Promise<boolean> {
  const result = db
    .delete(reviewDecision)
    .where(
      and(
        itemConditions(key),
        eq(reviewDecision.userId, userId),
        eq(reviewDecision.status, "draft")
      )
    )
    .run()
  return result.changes > 0
}

/**
 * Admin-only at the call site. Turns the latest closed decision into a draft
 * owned by the admin and releases any claim. The previous payload is preserved.
 * If the admin already had a row for this item it is superseded by the reopened
 * decision, so the unique constraint stays intact.
 */
export async function reopenDecision(
  db: AppDatabase,
  key: ItemKey,
  adminUserId: string,
  now: number = Date.now()
): Promise<DecisionRecord | null> {
  return db.transaction((tx) => {
    const finalRow = tx
      .select()
      .from(reviewDecision)
      .where(and(itemConditions(key), eq(reviewDecision.status, "closed")))
      .orderBy(desc(reviewDecision.updatedAt), desc(reviewDecision.createdAt))
      .get()

    if (!finalRow) {
      return null
    }

    if (finalRow.userId !== adminUserId) {
      tx.delete(reviewDecision)
        .where(and(itemConditions(key), eq(reviewDecision.userId, adminUserId)))
        .run()
    }

    const row = tx
      .update(reviewDecision)
      .set({ userId: adminUserId, status: "draft", updatedAt: now })
      .where(eq(reviewDecision.id, finalRow.id))
      .returning()
      .get()

    tx.insert(reviewDecisionEvent)
      .values({
        id: randomUUID(),
        batchId: key.batchId,
        paperId: key.paperId,
        itemKind: key.itemKind,
        itemRef: key.itemRef,
        userId: adminUserId,
        status: "reopened",
        payload: finalRow.payload,
        itemHash: finalRow.itemHash,
        manifestSha256: finalRow.manifestSha256,
        createdAt: now,
      })
      .run()

    tx.delete(itemClaim).where(claimItemConditions(key)).run()

    return toDecisionRecord(row)
  })
}
