import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { reviewerRole } from "@/db/review-schema"
import { runAdminRoleSync } from "./sync-admin-roles"
import { getUserRole } from "@/lib/review/roles"
import { createTestDb, type TestDb } from "@/lib/review/test-support"

let testDb: TestDb
let owner: string
const lines: string[] = []

function output() {
  return {
    log: (message: string) => lines.push(message),
    warn: (message: string) => lines.push(message),
    error: (message: string) => lines.push(message),
  }
}

function text(): string {
  return lines.join("\n")
}

function roleRows() {
  return testDb.db.select().from(reviewerRole).all()
}

beforeEach(() => {
  testDb = createTestDb()
  owner = testDb.createUser("owner", "Person@Example.org")
  lines.length = 0
})

afterEach(() => {
  testDb.close()
})

describe("review:admin:sync CLI", () => {
  it("prints help without touching the database", async () => {
    const exitCode = await runAdminRoleSync({
      argv: ["--help"],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(0)
    expect(text()).toContain("--user-id <id>")
    expect(roleRows()).toEqual([])
  })

  it("requires --user-id or --list and writes nothing without a confirmation", async () => {
    const exitCode = await runAdminRoleSync({
      argv: [],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(1)
    expect(text()).toContain("No change was made")
    expect(text()).toContain("Person@Example.org")
    expect(roleRows()).toEqual([])
    await expect(getUserRole({ id: owner }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })

  it("does not promote a pre-registered allowlisted account with --list", async () => {
    const exitCode = await runAdminRoleSync({
      argv: ["--list"],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(0)
    expect(text()).toContain("owner")
    expect(roleRows()).toEqual([])
    await expect(getUserRole({ id: owner }, { db: testDb.db })).resolves.toBe(
      "reviewer"
    )
  })

  it("promotes the explicitly confirmed user", async () => {
    const exitCode = await runAdminRoleSync({
      argv: ["--user-id", owner],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(0)
    expect(text()).toContain("Promoted 1 user")
    await expect(getUserRole({ id: owner }, { db: testDb.db })).resolves.toBe(
      "admin"
    )
  })

  it("rejects an unknown or non-allowlisted user id", async () => {
    const stranger = testDb.createUser("stranger", "stranger@example.org")

    const unknown = await runAdminRoleSync({
      argv: ["--user-id", "does-not-exist"],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(unknown).toBe(1)
    expect(text()).toContain("Unknown user id")

    lines.length = 0
    const notAllowlisted = await runAdminRoleSync({
      argv: ["--user-id", stranger],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(notAllowlisted).toBe(1)
    expect(text()).toContain("is not in ADMIN_EMAILS")
    expect(roleRows()).toEqual([])
  })

  it("exits non-zero when a configured email has no account", async () => {
    const exitCode = await runAdminRoleSync({
      argv: ["--user-id", owner],
      adminEmails: "person@example.org,missing@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(1)
    expect(text()).toContain("missing@example.org")
    expect(text()).toContain("without an account")
    // The confirmed candidate is still promoted; the misconfiguration is
    // reported instead of silently ignored.
    await expect(getUserRole({ id: owner }, { db: testDb.db })).resolves.toBe(
      "admin"
    )
  })

  it("exits non-zero for a missing configured email in --list mode", async () => {
    const exitCode = await runAdminRoleSync({
      argv: ["--list"],
      adminEmails: "person@example.org,missing@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(1)
    expect(text()).toContain("missing@example.org")
    expect(roleRows()).toEqual([])
  })

  it("rejects unknown arguments", async () => {
    const exitCode = await runAdminRoleSync({
      argv: ["--promote-everyone"],
      adminEmails: "person@example.org",
      db: testDb.db,
      output: output(),
    })
    expect(exitCode).toBe(1)
    expect(text()).toContain("Unknown argument")
    expect(
      testDb.db
        .select()
        .from(reviewerRole)
        .where(eq(reviewerRole.userId, owner))
        .get()
    ).toBeUndefined()
  })
})
