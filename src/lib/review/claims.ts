import { randomUUID } from "node:crypto"

import { and, eq, getTableColumns, gt, inArray, isNull, lte } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import { itemClaim, reviewDecision } from "@/db/review-schema"
import type { Claim, ItemKind } from "@/lib/review/types"

/** Idle lease. Claim, heartbeat and draft saves extend it. */
export const CLAIM_LEASE_MS = 2 * 60 * 60 * 1000

/**
 * SQLite limits bound variables per statement (and older builds cap at 999).
 * Bulk reaping deletes ids in this many rows per statement to stay well below
 * the limit while keeping one transaction around the whole cleanup.
 */
const CLAIM_REAP_CHUNK_SIZE = 500

export interface ItemKey {
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
}

export type ReviewTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0]

export class ClaimConflictError extends Error {
  readonly holderId: string
  readonly expiresAt: number

  constructor(holderId: string, expiresAt: number) {
    super("This item is currently reserved by another reviewer.")
    this.name = "ClaimConflictError"
    this.holderId = holderId
    this.expiresAt = expiresAt
  }
}

/** A closed item is read-only until an admin reopens it. */
export class ItemClosedError extends Error {
  constructor() {
    super("This item is already closed. An admin must reopen it first.")
    this.name = "ItemClosedError"
  }
}

/**
 * Saving from an expired claim is rejected. The reviewer must reserve the item
 * again explicitly instead of silently re-leasing the old claim.
 */
export class ClaimExpiredError extends Error {
  constructor() {
    super(
      "Your claim has expired. Reserve this item again before saving a decision."
    )
    this.name = "ClaimExpiredError"
  }
}

export function claimItemConditions(key: ItemKey) {
  return and(
    eq(itemClaim.batchId, key.batchId),
    eq(itemClaim.paperId, key.paperId),
    eq(itemClaim.itemKind, key.itemKind),
    eq(itemClaim.itemRef, key.itemRef)
  )
}

export function toClaim(row: typeof itemClaim.$inferSelect): Claim {
  return {
    id: row.id,
    batchId: row.batchId,
    paperId: row.paperId,
    itemKind: row.itemKind,
    itemRef: row.itemRef,
    userId: row.userId,
    claimedAt: row.claimedAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  }
}

function isItemClosed(tx: ReviewTransaction, key: ItemKey): boolean {
  const closed = tx
    .select({ id: reviewDecision.id })
    .from(reviewDecision)
    .where(
      and(
        eq(reviewDecision.batchId, key.batchId),
        eq(reviewDecision.paperId, key.paperId),
        eq(reviewDecision.itemKind, key.itemKind),
        eq(reviewDecision.itemRef, key.itemRef),
        eq(reviewDecision.status, "closed")
      )
    )
    .get()

  return closed !== undefined
}

function assertItemNotClosed(tx: ReviewTransaction, key: ItemKey): void {
  if (isItemClosed(tx, key)) {
    throw new ItemClosedError()
  }
}

/**
 * Acquire or renew a claim inside an existing transaction.
 *
 * An expired row is reusable by anyone. A live row held by another reviewer is
 * a conflict; the same reviewer renews without losing the original claim time.
 * A closed item cannot be claimed at all until an admin reopens it.
 * Callers that need the write to be atomic with other writes (decision saves)
 * use this directly inside their own transaction.
 */
export function ensureClaim(
  tx: ReviewTransaction,
  key: ItemKey,
  userId: string,
  now: number
): Claim {
  assertItemNotClosed(tx, key)

  const existing = tx
    .select()
    .from(itemClaim)
    .where(claimItemConditions(key))
    .get()

  if (!existing) {
    const row = tx
      .insert(itemClaim)
      .values({
        id: randomUUID(),
        batchId: key.batchId,
        paperId: key.paperId,
        itemKind: key.itemKind,
        itemRef: key.itemRef,
        userId,
        claimedAt: now,
        lastSeenAt: now,
        expiresAt: now + CLAIM_LEASE_MS,
      })
      .returning()
      .get()
    return toClaim(row)
  }

  const live = existing.expiresAt > now
  if (existing.userId !== userId && live) {
    throw new ClaimConflictError(existing.userId, existing.expiresAt)
  }

  const updated = tx
    .update(itemClaim)
    .set({
      userId,
      claimedAt: live && existing.userId === userId ? existing.claimedAt : now,
      lastSeenAt: now,
      expiresAt: now + CLAIM_LEASE_MS,
    })
    .where(eq(itemClaim.id, existing.id))
    .returning()
    .get()

  return toClaim(updated)
}

export async function claimItem(
  db: AppDatabase,
  key: ItemKey,
  userId: string,
  now: number = Date.now()
): Promise<Claim> {
  return db.transaction((tx) => ensureClaim(tx, key, userId, now))
}

/**
 * Extend a live claim. Returns `null` when the lease has already expired or
 * the claim belongs to someone else; the caller must re-claim the item.
 *
 * A final decision makes the item read-only. A heartbeat that arrives on a
 * closed item (for example from a tab that was open while an admin closed or
 * reopened and re-closed it) is rejected with `ItemClosedError`, and any stale
 * claim row is deleted. The deletion must commit before the error is thrown,
 * so it happens inside the transaction and the throw is deferred.
 */
export async function heartbeatClaim(
  db: AppDatabase,
  key: ItemKey,
  userId: string,
  now: number = Date.now()
): Promise<Claim | null> {
  const outcome = db.transaction((tx) => {
    if (isItemClosed(tx, key)) {
      tx.delete(itemClaim).where(claimItemConditions(key)).run()
      return { closed: true as const, claim: null }
    }

    const updated = tx
      .update(itemClaim)
      .set({ lastSeenAt: now, expiresAt: now + CLAIM_LEASE_MS })
      .where(
        and(
          claimItemConditions(key),
          eq(itemClaim.userId, userId),
          // Strictly greater: a lease that ends exactly now is expired.
          gt(itemClaim.expiresAt, now)
        )
      )
      .returning()
      .get()

    return {
      closed: false as const,
      claim: updated ? toClaim(updated) : null,
    }
  })

  if (outcome.closed) {
    throw new ItemClosedError()
  }
  return outcome.claim
}

export async function releaseClaim(
  db: AppDatabase,
  key: ItemKey,
  userId: string
): Promise<boolean> {
  const result = db
    .delete(itemClaim)
    .where(and(claimItemConditions(key), eq(itemClaim.userId, userId)))
    .run()
  return result.changes > 0
}

/** Admins may release any claim, including an expired one. */
export async function adminReleaseClaim(
  db: AppDatabase,
  key: ItemKey
): Promise<boolean> {
  const result = db.delete(itemClaim).where(claimItemConditions(key)).run()
  return result.changes > 0
}

/**
 * Returns only a live claim on an open item. Expired rows and claims on items
 * that already have a final decision are removed lazily.
 */
export async function getItemClaim(
  db: AppDatabase,
  key: ItemKey,
  now: number = Date.now()
): Promise<Claim | null> {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(itemClaim)
      .where(claimItemConditions(key))
      .get()
    if (!row) {
      return null
    }
    if (row.expiresAt <= now || isItemClosed(tx, key)) {
      tx.delete(itemClaim).where(eq(itemClaim.id, row.id)).run()
      return null
    }
    return toClaim(row)
  })
}

/**
 * Live claims for the admin console. A batch filter keeps the admin page from
 * rescanning every batch for each mounted batch, and claims on items that
 * already have a final decision are excluded (they are stale regardless of the
 * lease). Expired rows are filtered out; the per-item read path reaps them.
 */
export async function getActiveClaims(
  db: AppDatabase,
  now: number = Date.now(),
  batchId?: string
): Promise<Claim[]> {
  const conditions = [gt(itemClaim.expiresAt, now), isNull(reviewDecision.id)]
  if (batchId) {
    conditions.push(eq(itemClaim.batchId, batchId))
  }

  return db
    .select(getTableColumns(itemClaim))
    .from(itemClaim)
    .leftJoin(
      reviewDecision,
      and(
        eq(reviewDecision.batchId, itemClaim.batchId),
        eq(reviewDecision.paperId, itemClaim.paperId),
        eq(reviewDecision.itemKind, itemClaim.itemKind),
        eq(reviewDecision.itemRef, itemClaim.itemRef),
        eq(reviewDecision.status, "closed")
      )
    )
    .where(and(...conditions))
    .all()
    .map(toClaim)
}

/**
 * Delete the claim rows that the admin snapshot filters out: expired leases
 * and claims on items that already have a final decision. The admin page calls
 * this before reading active claims so stale rows do not accumulate.
 */
export async function reapStaleClaims(
  db: AppDatabase,
  now: number = Date.now(),
  batchId?: string
): Promise<number> {
  return db.transaction((tx) => {
    const expiredConditions = [lte(itemClaim.expiresAt, now)]
    const closedConditions = [eq(reviewDecision.status, "closed")]
    if (batchId) {
      expiredConditions.push(eq(itemClaim.batchId, batchId))
      closedConditions.push(eq(itemClaim.batchId, batchId))
    }

    const expired = tx
      .delete(itemClaim)
      .where(and(...expiredConditions))
      .run().changes

    const closedIds = tx
      .select({ id: itemClaim.id })
      .from(itemClaim)
      .innerJoin(
        reviewDecision,
        and(
          eq(reviewDecision.batchId, itemClaim.batchId),
          eq(reviewDecision.paperId, itemClaim.paperId),
          eq(reviewDecision.itemKind, itemClaim.itemKind),
          eq(reviewDecision.itemRef, itemClaim.itemRef)
        )
      )
      .where(and(...closedConditions))
      .all()
      .map((row) => row.id)

    // The admin page runs this during a GET. SQLite caps bound variables per
    // statement, so delete in fixed-size chunks instead of one `inArray`.
    let closed = 0
    for (
      let start = 0;
      start < closedIds.length;
      start += CLAIM_REAP_CHUNK_SIZE
    ) {
      const chunk = closedIds.slice(start, start + CLAIM_REAP_CHUNK_SIZE)
      closed += tx
        .delete(itemClaim)
        .where(inArray(itemClaim.id, chunk))
        .run().changes
    }

    return expired + closed
  })
}

/**
 * Every claim row for a batch, including expired rows that have not been reaped
 * yet. Exports are archival, so they keep the whole current table.
 */
export async function getBatchClaimRows(
  db: AppDatabase,
  batchId: string
): Promise<Claim[]> {
  return db
    .select()
    .from(itemClaim)
    .where(eq(itemClaim.batchId, batchId))
    .all()
    .map(toClaim)
}

/** All claim rows for a batch, including expired rows reaped by the next read. */
export async function getBatchClaims(
  db: AppDatabase,
  batchId: string,
  now: number = Date.now()
): Promise<Claim[]> {
  return db
    .select()
    .from(itemClaim)
    .where(eq(itemClaim.batchId, batchId))
    .all()
    .map(toClaim)
    .filter((claim) => claim.expiresAt > now)
}

/** Deletes expired claims, optionally only for one batch. */
export async function reapExpiredClaims(
  db: AppDatabase,
  now: number = Date.now(),
  batchId?: string
): Promise<number> {
  const condition = batchId
    ? and(eq(itemClaim.batchId, batchId), lte(itemClaim.expiresAt, now))
    : lte(itemClaim.expiresAt, now)
  const result = db.delete(itemClaim).where(condition).run()
  return result.changes
}
