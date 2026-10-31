import { eq } from "drizzle-orm"
import { z } from "zod"

import type { AppDatabase } from "@/db"
import { user } from "@/db/auth-schema"
import { reviewerRole } from "@/db/review-schema"
import {
  adminReleaseClaim,
  ClaimConflictError,
  ClaimExpiredError,
  claimItem,
  heartbeatClaim,
  ItemClosedError,
  releaseClaim,
  type ItemKey,
} from "@/lib/review/claims"
import {
  DecisionStatusError,
  discardDraft,
  reopenDecision,
  saveDecision,
} from "@/lib/review/decisions"
import { loadItems, ReviewDataError } from "@/lib/review/load"
import { consumeRateLimit } from "@/lib/rate-limit"
import {
  AuthorizationError,
  requireAdmin,
  requireReviewer,
  setUserRoleInTransaction,
  type RoleUser,
  type UserRole,
} from "@/lib/review/roles"
import type {
  Claim,
  DecisionRecord,
  DecisionStatus,
  ReviewItem,
} from "@/lib/review/types"

export type ServiceErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "closed"
  | "claim_expired"
  | "not_closed"
  | "no_claim"
  | "failed"

export type ServiceResult<T> =
  { ok: true; data: T } | { ok: false; code: ServiceErrorCode; message: string }

export interface LoadedItemContext {
  item: ReviewItem
  batchItems: readonly ReviewItem[]
  manifestSha256: string
}

export type ItemLoader = (key: ItemKey) => Promise<LoadedItemContext | null>

export const loadItemContext: ItemLoader = async (key) => {
  const loaded = await loadItems(key.batchId)
  const item = loaded.items.find(
    (candidate) =>
      candidate.paperId === key.paperId &&
      candidate.kind === key.itemKind &&
      candidate.ref === key.itemRef
  )
  if (!item) {
    return null
  }
  return {
    item,
    batchItems: loaded.items,
    manifestSha256: loaded.batch.manifestSha256,
  }
}

export interface ServiceOptions {
  now?: number
  loadItem?: ItemLoader
}

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data }
}

export function fail(
  code: ServiceErrorCode,
  message: string
): ServiceResult<never> {
  return { ok: false, code, message }
}

export function toServiceError(error: unknown): ServiceResult<never> {
  if (error instanceof AuthorizationError) {
    return fail(
      error.code === "UNAUTHENTICATED" ? "unauthenticated" : "forbidden",
      error.message
    )
  }
  if (error instanceof ClaimConflictError) {
    return fail("conflict", error.message)
  }
  if (error instanceof ClaimExpiredError) {
    return fail("claim_expired", error.message)
  }
  if (error instanceof ItemClosedError) {
    return fail("closed", error.message)
  }
  if (error instanceof DecisionStatusError) {
    return fail("invalid_input", error.message)
  }
  if (error instanceof z.ZodError) {
    return fail(
      "invalid_input",
      error.issues.map((issue) => issue.message).join("; ")
    )
  }
  if (error instanceof ReviewDataError) {
    return fail(
      error.code === "BATCH_NOT_FOUND" || error.code === "PAPER_NOT_FOUND"
        ? "not_found"
        : "failed",
      "Could not load this item from the review data."
    )
  }
  return fail("failed", "The review action could not be completed.")
}

function loaderFor(options: ServiceOptions): ItemLoader {
  return options.loadItem ?? loadItemContext
}

interface LoadedForUser {
  ok: true
  user: RoleUser
  loaded: LoadedItemContext
}

interface LoadFailed {
  ok: false
  error: ServiceResult<never>
}

async function loadForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions
): Promise<LoadedForUser | LoadFailed> {
  const authorized = await requireReviewer(userRecord, { db })
  const loaded = await loaderFor(options)(key)
  if (!loaded) {
    return {
      ok: false,
      error: fail("not_found", "This item is not part of the batch."),
    }
  }
  return { ok: true, user: authorized.user, loaded }
}

async function loadForAdmin(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions
): Promise<LoadedForUser | LoadFailed> {
  const authorized = await requireAdmin(userRecord, { db })
  const loaded = await loaderFor(options)(key)
  if (!loaded) {
    return {
      ok: false,
      error: fail("not_found", "This item is not part of the batch."),
    }
  }
  return { ok: true, user: authorized.user, loaded }
}

export async function claimItemForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions = {}
): Promise<ServiceResult<Claim>> {
  try {
    const loaded = await loadForUser(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    const claim = await claimItem(
      db,
      key,
      loaded.user.id,
      options.now ?? Date.now()
    )
    return ok(claim)
  } catch (error) {
    return toServiceError(error)
  }
}

export async function releaseItemForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions = {}
): Promise<ServiceResult<{ released: boolean }>> {
  try {
    const loaded = await loadForUser(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    const released = await releaseClaim(db, key, loaded.user.id)
    if (!released) {
      return fail("conflict", "You do not hold this claim.")
    }
    return ok({ released })
  } catch (error) {
    return toServiceError(error)
  }
}

const HEARTBEAT_LIMIT = 120
const HEARTBEAT_WINDOW_MS = 60_000

function consumeHeartbeatRateLimit(userId: string, key: ItemKey): boolean {
  return consumeRateLimit(
    `heartbeat:${userId}:${key.batchId}:${key.paperId}:${key.itemKind}:${key.itemRef}`,
    { limit: HEARTBEAT_LIMIT, windowMs: HEARTBEAT_WINDOW_MS }
  ).allowed
}

export async function heartbeatItemForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions = {}
): Promise<ServiceResult<Claim>> {
  try {
    const loaded = await loadForUser(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    if (!consumeHeartbeatRateLimit(loaded.user.id, key)) {
      return fail(
        "conflict",
        "Too many heartbeats. The claim may have expired; reload the item."
      )
    }
    const claim = await heartbeatClaim(
      db,
      key,
      loaded.user.id,
      options.now ?? Date.now()
    )
    if (!claim) {
      return fail(
        "conflict",
        "Your claim has expired, or another reviewer holds this item."
      )
    }
    return ok(claim)
  } catch (error) {
    return toServiceError(error)
  }
}

export async function saveDecisionForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  status: DecisionStatus,
  payload: unknown,
  options: ServiceOptions = {}
): Promise<ServiceResult<DecisionRecord>> {
  try {
    const loaded = await loadForUser(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    const record = await saveDecision(
      db,
      {
        batchId: key.batchId,
        item: loaded.loaded.item,
        batchItems: loaded.loaded.batchItems,
        manifestSha256: loaded.loaded.manifestSha256,
        userId: loaded.user.id,
        status,
        payload,
      },
      options.now ?? Date.now()
    )
    return ok(record)
  } catch (error) {
    return toServiceError(error)
  }
}

export async function discardDraftForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions = {}
): Promise<ServiceResult<{ discarded: boolean }>> {
  try {
    const loaded = await loadForUser(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    const discarded = await discardDraft(db, key, loaded.user.id)
    if (!discarded) {
      return fail("not_found", "You have no draft on this item.")
    }
    return ok({ discarded })
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminReleaseClaimForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions = {}
): Promise<ServiceResult<{ released: boolean }>> {
  try {
    const loaded = await loadForAdmin(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    const released = await adminReleaseClaim(db, key)
    if (!released) {
      return fail("no_claim", "This item has no claim to release.")
    }
    return ok({ released })
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminReopenItemForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  key: ItemKey,
  options: ServiceOptions = {}
): Promise<ServiceResult<DecisionRecord>> {
  try {
    const loaded = await loadForAdmin(db, userRecord, key, options)
    if (!loaded.ok) {
      return loaded.error
    }
    const reopened = await reopenDecision(
      db,
      key,
      loaded.user.id,
      options.now ?? Date.now()
    )
    if (!reopened) {
      return fail("not_closed", "This item has no closed decision to reopen.")
    }
    return ok(reopened)
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminSetRoleForUser(
  db: AppDatabase,
  userRecord: RoleUser | null | undefined,
  input: { userId: string; role: UserRole }
): Promise<ServiceResult<{ userId: string; role: UserRole }>> {
  try {
    const authorized = await requireAdmin(userRecord, { db })

    // The guard and the write must be one transaction. Two concurrent demotions
    // could otherwise both read two admins and then both commit. better-sqlite3
    // runs each transaction synchronously, so the second request reads the first
    // commit and rejects when only one admin remains.
    return db.transaction(
      (tx) => {
        // `requireAdmin` above ran before the transaction. Re-read the acting
        // user's role under the write lock: another admin may have demoted this
        // request's actor while it was in flight, and a stale authorization must
        // not promote the actor (or an accomplice) back to admin.
        const actingRole = tx
          .select({ role: reviewerRole.role })
          .from(reviewerRole)
          .where(eq(reviewerRole.userId, authorized.user.id))
          .get()?.role
        if (actingRole !== "admin") {
          return fail(
            "forbidden",
            "Only admins can change roles. Your admin role was revoked."
          )
        }

        const target = tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, input.userId))
          .get()
        if (!target) {
          return fail("not_found", "This user does not exist.")
        }

        if (input.role === "reviewer") {
          const targetRole = tx
            .select({ role: reviewerRole.role })
            .from(reviewerRole)
            .where(eq(reviewerRole.userId, input.userId))
            .get()?.role
          if (targetRole === "admin") {
            const admins = tx
              .select({ userId: reviewerRole.userId })
              .from(reviewerRole)
              .where(eq(reviewerRole.role, "admin"))
              .all()
            if (admins.length <= 1) {
              return fail(
                "forbidden",
                "The last admin cannot be demoted. Promote another admin first."
              )
            }
            if (input.userId === authorized.user.id) {
              return fail(
                "forbidden",
                "You cannot demote yourself. Ask another admin to change your role."
              )
            }
          }
        }

        setUserRoleInTransaction(tx, input.userId, input.role)
        return ok(input)
      },
      // Take the write lock before the admin count so two app processes cannot
      // both read the pre-demotion count.
      { behavior: "immediate" }
    )
  } catch (error) {
    return toServiceError(error)
  }
}
