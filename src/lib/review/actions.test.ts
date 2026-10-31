import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  adminReloadReviewDataAction,
  claimItemAction,
} from "@/lib/review/actions"
import { AuthorizationError } from "@/lib/review/roles"
import { claimItemForUser } from "@/lib/review/service"
import type { Claim } from "@/lib/review/types"

const sessionState = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

const serviceState = vi.hoisted(() => ({
  claimItemForUser: vi.fn(),
}))

const cacheState = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  clearReviewDataCache: vi.fn(),
  clearDataHealthCache: vi.fn(),
}))

vi.mock("@/lib/session", () => ({
  getSession: sessionState.getSession,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

// The action only passes this through to the service; the service tests use a
// real database.
vi.mock("@/db", () => ({ db: {} }))

vi.mock("@/lib/review/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/roles")>()
  return { ...actual, requireAdmin: cacheState.requireAdmin }
})

vi.mock("@/lib/review/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/load")>()
  return {
    ...actual,
    clearReviewDataCache: cacheState.clearReviewDataCache,
  }
})

vi.mock("@/lib/review/data-health", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/review/data-health")>()
  return {
    ...actual,
    clearDataHealthCache: cacheState.clearDataHealthCache,
  }
})

vi.mock("@/lib/review/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/service")>()
  return {
    ...actual,
    claimItemForUser: serviceState.claimItemForUser,
  }
})

const key = {
  batchId: "test-batch",
  paperId: "p1",
  itemKind: "cluster" as const,
  itemRef: "M01",
}

const claim: Claim = {
  id: "claim-1",
  ...key,
  userId: "owner",
  claimedAt: 1,
  lastSeenAt: 1,
  expiresAt: 2,
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/service")>(
    "@/lib/review/service"
  )
  sessionState.getSession.mockReset()
  serviceState.claimItemForUser.mockReset()
  serviceState.claimItemForUser.mockImplementation(actual.claimItemForUser)
  cacheState.requireAdmin.mockReset()
  cacheState.clearReviewDataCache.mockReset()
  cacheState.clearDataHealthCache.mockReset()
})

describe("claimItemAction", () => {
  it("rejects an unauthenticated session before delegating", async () => {
    sessionState.getSession.mockResolvedValue(null)

    await expect(claimItemAction(key)).resolves.toMatchObject({
      ok: false,
      code: "unauthenticated",
    })
    expect(claimItemForUser).toHaveBeenCalledWith({}, undefined, key)
  })

  it("passes the session user and parsed key to the service", async () => {
    const user = { id: "owner", email: "owner@example.org" }
    sessionState.getSession.mockResolvedValue({ user })
    serviceState.claimItemForUser.mockResolvedValueOnce({
      ok: true,
      data: claim,
    })

    await expect(claimItemAction(key)).resolves.toEqual({
      ok: true,
      data: claim,
    })
    expect(claimItemForUser).toHaveBeenCalledWith({}, user, key)
  })

  it("returns a validation error for an unknown item kind", async () => {
    sessionState.getSession.mockResolvedValue({ user: { id: "owner" } })

    await expect(
      claimItemAction({ ...key, itemKind: "not-a-kind" })
    ).resolves.toMatchObject({ ok: false, code: "invalid_input" })
    expect(claimItemForUser).not.toHaveBeenCalled()
  })
})

describe("adminReloadReviewDataAction", () => {
  it("clears both the loader and data-health caches", async () => {
    const user = { id: "admin", email: "admin@example.org" }
    sessionState.getSession.mockResolvedValue({ user })
    cacheState.requireAdmin.mockResolvedValue({ user, role: "admin" })

    await expect(adminReloadReviewDataAction()).resolves.toEqual({
      ok: true,
      data: { reloaded: true },
    })
    expect(cacheState.requireAdmin).toHaveBeenCalledWith(user, { db: {} })
    expect(cacheState.clearReviewDataCache).toHaveBeenCalledTimes(1)
    expect(cacheState.clearDataHealthCache).toHaveBeenCalledTimes(1)
  })

  it("does not clear either cache when the actor is not an admin", async () => {
    sessionState.getSession.mockResolvedValue({ user: { id: "reviewer" } })
    cacheState.requireAdmin.mockRejectedValue(
      new AuthorizationError(
        "FORBIDDEN",
        "Only admins can perform this action."
      )
    )

    await expect(adminReloadReviewDataAction()).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    })
    expect(cacheState.clearReviewDataCache).not.toHaveBeenCalled()
    expect(cacheState.clearDataHealthCache).not.toHaveBeenCalled()
  })
})
