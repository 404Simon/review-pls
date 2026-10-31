import { randomUUID } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { itemClaim } from "@/db/review-schema"
import { CLAIM_LEASE_MS, claimItem, type ItemKey } from "@/lib/review/claims"
import { saveDecision } from "@/lib/review/decisions"
import { getUserRole, setUserRole } from "@/lib/review/roles"
import {
  adminReleaseClaimForUser,
  adminReopenItemForUser,
  adminSetRoleForUser,
  claimItemForUser,
  heartbeatItemForUser,
  releaseItemForUser,
  saveDecisionForUser,
  type LoadedItemContext,
} from "@/lib/review/service"
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
let loaded: LoadedItemContext

function keyOf(item: ReviewItem): ItemKey {
  return {
    batchId: FIXTURE_BATCH_ID,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
  }
}

function loader(context: LoadedItemContext | null) {
  return async (): Promise<LoadedItemContext | null> => context
}

beforeEach(async () => {
  testDb = createTestDb()
  owner = testDb.createUser("owner")
  other = testDb.createUser("other")
  admin = testDb.createUser("admin")
  await setUserRole(admin, "admin", { db: testDb.db, now: 1 })
  items = createFixtureItems()
  cluster = getFixtureItem(items, "cluster", "M01")
  key = keyOf(cluster)
  loaded = {
    item: cluster,
    batchItems: items,
    manifestSha256: FIXTURE_MANIFEST_SHA256,
  }
})

afterEach(() => {
  testDb.close()
})

describe("claimItemForUser", () => {
  it("requires a session", async () => {
    const result = await claimItemForUser(testDb.db, null, key, {
      now: T0,
      loadItem: loader(loaded),
    })
    expect(result).toMatchObject({ ok: false, code: "unauthenticated" })
  })

  it("returns not_found for an item outside the batch", async () => {
    const result = await claimItemForUser(testDb.db, { id: owner }, key, {
      now: T0,
      loadItem: loader(null),
    })
    expect(result).toMatchObject({ ok: false, code: "not_found" })
  })

  it("claims a free item and reports a conflict on another user", async () => {
    const first = await claimItemForUser(testDb.db, { id: owner }, key, {
      now: T0,
      loadItem: loader(loaded),
    })
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) {
      throw new Error("expected a claim")
    }
    expect(first.data.userId).toBe(owner)

    const second = await claimItemForUser(testDb.db, { id: other }, key, {
      now: T0 + 1,
      loadItem: loader(loaded),
    })
    expect(second).toMatchObject({ ok: false, code: "conflict" })
  })
})

describe("releaseItemForUser", () => {
  it("releases the owner's claim and rejects a non-owner", async () => {
    await claimItem(testDb.db, key, owner, T0)

    await expect(
      releaseItemForUser(testDb.db, { id: other }, key, {
        now: T0 + 1,
        loadItem: loader(loaded),
      })
    ).resolves.toMatchObject({ ok: false, code: "conflict" })

    await expect(
      releaseItemForUser(testDb.db, { id: owner }, key, {
        now: T0 + 1,
        loadItem: loader(loaded),
      })
    ).resolves.toEqual({ ok: true, data: { released: true } })
  })
})

describe("heartbeatItemForUser", () => {
  it("rejects a heartbeat on a closed item and removes the legacy claim", async () => {
    await saveDecision(testDb.db, {
      batchId: FIXTURE_BATCH_ID,
      item: cluster,
      batchItems: items,
      manifestSha256: FIXTURE_MANIFEST_SHA256,
      userId: owner,
      status: "closed",
      payload: { verdict: "same_defect", note: "" },
    })
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

    const result = await heartbeatItemForUser(testDb.db, { id: owner }, key, {
      now: T0 + 2,
      loadItem: loader(loaded),
    })
    expect(result).toMatchObject({ ok: false, code: "closed" })
    expect(testDb.db.select().from(itemClaim).all()).toEqual([])
  })
})

describe("saveDecisionForUser", () => {
  it("returns a clear closed error after another reviewer closes the item", async () => {
    await saveDecision(testDb.db, {
      batchId: FIXTURE_BATCH_ID,
      item: cluster,
      batchItems: items,
      manifestSha256: FIXTURE_MANIFEST_SHA256,
      userId: owner,
      status: "closed",
      payload: { verdict: "same_defect", note: "" },
    })

    const result = await claimItemForUser(testDb.db, { id: other }, key, {
      now: T0,
      loadItem: loader(loaded),
    })
    expect(result).toMatchObject({ ok: false, code: "closed" })
  })

  it("rejects an expired own claim instead of re-leasing it", async () => {
    await claimItem(testDb.db, key, owner, T0)
    const result = await saveDecisionForUser(
      testDb.db,
      { id: owner },
      key,
      "draft",
      { verdict: "same_defect", note: "" },
      {
        now: T0 + CLAIM_LEASE_MS,
        loadItem: loader(loaded),
      }
    )
    expect(result).toMatchObject({ ok: false, code: "claim_expired" })
  })

  it("validates payload rules against the full item", async () => {
    const result = await saveDecisionForUser(
      testDb.db,
      { id: owner },
      key,
      "closed",
      { verdict: "not_a_match", note: "different", strength: "exact" },
      {
        now: T0,
        loadItem: loader(loaded),
      }
    )
    expect(result).toMatchObject({ ok: false, code: "invalid_input" })
  })
})

describe("admin actions", () => {
  it("distinguishes no_claim from a released claim", async () => {
    await expect(
      adminReleaseClaimForUser(testDb.db, { id: admin }, key, {
        now: T0,
        loadItem: loader(loaded),
      })
    ).resolves.toMatchObject({ ok: false, code: "no_claim" })

    await claimItem(testDb.db, key, owner, T0)
    await expect(
      adminReleaseClaimForUser(testDb.db, { id: admin }, key, {
        now: T0 + 1,
        loadItem: loader(loaded),
      })
    ).resolves.toEqual({ ok: true, data: { released: true } })
  })

  it("distinguishes not_found, not_closed and a successful reopen", async () => {
    await expect(
      adminReopenItemForUser(testDb.db, { id: admin }, key, {
        now: T0,
        loadItem: loader(null),
      })
    ).resolves.toMatchObject({ ok: false, code: "not_found" })

    await expect(
      adminReopenItemForUser(testDb.db, { id: admin }, key, {
        now: T0,
        loadItem: loader(loaded),
      })
    ).resolves.toMatchObject({ ok: false, code: "not_closed" })

    await saveDecision(testDb.db, {
      batchId: FIXTURE_BATCH_ID,
      item: cluster,
      batchItems: items,
      manifestSha256: FIXTURE_MANIFEST_SHA256,
      userId: owner,
      status: "closed",
      payload: { verdict: "same_defect", note: "" },
    })
    const reopened = await adminReopenItemForUser(
      testDb.db,
      { id: admin },
      key,
      { now: T0 + 2, loadItem: loader(loaded) }
    )
    expect(reopened).toMatchObject({ ok: true })
    if (!reopened.ok) {
      throw new Error("expected a reopened decision")
    }
    expect(reopened.data.status).toBe("draft")
    expect(reopened.data.userId).toBe(admin)
  })

  it("forbids non-admins", async () => {
    const result = await adminReopenItemForUser(testDb.db, { id: owner }, key, {
      now: T0,
      loadItem: loader(loaded),
    })
    expect(result).toMatchObject({ ok: false, code: "forbidden" })
  })

  it("returns not_found instead of a generic failure for an unknown user", async () => {
    await expect(
      adminSetRoleForUser(
        testDb.db,
        { id: admin },
        {
          userId: "does-not-exist",
          role: "admin",
        }
      )
    ).resolves.toMatchObject({ ok: false, code: "not_found" })
  })

  it("lets an admin set another user's role", async () => {
    await expect(
      adminSetRoleForUser(
        testDb.db,
        { id: admin },
        {
          userId: other,
          role: "admin",
        }
      )
    ).resolves.toEqual({ ok: true, data: { userId: other, role: "admin" } })
    await expect(getUserRole({ id: other }, { db: testDb.db })).resolves.toBe(
      "admin"
    )
  })

  it("refuses to demote the last admin", async () => {
    const result = await adminSetRoleForUser(
      testDb.db,
      { id: admin },
      {
        userId: admin,
        role: "reviewer",
      }
    )
    expect(result).toMatchObject({ ok: false, code: "forbidden" })
    if (!result.ok) {
      expect(result.message).toMatch(/last admin/i)
    }
    await expect(getUserRole({ id: admin }, { db: testDb.db })).resolves.toBe(
      "admin"
    )
  })

  it("refuses self-demotion even when another admin exists", async () => {
    const secondAdmin = testDb.createUser("admin2")
    await setUserRole(secondAdmin, "admin", { db: testDb.db, now: 2 })

    const result = await adminSetRoleForUser(
      testDb.db,
      { id: admin },
      {
        userId: admin,
        role: "reviewer",
      }
    )
    expect(result).toMatchObject({ ok: false, code: "forbidden" })
    if (!result.ok) {
      expect(result.message).toMatch(/cannot demote yourself/i)
    }
    await expect(getUserRole({ id: admin }, { db: testDb.db })).resolves.toBe(
      "admin"
    )
  })

  it("still lets two admins demote one non-self admin", async () => {
    const secondAdmin = testDb.createUser("admin2")
    await setUserRole(secondAdmin, "admin", { db: testDb.db, now: 2 })

    await expect(
      adminSetRoleForUser(
        testDb.db,
        { id: admin },
        {
          userId: secondAdmin,
          role: "reviewer",
        }
      )
    ).resolves.toEqual({
      ok: true,
      data: { userId: secondAdmin, role: "reviewer" },
    })
    await expect(
      getUserRole({ id: secondAdmin }, { db: testDb.db })
    ).resolves.toBe("reviewer")
  })

  it("keeps one admin when two admins demote each other concurrently", async () => {
    // A dedicated database keeps the admin count at exactly two, which is the
    // state the race needs. Repeat because this is a regression test: a single
    // pass can be lucky.
    const raceDb = createTestDb()
    const first = raceDb.createUser("race-admin-a")
    const second = raceDb.createUser("race-admin-b")
    try {
      for (let round = 0; round < 10; round += 1) {
        await setUserRole(first, "admin", { db: raceDb.db, now: 10 + round })
        await setUserRole(second, "admin", { db: raceDb.db, now: 10 + round })
        expect(
          await Promise.all([
            getUserRole({ id: first }, { db: raceDb.db }),
            getUserRole({ id: second }, { db: raceDb.db }),
          ])
        ).toEqual(["admin", "admin"])

        const results = await Promise.all([
          adminSetRoleForUser(
            raceDb.db,
            { id: first },
            { userId: second, role: "reviewer" }
          ),
          adminSetRoleForUser(
            raceDb.db,
            { id: second },
            { userId: first, role: "reviewer" }
          ),
        ])

        const rejected = results.filter((result) => !result.ok)
        expect(results.filter((result) => result.ok)).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect(rejected[0]).toMatchObject({ code: "forbidden" })

        const roles = await Promise.all(
          [first, second].map((id) => getUserRole({ id }, { db: raceDb.db }))
        )
        expect(roles.filter((role) => role === "admin")).toHaveLength(1)
      }
    } finally {
      raceDb.close()
    }
  })

  it("does not let a just-demoted admin re-promote themselves", async () => {
    // A dedicated database gives the race a stable two-admin starting state.
    const raceDb = createTestDb()
    const actor = raceDb.createUser("stale-admin")
    const target = raceDb.createUser("demoted-admin")
    try {
      for (let round = 0; round < 10; round += 1) {
        await setUserRole(actor, "admin", { db: raceDb.db, now: 20 + round })
        await setUserRole(target, "admin", { db: raceDb.db, now: 20 + round })

        // `target` was an admin when its request passed `requireAdmin`; the
        // demotion may commit while that request is still in flight.
        const results = await Promise.all([
          adminSetRoleForUser(
            raceDb.db,
            { id: actor },
            { userId: target, role: "reviewer" }
          ),
          adminSetRoleForUser(
            raceDb.db,
            { id: target },
            { userId: target, role: "admin" }
          ),
        ])

        const rejected = results.filter((result) => !result.ok)
        expect(results.filter((result) => result.ok)).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect(rejected[0]).toMatchObject({ code: "forbidden" })

        expect(await getUserRole({ id: target }, { db: raceDb.db })).toBe(
          "reviewer"
        )
        expect(await getUserRole({ id: actor }, { db: raceDb.db })).toBe(
          "admin"
        )
      }
    } finally {
      raceDb.close()
    }
  })

  it("does not let a just-demoted admin promote an accomplice", async () => {
    const raceDb = createTestDb()
    const actor = raceDb.createUser("stale-admin")
    const target = raceDb.createUser("demoted-admin")
    const accomplice = raceDb.createUser("accomplice")
    try {
      for (let round = 0; round < 10; round += 1) {
        await setUserRole(actor, "admin", { db: raceDb.db, now: 40 + round })
        await setUserRole(target, "admin", { db: raceDb.db, now: 40 + round })
        await setUserRole(accomplice, "reviewer", {
          db: raceDb.db,
          now: 40 + round,
        })

        const results = await Promise.all([
          adminSetRoleForUser(
            raceDb.db,
            { id: actor },
            { userId: target, role: "reviewer" }
          ),
          adminSetRoleForUser(
            raceDb.db,
            { id: target },
            { userId: accomplice, role: "admin" }
          ),
        ])

        expect(results[0]).toMatchObject({ ok: true })
        expect(results[1]).toMatchObject({ ok: false, code: "forbidden" })
        expect(await getUserRole({ id: target }, { db: raceDb.db })).toBe(
          "reviewer"
        )
        expect(await getUserRole({ id: accomplice }, { db: raceDb.db })).toBe(
          "reviewer"
        )
      }
    } finally {
      raceDb.close()
    }
  })

  it("still promotes when the acting admin is still an admin", async () => {
    const raceDb = createTestDb()
    const actor = raceDb.createUser("current-admin")
    const otherAdmin = raceDb.createUser("other-admin")
    const promoted = raceDb.createUser("promoted")
    try {
      await setUserRole(actor, "admin", { db: raceDb.db, now: 60 })
      await setUserRole(otherAdmin, "admin", { db: raceDb.db, now: 60 })

      await expect(
        adminSetRoleForUser(
          raceDb.db,
          { id: actor },
          { userId: promoted, role: "admin" }
        )
      ).resolves.toEqual({
        ok: true,
        data: { userId: promoted, role: "admin" },
      })
      await expect(
        getUserRole({ id: promoted }, { db: raceDb.db })
      ).resolves.toBe("admin")
    } finally {
      raceDb.close()
    }
  })
})
