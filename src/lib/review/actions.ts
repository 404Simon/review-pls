"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import type { ItemKey } from "@/lib/review/claims"
import { clearDataHealthCache } from "@/lib/review/data-health"
import { itemId } from "@/lib/review/ids"
import { clearReviewDataCache } from "@/lib/review/load"
import { requireAdmin } from "@/lib/review/roles"
import {
  adminReopenItemForUser,
  adminReleaseClaimForUser,
  adminSetRoleForUser,
  claimItemForUser,
  discardDraftForUser,
  heartbeatItemForUser,
  releaseItemForUser,
  saveDecisionForUser,
  toServiceError,
  type ServiceErrorCode,
  type ServiceResult,
} from "@/lib/review/service"
import {
  decisionStatusSchema,
  itemKindSchema,
  type Claim,
  type DecisionRecord,
} from "@/lib/review/types"
import { getSession } from "@/lib/session"

export type ActionErrorCode = ServiceErrorCode
export type ActionResult<T> = ServiceResult<T>

const itemKeySchema = z.object({
  batchId: z.string().min(1),
  paperId: z.string().min(1),
  itemKind: itemKindSchema,
  itemRef: z.string().min(1),
})

const saveDecisionSchema = itemKeySchema.extend({
  status: decisionStatusSchema,
  payload: z.unknown(),
})

const setRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["reviewer", "admin"]),
})

function revalidateItem(key: ItemKey): void {
  revalidatePath("/dashboard")
  revalidatePath(`/batches/${key.batchId}/queue`)
  revalidatePath(`/batches/${key.batchId}/papers/${key.paperId}`)
  revalidatePath(
    `/batches/${key.batchId}/items/${itemId(
      key.itemKind,
      key.paperId,
      key.itemRef
    )}`
  )
}

function parseKey(input: unknown): ItemKey {
  return itemKeySchema.parse(input)
}

export async function claimItemAction(
  input: unknown
): Promise<ActionResult<Claim>> {
  try {
    const key = parseKey(input)
    const session = await getSession()
    const result = await claimItemForUser(db, session?.user, key)
    if (result.ok) {
      revalidateItem(key)
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function releaseItemAction(
  input: unknown
): Promise<ActionResult<{ released: boolean }>> {
  try {
    const key = parseKey(input)
    const session = await getSession()
    const result = await releaseItemForUser(db, session?.user, key)
    if (result.ok) {
      revalidateItem(key)
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function heartbeatItemAction(
  input: unknown
): Promise<ActionResult<Claim>> {
  try {
    const key = parseKey(input)
    const session = await getSession()
    return await heartbeatItemForUser(db, session?.user, key)
  } catch (error) {
    return toServiceError(error)
  }
}

export async function saveDecisionAction(
  input: unknown
): Promise<ActionResult<DecisionRecord>> {
  try {
    const parsed = saveDecisionSchema.parse(input)
    const key: ItemKey = {
      batchId: parsed.batchId,
      paperId: parsed.paperId,
      itemKind: parsed.itemKind,
      itemRef: parsed.itemRef,
    }
    const session = await getSession()
    const result = await saveDecisionForUser(
      db,
      session?.user,
      key,
      parsed.status,
      parsed.payload
    )
    if (result.ok) {
      revalidateItem(key)
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function discardDraftAction(
  input: unknown
): Promise<ActionResult<{ discarded: boolean }>> {
  try {
    const key = parseKey(input)
    const session = await getSession()
    const result = await discardDraftForUser(db, session?.user, key)
    if (result.ok) {
      revalidateItem(key)
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminReleaseClaimAction(
  input: unknown
): Promise<ActionResult<{ released: boolean }>> {
  try {
    const key = parseKey(input)
    const session = await getSession()
    const result = await adminReleaseClaimForUser(db, session?.user, key)
    if (result.ok) {
      revalidateItem(key)
      revalidatePath("/admin")
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminReopenItemAction(
  input: unknown
): Promise<ActionResult<DecisionRecord>> {
  try {
    const key = parseKey(input)
    const session = await getSession()
    const result = await adminReopenItemForUser(db, session?.user, key)
    if (result.ok) {
      revalidateItem(key)
      revalidatePath("/admin")
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminSetRoleAction(
  input: unknown
): Promise<ActionResult<{ userId: string; role: "reviewer" | "admin" }>> {
  try {
    const parsed = setRoleSchema.parse(input)
    const session = await getSession()
    const result = await adminSetRoleForUser(db, session?.user, parsed)
    if (result.ok) {
      revalidatePath("/admin")
    }
    return result
  } catch (error) {
    return toServiceError(error)
  }
}

export async function adminReloadReviewDataAction(): Promise<
  ActionResult<{ reloaded: true }>
> {
  try {
    const session = await getSession()
    await requireAdmin(session?.user, { db })
    clearReviewDataCache()
    clearDataHealthCache()
    revalidatePath("/admin")
    revalidatePath("/dashboard")
    return { ok: true, data: { reloaded: true } }
  } catch (error) {
    return toServiceError(error)
  }
}
