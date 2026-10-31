import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { reviewerRole } from "@/db/review-schema"
import {
  AdminBootstrapError,
  AuthorizationError,
  bootstrapAdminRoles,
  getUserRole,
  parseAdminEmails,
  requireAdmin,
  requireReviewer,
  setUserRole,
} from "@/lib/review/roles"
import { createTestDb, type TestDb } from "@/lib/review/test-support"

let testDb: TestDb
let userId: string

beforeEach(() => {
  testDb = createTestDb()
  userId = testDb.createUser("u1", "Person@Example.org")
})

afterEach(() => {
  testDb.close()
  delete process.env.ADMIN_EMAILS
})

describe("parseAdminEmails", () => {
  it("splits, trims and lowercases the allowlist", () => {
    expect(parseAdminEmails(" Simon@Example.org, ops@example.org ,,")).toEqual(
      new Set(["simon@example.org", "ops@example.org"])
    )
  })

  it("returns an empty set for missing values", () => {
    expect(parseAdminEmails(undefined)).toEqual(new Set())
    expect(parseAdminEmails(null)).toEqual(new Set())
    expect(parseAdminEmails("   ")).toEqual(new Set())
  })
})

describe("getUserRole", () => {
  it("defaults to reviewer without a stored role", async () => {
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })

  it("respects stored roles", async () => {
    await setUserRole(userId, "admin", { db: testDb.db, now: 1 })
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "admin"
    )

    await setUserRole(userId, "reviewer", { db: testDb.db, now: 2 })
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })

  it("does not grant admin from an env match without a synced row", async () => {
    process.env.ADMIN_EMAILS = "person@example.org"
    await expect(
      getUserRole(
        { id: userId, email: "person@example.org" },
        { db: testDb.db }
      )
    ).resolves.toBe("reviewer")
  })
})

describe("bootstrapAdminRoles", () => {
  it("lists allowlisted candidates without promoting anyone", async () => {
    const result = await bootstrapAdminRoles(
      testDb.db,
      " PERSON@EXAMPLE.ORG , missing@example.org ",
      { now: 100 }
    )

    expect(result.candidates).toEqual([
      {
        userId,
        email: "Person@Example.org",
        emailVerified: false,
        createdAt: expect.any(Number),
        alreadyAdmin: false,
      },
    ])
    expect(result.promoted).toEqual([])
    expect(result.missing).toEqual(["missing@example.org"])
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
    expect(
      testDb.db
        .select()
        .from(reviewerRole)
        .where(eq(reviewerRole.userId, userId))
        .get()
    ).toBeUndefined()
  })

  it("promotes only the explicitly confirmed user id", async () => {
    const result = await bootstrapAdminRoles(testDb.db, "person@example.org", {
      confirmUserId: userId,
      now: 100,
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.promoted).toEqual([{ userId, email: "Person@Example.org" }])
    expect(result.missing).toEqual([])
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "admin"
    )

    const row = testDb.db
      .select()
      .from(reviewerRole)
      .where(eq(reviewerRole.userId, userId))
      .get()
    expect(row?.createdAt).toBe(100)
  })

  it("is idempotent for an already confirmed admin", async () => {
    await bootstrapAdminRoles(testDb.db, "person@example.org", {
      confirmUserId: userId,
      now: 1,
    })
    const second = await bootstrapAdminRoles(testDb.db, "person@example.org", {
      confirmUserId: userId,
      now: 2,
    })
    expect(second.promoted).toEqual([])
    expect(second.candidates[0]?.alreadyAdmin).toBe(true)
  })

  it("rejects an unknown user id", async () => {
    await expect(
      bootstrapAdminRoles(testDb.db, "person@example.org", {
        confirmUserId: "does-not-exist",
      })
    ).rejects.toMatchObject({ code: "unknown_user" })
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })

  it("rejects a confirmed user whose email is not allowlisted", async () => {
    const other = testDb.createUser("u2", "other@example.org")
    await expect(
      bootstrapAdminRoles(testDb.db, "person@example.org", {
        confirmUserId: other,
      })
    ).rejects.toBeInstanceOf(AdminBootstrapError)
    await expect(getUserRole({ id: other }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })

  it("does not report an existing admin as newly promoted", async () => {
    await setUserRole(userId, "admin", { db: testDb.db, now: 1 })
    const result = await bootstrapAdminRoles(testDb.db, "person@example.org", {
      confirmUserId: userId,
      now: 2,
    })
    expect(result.promoted).toEqual([])
    expect(result.missing).toEqual([])
  })

  it("rolls back the promotion when the write fails", async () => {
    testDb.db.run(
      `CREATE TRIGGER reject_admin_insert
       BEFORE INSERT ON reviewer_role
       WHEN NEW.user_id = '${userId}'
       BEGIN
         SELECT RAISE(ABORT, 'forced failure');
       END`
    )

    await expect(
      bootstrapAdminRoles(testDb.db, "person@example.org", {
        confirmUserId: userId,
      })
    ).rejects.toThrow(/forced failure/)

    expect(testDb.db.select().from(reviewerRole).all()).toEqual([])
  })

  it("treats null as no admins", async () => {
    const result = await bootstrapAdminRoles(testDb.db, null)
    expect(result).toEqual({ candidates: [], promoted: [], missing: [] })
    await expect(getUserRole({ id: userId }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })
})

describe("setUserRole", () => {
  it("upserts without resetting created_at", async () => {
    await setUserRole(userId, "admin", { db: testDb.db, now: 100 })
    await setUserRole(userId, "reviewer", { db: testDb.db, now: 200 })

    const row = testDb.db
      .select()
      .from(reviewerRole)
      .where(eq(reviewerRole.userId, userId))
      .get()
    expect(row).toEqual({
      userId,
      role: "reviewer",
      createdAt: 100,
    })
  })
})

describe("authorization helpers", () => {
  it("rejects anonymous callers", async () => {
    await expect(
      requireReviewer(null, { db: testDb.db })
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    })
  })

  it("lets any authenticated user review but not administer", async () => {
    await expect(
      requireReviewer({ id: userId }, { db: testDb.db })
    ).resolves.toMatchObject({ role: "reviewer" })

    await expect(
      requireAdmin({ id: userId }, { db: testDb.db })
    ).rejects.toBeInstanceOf(AuthorizationError)

    await bootstrapAdminRoles(testDb.db, "person@example.org", {
      confirmUserId: userId,
    })
    await expect(
      requireAdmin({ id: userId }, { db: testDb.db })
    ).resolves.toMatchObject({ role: "admin" })
  })
})
