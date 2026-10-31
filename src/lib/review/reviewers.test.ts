import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getReviewerNames } from "@/lib/review/reviewers"
import { createTestDb, type TestDb } from "@/lib/review/test-support"

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => {
  testDb.close()
})

describe("getReviewerNames", () => {
  it("returns display names and de-duplicates ids", () => {
    const alice = testDb.createUser("alice")
    const bob = testDb.createUser("bob")

    expect(getReviewerNames(testDb.db, [alice, alice, bob])).toEqual({
      [alice]: "alice",
      [bob]: "bob",
    })
  })

  it("ignores unknown ids and empty queries", () => {
    const alice = testDb.createUser("alice")
    expect(getReviewerNames(testDb.db, [alice, "missing"])).toEqual({
      [alice]: "alice",
    })
    expect(getReviewerNames(testDb.db, [])).toEqual({})
  })
})
