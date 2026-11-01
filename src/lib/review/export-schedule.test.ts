import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  runScheduledExports,
  scheduledExportFileName,
} from "@/lib/review/export-schedule"
import { createTestDb } from "@/lib/review/test-support"

const ROOT = path.join(process.cwd(), "e2e", "fixtures", "review-data")
const NOW = 1_800_000_000_000

describe("runScheduledExports", () => {
  it("writes both files for every valid batch and overwrites them", async () => {
    const out = await mkdtemp(path.join(os.tmpdir(), "review-export-schedule-"))
    const testDb = createTestDb()
    try {
      const first = await runScheduledExports({
        db: testDb.db,
        out,
        root: ROOT,
        now: NOW,
      })

      expect(first.exported.map((entry) => entry.batchId)).toEqual([
        "review-fixture",
        "review-fixture-b",
      ])
      // The deliberately broken fixture is reported, not fatal.
      expect(first.failed.map((entry) => entry.batchId)).toEqual([
        "broken-fixture",
      ])

      for (const entry of first.exported) {
        const files = await readdir(path.join(out, entry.batchId))
        expect(files.sort()).toEqual(
          [
            scheduledExportFileName("dataset"),
            scheduledExportFileName("decisions"),
          ].sort()
        )
      }

      const datasetPath = path.join(
        out,
        "review-fixture",
        scheduledExportFileName("dataset")
      )
      const decisionsPath = path.join(
        out,
        "review-fixture",
        scheduledExportFileName("decisions")
      )
      const firstDataset = JSON.parse(await readFile(datasetPath, "utf8"))
      expect(firstDataset.exportedAt).toBe(new Date(NOW).toISOString())

      const second = await runScheduledExports({
        db: testDb.db,
        out,
        root: ROOT,
        now: NOW + 60_000,
      })
      expect(second.failed.map((entry) => entry.batchId)).toEqual([
        "broken-fixture",
      ])

      const secondDataset = JSON.parse(await readFile(datasetPath, "utf8"))
      const secondDecisions = JSON.parse(await readFile(decisionsPath, "utf8"))
      expect(secondDataset.exportedAt).toBe(
        new Date(NOW + 60_000).toISOString()
      )
      expect(secondDecisions.exportedAt).toBe(
        new Date(NOW + 60_000).toISOString()
      )

      // Stable names mean the previous run's payloads are gone, and staging
      // files never survive a successful run.
      const remaining = await readdir(path.join(out, "review-fixture"))
      expect(remaining.filter((name) => name.includes(".tmp-"))).toEqual([])
    } finally {
      testDb.close()
      await rm(out, { recursive: true, force: true })
    }
  })
})
