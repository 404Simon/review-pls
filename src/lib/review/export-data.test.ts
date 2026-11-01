import path from "node:path"

import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { user } from "@/db/auth-schema"
import { itemClaim } from "@/db/review-schema"
import {
  decisionsExportSchema,
  exportFileName,
  reviewDatasetExportSchema,
} from "@/lib/review/export"
import { buildExportDocument } from "@/lib/review/export-data"
import { createTestDb } from "@/lib/review/test-support"

const ROOT = path.join(process.cwd(), "e2e", "fixtures", "review-data")
const NOW = 1_800_000_000_000

describe("buildExportDocument", () => {
  it("produces schema-valid, newline-terminated payloads for both types", async () => {
    const testDb = createTestDb()
    try {
      const dataset = await buildExportDocument(
        testDb.db,
        "review-fixture",
        "dataset",
        { root: ROOT, now: NOW }
      )
      expect(dataset.fileName).toBe(exportFileName("dataset", NOW))
      expect(dataset.content.endsWith("\n")).toBe(true)
      expect(
        reviewDatasetExportSchema.safeParse(JSON.parse(dataset.content)).success
      ).toBe(true)

      const decisions = await buildExportDocument(
        testDb.db,
        "review-fixture",
        "decisions",
        { root: ROOT, now: NOW }
      )
      expect(decisions.fileName).toBe(exportFileName("decisions", NOW))
      expect(decisions.content.endsWith("\n")).toBe(true)
      expect(
        decisionsExportSchema.safeParse(JSON.parse(decisions.content)).success
      ).toBe(true)
    } finally {
      testDb.close()
    }
  })

  it("keeps expired claims in the dataset without changing the stats", async () => {
    const testDb = createTestDb()
    try {
      const userId = testDb.createUser("export-user", "export@example.org")
      testDb.db
        .update(user)
        .set({ title: "Dr.", association: "Chair of Software Engineering" })
        .where(eq(user.id, userId))
        .run()
      testDb.db
        .insert(itemClaim)
        .values({
          id: "claim-expired",
          batchId: "review-fixture",
          paperId: "1001",
          itemKind: "cluster",
          itemRef: "M01",
          userId,
          claimedAt: NOW - 10_000,
          lastSeenAt: NOW - 10_000,
          expiresAt: NOW - 1_000,
        })
        .run()

      const dataset = reviewDatasetExportSchema.parse(
        JSON.parse(
          (
            await buildExportDocument(testDb.db, "review-fixture", "dataset", {
              root: ROOT,
              now: NOW,
            })
          ).content
        )
      )
      const decisions = decisionsExportSchema.parse(
        JSON.parse(
          (
            await buildExportDocument(
              testDb.db,
              "review-fixture",
              "decisions",
              {
                root: ROOT,
                now: NOW,
              }
            )
          ).content
        )
      )

      expect(dataset.claims.map((claim) => claim.id)).toEqual(["claim-expired"])
      expect(dataset.claims[0]?.reviewer).toEqual({
        id: userId,
        name: "export-user",
        email: "export@example.org",
        title: "Dr.",
        association: "Chair of Software Engineering",
      })
      // Expired claims are filtered from stats by `now` on both paths.
      expect(dataset.stats).toEqual(decisions.stats)
    } finally {
      testDb.close()
    }
  })
})
