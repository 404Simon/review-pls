import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { describe, expect, it } from "vitest"

import type { AppDatabase } from "@/db"
import * as authSchema from "@/db/auth-schema"
import { user } from "@/db/auth-schema"
import * as reviewSchema from "@/db/review-schema"
import { reviewDecision, reviewDecisionEvent } from "@/db/review-schema"
import {
  decisionsExportSchema,
  exportFileName,
  reviewDatasetExportSchema,
} from "@/lib/review/export"

const ROOT = path.join(process.cwd(), "e2e", "fixtures", "review-data")
const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx")
const SCRIPT = path.join(process.cwd(), "scripts", "export-reviews.ts")
const NOW = 1_800_000_000_000

const schema = { ...authSchema, ...reviewSchema }

function prepareDatabase(databasePath: string): void {
  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  const db: AppDatabase = drizzle(sqlite, { schema })
  migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  })
  db.insert(user)
    .values({
      id: "u1",
      name: "Export Tester",
      email: "export@example.org",
      emailVerified: false,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run()
  db.insert(reviewDecision)
    .values({
      id: "decision-closed",
      batchId: "review-fixture",
      paperId: "1001",
      itemKind: "cluster",
      itemRef: "M01",
      userId: "u1",
      status: "closed",
      payload: JSON.stringify({
        verdict: "same_defect",
        note: "Closed fixture decision",
      }),
      itemHash: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run()
  db.insert(reviewDecision)
    .values({
      id: "decision-draft",
      batchId: "review-fixture",
      paperId: "1001",
      itemKind: "agent_only",
      itemRef: "a2",
      userId: "u1",
      status: "draft",
      payload: JSON.stringify({
        verdict: "confirmed_valid",
        note: "Draft must not appear",
      }),
      itemHash: "c".repeat(64),
      manifestSha256: "b".repeat(64),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run()
  db.insert(reviewDecisionEvent)
    .values({
      id: "event-unsure",
      batchId: "review-fixture",
      paperId: "1001",
      itemKind: "auditowl_only",
      itemRef: "o2",
      userId: "u1",
      status: "unsure",
      payload: JSON.stringify({
        verdict: "unsure",
        note: "Durable unsure note",
      }),
      itemHash: "d".repeat(64),
      manifestSha256: "b".repeat(64),
      createdAt: NOW,
    })
    .run()
  sqlite.close()
}

function runCli(args: readonly string[], databasePath?: string) {
  return spawnSync(TSX, [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...(databasePath ? { DATABASE_URL: databasePath } : {}),
      REVIEW_DATA_ROOT: ROOT,
    },
  })
}

describe("review:export CLI", () => {
  it("writes both schema-valid exports against a temporary database", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    const databasePath = path.join(directory, "export.db")
    const out = path.join(directory, "exports")
    try {
      prepareDatabase(databasePath)
      const result = runCli(
        [
          "--batch",
          "review-fixture",
          "--type",
          "both",
          "--root",
          ROOT,
          "--database",
          databasePath,
          "--out",
          out,
        ],
        databasePath
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain("dataset:")
      expect(result.stdout).toContain("decisions:")

      const batchDirectory = path.join(out, "review-fixture")
      const files = readdirSync(batchDirectory).sort()
      expect(files).toHaveLength(2)
      const datasetFile = files.find((file) =>
        file.startsWith("review-dataset-")
      )
      const decisionsFile = files.find((file) => file.startsWith("decisions-"))
      expect(datasetFile).toBeDefined()
      expect(decisionsFile).toBeDefined()

      const dataset = reviewDatasetExportSchema.safeParse(
        JSON.parse(
          readFileSync(path.join(batchDirectory, datasetFile ?? ""), "utf8")
        )
      )
      expect(dataset.success).toBe(true)
      if (!dataset.success) {
        return
      }
      expect(dataset.data.decisions.map((row) => row.status).sort()).toEqual([
        "closed",
        "draft",
      ])
      expect(dataset.data.decisionEvents).toHaveLength(1)
      expect(dataset.data.decisionEvents[0]?.status).toBe("unsure")
      const paper = dataset.data.papers.find((row) => row.id === "1001")
      expect(paper?.overlap.paper.id).toBe("1001")
      expect(paper?.findings.auditowl.map((finding) => finding.id)).toEqual([
        "o1",
        "o2",
        "o3",
      ])
      expect(paper?.findings.agent).toHaveLength(5)
      expect(
        paper?.items.find((row) => row.kind === "cluster")?.comparator.relation
      ).toBe("same")
      expect(
        paper?.items.find((row) => row.kind === "cluster")?.findings.agent[0]
          ?.claim
      ).toContain("augmentation")

      const decisions = decisionsExportSchema.safeParse(
        JSON.parse(
          readFileSync(path.join(batchDirectory, decisionsFile ?? ""), "utf8")
        )
      )
      expect(decisions.success).toBe(true)
      if (!decisions.success) {
        return
      }
      expect(decisions.data.decisions).toHaveLength(1)
      expect(decisions.data.decisions[0]?.itemRef).toBe("M01")
      expect(decisions.data.decisions[0]?.reviewer).toEqual({
        id: "u1",
        name: "Export Tester",
      })
      expect(decisions.data.unsure[0]?.note).toBe("Durable unsure note")
      expect(
        decisions.data.decisions.some((row) => row.itemKind === "agent_only")
      ).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("exits non-zero for an unknown batch and rejects an invalid type", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    const databasePath = path.join(directory, "export.db")
    try {
      prepareDatabase(databasePath)
      const missing = runCli(
        [
          "--batch",
          "missing-batch",
          "--database",
          databasePath,
          "--out",
          directory,
        ],
        databasePath
      )
      expect(missing.status).not.toBe(0)
      expect(missing.stderr).toContain("review:export:")

      const invalid = runCli(
        [
          "--batch",
          "review-fixture",
          "--type",
          "nope",
          "--database",
          databasePath,
        ],
        databasePath
      )
      expect(invalid.status).not.toBe(0)
      expect(invalid.stderr).toContain("Unknown export type")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("writes only the requested export type", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    const databasePath = path.join(directory, "export.db")
    try {
      prepareDatabase(databasePath)
      for (const type of ["dataset", "decisions"] as const) {
        const out = path.join(directory, `out-${type}`)
        const result = runCli([
          "--batch",
          "review-fixture",
          "--type",
          type,
          "--root",
          ROOT,
          "--database",
          databasePath,
          "--out",
          out,
          "--now",
          String(NOW),
        ])
        expect(result.status, result.stderr).toBe(0)
        const files = readdirSync(path.join(out, "review-fixture"))
        expect(files).toEqual([exportFileName(type, NOW)])
        expect(result.stdout).toContain(`${type}:`)
        expect(result.stdout).not.toContain(
          `${type === "dataset" ? "decisions" : "dataset"}:`
        )
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("does not create a missing database or leave a partial both export", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    try {
      const missingDatabase = path.join(directory, "missing.db")
      const missingOut = path.join(directory, "missing-out")
      const missing = runCli(
        [
          "--batch",
          "review-fixture",
          "--type",
          "dataset",
          "--root",
          ROOT,
          "--database",
          missingDatabase,
          "--out",
          missingOut,
        ],
        missingDatabase
      )
      expect(missing.status).not.toBe(0)
      expect(missing.stderr).toMatch(/does not exist/i)
      expect(existsSync(missingDatabase)).toBe(false)
      expect(existsSync(missingOut)).toBe(false)

      const databasePath = path.join(directory, "export.db")
      prepareDatabase(databasePath)
      const out = path.join(directory, "out-both")
      const batchDirectory = path.join(out, "review-fixture")
      mkdirSync(batchDirectory, { recursive: true })
      // Force the second install to fail after the dataset was already renamed
      // into place. The CLI must remove that dataset again.
      const decisionsTarget = path.join(
        batchDirectory,
        exportFileName("decisions", NOW)
      )
      mkdirSync(decisionsTarget)

      const partial = runCli([
        "--batch",
        "review-fixture",
        "--type",
        "both",
        "--root",
        ROOT,
        "--database",
        databasePath,
        "--out",
        out,
        "--now",
        String(NOW),
      ])
      expect(partial.status).not.toBe(0)
      expect(partial.stderr).toContain("review:export:")
      const entries = readdirSync(batchDirectory).sort()
      expect(entries).toEqual([path.basename(decisionsTarget)])
      expect(entries.some((entry) => entry.startsWith("review-dataset-"))).toBe(
        false
      )
      expect(entries.some((entry) => entry.includes(".tmp-"))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("refuses to overwrite an existing export without --force", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    const databasePath = path.join(directory, "export.db")
    const out = path.join(directory, "out-both")
    try {
      prepareDatabase(databasePath)
      const batchDirectory = path.join(out, "review-fixture")
      mkdirSync(batchDirectory, { recursive: true })
      const datasetPath = path.join(
        batchDirectory,
        exportFileName("dataset", NOW)
      )
      const previous = '{"previous":"valid export"}\n'
      writeFileSync(datasetPath, previous, "utf8")

      const result = runCli([
        "--batch",
        "review-fixture",
        "--type",
        "both",
        "--root",
        ROOT,
        "--database",
        databasePath,
        "--out",
        out,
        "--now",
        String(NOW),
      ])

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("Refusing to overwrite")
      expect(result.stderr).toContain("--force")
      expect(readFileSync(datasetPath, "utf8")).toBe(previous)
      expect(readdirSync(batchDirectory)).toEqual([
        exportFileName("dataset", NOW),
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("replaces existing exports only after both payloads are staged", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    const databasePath = path.join(directory, "export.db")
    const out = path.join(directory, "out-both")
    try {
      prepareDatabase(databasePath)
      const batchDirectory = path.join(out, "review-fixture")
      mkdirSync(batchDirectory, { recursive: true })
      const datasetPath = path.join(
        batchDirectory,
        exportFileName("dataset", NOW)
      )
      const decisionsPath = path.join(
        batchDirectory,
        exportFileName("decisions", NOW)
      )
      writeFileSync(datasetPath, '{"previous":"dataset"}\n', "utf8")
      writeFileSync(decisionsPath, '{"previous":"decisions"}\n', "utf8")

      // A non-file target is rejected before any pre-existing export is
      // touched, even with --force.
      rmSync(decisionsPath, { force: true })
      mkdirSync(decisionsPath)
      const refused = runCli([
        "--batch",
        "review-fixture",
        "--type",
        "both",
        "--root",
        ROOT,
        "--database",
        databasePath,
        "--out",
        out,
        "--now",
        String(NOW),
        "--force",
      ])
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toMatch(/not a regular file/i)
      expect(readFileSync(datasetPath, "utf8")).toBe('{"previous":"dataset"}\n')

      rmSync(decisionsPath, { recursive: true, force: true })
      const replaced = runCli([
        "--batch",
        "review-fixture",
        "--type",
        "both",
        "--root",
        ROOT,
        "--database",
        databasePath,
        "--out",
        out,
        "--now",
        String(NOW),
        "--force",
      ])
      expect(replaced.status, replaced.stderr).toBe(0)
      expect(readdirSync(batchDirectory).sort()).toEqual(
        [
          exportFileName("dataset", NOW),
          exportFileName("decisions", NOW),
        ].sort()
      )
      expect(readFileSync(datasetPath, "utf8")).not.toBe(
        '{"previous":"dataset"}\n'
      )
      expect(readFileSync(decisionsPath, "utf8")).not.toBe(
        '{"previous":"decisions"}\n'
      )
      const dataset = reviewDatasetExportSchema.safeParse(
        JSON.parse(readFileSync(datasetPath, "utf8"))
      )
      expect(dataset.success).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("migrates an existing but unmigrated database before exporting", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "review-export-"))
    const databasePath = path.join(directory, "unmigrated.db")
    const out = path.join(directory, "exports")
    try {
      // Create an empty SQLite file without applying any migration.
      new Database(databasePath).close()

      const result = runCli([
        "--batch",
        "review-fixture",
        "--type",
        "dataset",
        "--root",
        ROOT,
        "--database",
        databasePath,
        "--out",
        out,
        "--now",
        String(NOW),
      ])
      expect(result.status, result.stderr).toBe(0)
      const files = readdirSync(path.join(out, "review-fixture"))
      expect(files).toEqual([exportFileName("dataset", NOW)])
      const dataset = reviewDatasetExportSchema.safeParse(
        JSON.parse(
          readFileSync(path.join(out, "review-fixture", files[0] ?? ""), "utf8")
        )
      )
      expect(dataset.success).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
