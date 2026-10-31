import { randomUUID } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { itemClaim } from "@/db/review-schema"
import {
  adminReleaseClaim,
  CLAIM_LEASE_MS,
  claimItem,
  ClaimConflictError,
  getActiveClaims,
  getItemClaim,
  heartbeatClaim,
  ItemClosedError,
  reapExpiredClaims,
  reapStaleClaims,
  releaseClaim,
  type ItemKey,
} from "@/lib/review/claims"
import { reopenDecision, saveDecision } from "@/lib/review/decisions"
import type { ReviewItem } from "@/lib/review/types"
import {
  createFixtureItems,
  createTestDb,
  FIXTURE_BATCH_ID,
  FIXTURE_MANIFEST_SHA256,
  getFixtureItem,
  type TestDb,
} from "@/lib/review/test-support"

const T0 = 1_800_000_000_000

let testDb: TestDb
let owner: string
let other: string
let admin: string
let items: ReviewItem[]
let cluster: ReviewItem
let key: ItemKey

beforeEach(() => {
  testDb = createTestDb()
  owner = testDb.createUser("owner")
  other = testDb.createUser("other")
  admin = testDb.createUser("admin")
  items = createFixtureItems()
  cluster = getFixtureItem(items, "cluster", "M01")
  key = {
    batchId: FIXTURE_BATCH_ID,
    paperId: cluster.paperId,
    itemKind: cluster.kind,
    itemRef: cluster.ref,
  }
})

afterEach(() => {
  testDb.close()
})

describe("claimItem", () => {
  it("creates a two-hour lease and renews it for the same reviewer", async () => {
    const first = await claimItem(testDb.db, key, owner, T0)
    expect(first.userId).toBe(owner)
    expect(first.claimedAt).toBe(T0)
    expect(first.expiresAt).toBe(T0 + CLAIM_LEASE_MS)

    const renewed = await claimItem(testDb.db, key, owner, T0 + 60_000)
    expect(renewed.id).toBe(first.id)
    expect(renewed.claimedAt).toBe(T0)
    expect(renewed.expiresAt).toBe(T0 + 60_000 + CLAIM_LEASE_MS)
  })

  it("rejects a live claim held by another reviewer", async () => {
    await claimItem(testDb.db, key, owner, T0)
    await expect(
      claimItem(testDb.db, key, other, T0 + 1)
    ).rejects.toBeInstanceOf(ClaimConflictError)
  })

  it("lets another reviewer take over an expired claim", async () => {
    await claimItem(testDb.db, key, owner, T0)
    const takeoverAt = T0 + CLAIM_LEASE_MS + 1
    const claim = await claimItem(testDb.db, key, other, takeoverAt)
    expect(claim.userId).toBe(other)
    expect(claim.claimedAt).toBe(takeoverAt)
  })

  it("rejects a claim on a closed item for the owner and another user", async () => {
    await saveDecision(
      testDb.db,
      {
        batchId: FIXTURE_BATCH_ID,
        item: cluster,
        batchItems: items,
        manifestSha256: FIXTURE_MANIFEST_SHA256,
        userId: owner,
        status: "closed",
        payload: { verdict: "same_defect", note: "" },
      },
      T0
    )

    await expect(
      claimItem(testDb.db, key, owner, T0 + 1)
    ).rejects.toBeInstanceOf(ItemClosedError)
    await expect(
      claimItem(testDb.db, key, other, T0 + 2)
    ).rejects.toBeInstanceOf(ItemClosedError)
  })

  it("can be claimed again after an admin reopens it", async () => {
    await saveDecision(
      testDb.db,
      {
        batchId: FIXTURE_BATCH_ID,
        item: cluster,
        batchItems: items,
        manifestSha256: FIXTURE_MANIFEST_SHA256,
        userId: owner,
        status: "closed",
        payload: { verdict: "same_defect", note: "" },
      },
      T0
    )
    await reopenDecision(testDb.db, key, admin, T0 + 1)

    const claim = await claimItem(testDb.db, key, other, T0 + 2)
    expect(claim.userId).toBe(other)
  })

  it("settles a genuinely concurrent race with one winner", async () => {
    const results = await Promise.allSettled([
      claimItem(testDb.db, key, owner, T0),
      claimItem(testDb.db, key, other, T0),
    ])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: expect.any(ClaimConflictError),
    })
  })
})

describe("getItemClaim", () => {
  it("returns a live claim and expires it exactly at the lease end", async () => {
    await claimItem(testDb.db, key, owner, T0)
    expect(
      await getItemClaim(testDb.db, key, T0 + CLAIM_LEASE_MS - 1)
    ).not.toBeNull()
    expect(await getItemClaim(testDb.db, key, T0 + CLAIM_LEASE_MS)).toBeNull()
    // The expired row was removed lazily.
    expect(await getItemClaim(testDb.db, key, T0 + CLAIM_LEASE_MS)).toBeNull()
  })

  it("hides and reaps a live row attached to a closed item", async () => {
    await saveDecision(
      testDb.db,
      {
        batchId: FIXTURE_BATCH_ID,
        item: cluster,
        batchItems: items,
        manifestSha256: FIXTURE_MANIFEST_SHA256,
        userId: owner,
        status: "closed",
        payload: { verdict: "same_defect", note: "" },
      },
      T0
    )
    testDb.db
      .insert(itemClaim)
      .values({
        id: randomUUID(),
        batchId: key.batchId,
        paperId: key.paperId,
        itemKind: key.itemKind,
        itemRef: key.itemRef,
        userId: owner,
        claimedAt: T0 + 1,
        lastSeenAt: T0 + 1,
        expiresAt: T0 + 1 + CLAIM_LEASE_MS,
      })
      .run()

    expect(await getItemClaim(testDb.db, key, T0 + 2)).toBeNull()
    expect(testDb.db.select().from(itemClaim).all()).toEqual([])
  })
})

describe("heartbeatClaim", () => {
  it("extends the lease from the heartbeat time", async () => {
    await claimItem(testDb.db, key, owner, T0)
    const beat = await heartbeatClaim(testDb.db, key, owner, T0 + 60 * 60_000)
    expect(beat?.lastSeenAt).toBe(T0 + 60 * 60_000)
    expect(beat?.expiresAt).toBe(T0 + 60 * 60_000 + CLAIM_LEASE_MS)

    const stillHeld = await getItemClaim(
      testDb.db,
      key,
      T0 + 2 * 60 * 60_000 + 1
    )
    expect(stillHeld?.userId).toBe(owner)
  })

  it("does not revive an expired claim and rejects other users", async () => {
    await claimItem(testDb.db, key, owner, T0)
    expect(
      await heartbeatClaim(testDb.db, key, owner, T0 + CLAIM_LEASE_MS)
    ).toBeNull()
    expect(await heartbeatClaim(testDb.db, key, other, T0 + 1)).toBeNull()
  })

  it("rejects a heartbeat on a closed item and deletes the stale claim", async () => {
    await saveDecision(
      testDb.db,
      {
        batchId: FIXTURE_BATCH_ID,
        item: cluster,
        batchItems: items,
        manifestSha256: FIXTURE_MANIFEST_SHA256,
        userId: owner,
        status: "closed",
        payload: { verdict: "same_defect", note: "" },
      },
      T0
    )
    // Simulate a claim written before the item closed (legacy/direct write):
    // the row is still live even though the final decision exists.
    testDb.db
      .insert(itemClaim)
      .values({
        id: randomUUID(),
        batchId: key.batchId,
        paperId: key.paperId,
        itemKind: key.itemKind,
        itemRef: key.itemRef,
        userId: owner,
        claimedAt: T0 + 1,
        lastSeenAt: T0 + 1,
        expiresAt: T0 + 1 + CLAIM_LEASE_MS,
      })
      .run()

    await expect(
      heartbeatClaim(testDb.db, key, owner, T0 + 2)
    ).rejects.toBeInstanceOf(ItemClosedError)
    expect(testDb.db.select().from(itemClaim).all()).toEqual([])
  })
})

describe("release", () => {
  it("lets the owner release a claim", async () => {
    await claimItem(testDb.db, key, owner, T0)
    expect(await releaseClaim(testDb.db, key, owner)).toBe(true)
    expect(await getItemClaim(testDb.db, key, T0 + 1)).toBeNull()
  })

  it("does not let a non-owner release a claim", async () => {
    await claimItem(testDb.db, key, owner, T0)
    expect(await releaseClaim(testDb.db, key, other)).toBe(false)
    expect((await getItemClaim(testDb.db, key, T0 + 1))?.userId).toBe(owner)
  })

  it("lets an admin release any claim", async () => {
    await claimItem(testDb.db, key, owner, T0)
    expect(await adminReleaseClaim(testDb.db, key)).toBe(true)
    expect(await getItemClaim(testDb.db, key, T0 + 1)).toBeNull()
  })
})

describe("getActiveClaims", () => {
  it("filters by batch, expires leases and hides claims on closed items", async () => {
    const second = getFixtureItem(items, "agent_only", "a2")
    const secondKey: ItemKey = {
      batchId: FIXTURE_BATCH_ID,
      paperId: second.paperId,
      itemKind: second.kind,
      itemRef: second.ref,
    }
    const otherBatchKey: ItemKey = { ...key, batchId: "another-batch" }

    await claimItem(testDb.db, key, owner, T0)
    await claimItem(testDb.db, secondKey, owner, T0)
    await claimItem(testDb.db, otherBatchKey, owner, T0)

    // A live row on an item that already has a closed decision is stale.
    await saveDecision(
      testDb.db,
      {
        batchId: FIXTURE_BATCH_ID,
        item: cluster,
        batchItems: items,
        manifestSha256: FIXTURE_MANIFEST_SHA256,
        userId: owner,
        status: "closed",
        payload: { verdict: "same_defect", note: "" },
      },
      T0
    )
    testDb.db
      .insert(itemClaim)
      .values({
        id: randomUUID(),
        batchId: key.batchId,
        paperId: key.paperId,
        itemKind: key.itemKind,
        itemRef: key.itemRef,
        userId: owner,
        claimedAt: T0 + 1,
        lastSeenAt: T0 + 1,
        expiresAt: T0 + 1 + CLAIM_LEASE_MS,
      })
      .run()

    const batchClaims = await getActiveClaims(
      testDb.db,
      T0 + 2,
      FIXTURE_BATCH_ID
    )
    expect(batchClaims.map((claim) => claim.itemRef)).toEqual([second.ref])
    expect(
      (await getActiveClaims(testDb.db, T0 + 2))
        .map((claim) => claim.batchId)
        .sort()
    ).toEqual(["another-batch", FIXTURE_BATCH_ID])
    expect(
      await getActiveClaims(testDb.db, T0 + CLAIM_LEASE_MS, FIXTURE_BATCH_ID)
    ).toEqual([])
  })
})

describe("reapStaleClaims", () => {
  it("removes expired and closed-item claims but keeps live open claims", async () => {
    const second = getFixtureItem(items, "agent_only", "a2")
    const third = getFixtureItem(items, "agent_only", "a3")
    const secondKey: ItemKey = {
      batchId: FIXTURE_BATCH_ID,
      paperId: second.paperId,
      itemKind: second.kind,
      itemRef: second.ref,
    }
    const thirdKey: ItemKey = {
      batchId: FIXTURE_BATCH_ID,
      paperId: third.paperId,
      itemKind: third.kind,
      itemRef: third.ref,
    }

    await claimItem(testDb.db, key, owner, T0)
    // Expired lease that must be removed.
    await claimItem(testDb.db, secondKey, owner, T0 - CLAIM_LEASE_MS)
    // Live claim on an open item that must survive.
    await claimItem(testDb.db, thirdKey, owner, T0)

    // Close the first item while leaving its claim row behind.
    await saveDecision(
      testDb.db,
      {
        batchId: FIXTURE_BATCH_ID,
        item: cluster,
        batchItems: items,
        manifestSha256: FIXTURE_MANIFEST_SHA256,
        userId: owner,
        status: "closed",
        payload: { verdict: "same_defect", note: "" },
      },
      T0
    )
    testDb.db
      .insert(itemClaim)
      .values({
        id: randomUUID(),
        batchId: key.batchId,
        paperId: key.paperId,
        itemKind: key.itemKind,
        itemRef: key.itemRef,
        userId: owner,
        claimedAt: T0 + 1,
        lastSeenAt: T0 + 1,
        expiresAt: T0 + 1 + CLAIM_LEASE_MS,
      })
      .run()

    expect(await reapStaleClaims(testDb.db, T0 + 1)).toBe(2)
    expect(await getItemClaim(testDb.db, key, T0 + 1)).toBeNull()
    expect(await getItemClaim(testDb.db, secondKey, T0 + 1)).toBeNull()
    expect((await getItemClaim(testDb.db, thirdKey, T0 + 1))?.userId).toBe(
      owner
    )
  })
})

describe("reapExpiredClaims", () => {
  it("removes only expired claims in the requested batch", async () => {
    const second = getFixtureItem(items, "agent_only", "a2")
    const secondKey: ItemKey = {
      batchId: FIXTURE_BATCH_ID,
      paperId: second.paperId,
      itemKind: second.kind,
      itemRef: second.ref,
    }
    const otherBatchKey: ItemKey = {
      ...key,
      batchId: "another-batch",
    }

    await claimItem(testDb.db, key, owner, T0)
    await claimItem(testDb.db, secondKey, owner, T0)
    await claimItem(testDb.db, otherBatchKey, owner, T0)

    expect(await reapExpiredClaims(testDb.db, T0 + CLAIM_LEASE_MS - 1)).toBe(0)
    expect(
      await reapExpiredClaims(testDb.db, T0 + CLAIM_LEASE_MS, FIXTURE_BATCH_ID)
    ).toBe(2)
    expect(await getItemClaim(testDb.db, key, T0 + CLAIM_LEASE_MS)).toBeNull()
    expect(
      await getItemClaim(testDb.db, otherBatchKey, T0 + CLAIM_LEASE_MS - 1)
    ).not.toBeNull()
  })
})
