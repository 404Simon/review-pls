import { randomUUID } from "node:crypto"
import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import type { AppDatabase } from "@/db"
import * as authSchema from "@/db/auth-schema"
import { user } from "@/db/auth-schema"
import * as reviewSchema from "@/db/review-schema"
import { buildReviewData } from "@/lib/review/build"
import type { LoadedPaper } from "@/lib/review/load"
import type {
  Finding,
  ItemKind,
  PaperInput,
  ReviewItem,
} from "@/lib/review/types"

const schema = { ...authSchema, ...reviewSchema }

export interface TestDb {
  db: AppDatabase
  createUser: (id?: string, email?: string) => string
  close: () => void
}

/**
 * In-memory SQLite with every committed migration applied. Foreign keys are
 * enabled so cascade behaviour matches the deployed database.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:")
  sqlite.pragma("foreign_keys = ON")
  const testDb = drizzle(sqlite, { schema })
  const db: AppDatabase = testDb
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") })

  const createUser = (id: string = randomUUID(), email?: string): string => {
    const now = new Date()
    db.insert(user)
      .values({
        id,
        name: id,
        email: email ?? `${id}@example.org`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return id
  }

  return { db, createUser, close: () => sqlite.close() }
}

function finding(
  id: string,
  title: string,
  severity: "high" | "medium" | "low"
): Finding {
  return {
    id,
    id_local: id,
    title,
    severity,
    file: "src/example.py",
    status: "finding",
    verdict: "keep",
    quote: `quote for ${id}`,
    claim: `claim for ${id}`,
  }
}

export const FIXTURE_BATCH_ID = "test-batch"
export const FIXTURE_MANIFEST_SHA256 = "a".repeat(64)

function fixturePaperInput(paperId: string): PaperInput {
  const agentFindings: Finding[] = [
    finding("a1", "Agent high issue", "high"),
    finding("a2", "Agent medium issue", "medium"),
    finding("a3", "Agent low issue", "low"),
    finding("a4", "Agent related issue", "low"),
  ]
  const auditowlFindings: Finding[] = [
    finding("o1", "AuditOwl high issue", "high"),
    finding("o2", "AuditOwl low issue", "low"),
  ]

  return {
    manifest: {
      id: paperId,
      title: `Fixture paper ${paperId}`,
      category: "empirical",
      auditowlStatus: "audited",
      comparisonEligible: true,
      scopeNote: null,
      dir: `papers/${paperId}`,
      files: {
        overlap: "overlap.json",
        agentFindings: "findings.agent.json",
        auditowlFindings: "findings.auditowl.json",
        paper: "paper.json",
        paperText: "paper_text.txt",
        paperPdf: "paper.pdf",
        agentRun: "run",
        auditowlDir: "auditowl",
      },
      code: [],
      sha256: {
        overlap: "0".repeat(64),
        agentFindings: "0".repeat(64),
        auditowlFindings: "0".repeat(64),
      },
      counts: {
        clusters: 1,
        agentOnly: 3,
        auditowlOnly: 1,
        related: 1,
        bySeverity: { high: 1, medium: 1, low: 4 },
      },
    },
    overlap: {
      paper: {
        id: paperId,
        title: `Fixture paper ${paperId}`,
        category: "empirical",
        auditowl_status: "audited",
        comparison_eligible: true,
        scope_note: null,
      },
      matches: [
        {
          match_id: "M01",
          relation: "same",
          coverage: "equivalent",
          strength: "exact",
          auditowl: ["o1"],
          agent: ["a1"],
          shared_defect: "Shared defect",
          severity: { auditowl: ["high"], agent: ["high"] },
          status: { auditowl: ["finding"], agent: ["finding"] },
        },
      ],
      auditowl_only: [
        {
          id: "o2",
          title: "AuditOwl low issue",
          category: "empirical",
          severity: "low",
          status: "finding",
        },
      ],
      agent_only: [
        {
          id: "a2",
          title: "Agent medium issue",
          category: "empirical",
          severity: "medium",
          status: "finding",
        },
        {
          id: "a3",
          title: "Agent low issue",
          category: "empirical",
          severity: "low",
          status: "finding",
        },
        {
          id: "a4",
          title: "Agent related issue",
          category: "empirical",
          severity: "low",
          status: "finding",
        },
      ],
      related_not_matched: [
        {
          auditowl: ["o2"],
          agent: ["a4"],
          reason: "Possible duplicate",
        },
      ],
    },
    agentFindings,
    auditowlFindings,
  }
}

export function createFixturePaperInputs(
  paperIds: readonly string[] = ["p1"]
): PaperInput[] {
  return paperIds.map((paperId) => fixturePaperInput(paperId))
}

/**
 * Raw sources for the archival export tests. They mirror what `loadItems`
 * returns, including the overlap and both raw findings arrays.
 */
export function createFixtureSources(
  paperIds: readonly string[] = ["p1"]
): LoadedPaper[] {
  return createFixturePaperInputs(paperIds).map((input) => ({
    manifest: input.manifest,
    dir: `/tmp/review-data/test-batch/${input.manifest.dir}`,
    overlap: input.overlap,
    agentFindings: [...input.agentFindings],
    auditowlFindings: [...input.auditowlFindings],
    paper: { title: input.manifest.title },
  }))
}

/**
 * Small fixture built through the real Phase 1 domain builder: one cluster,
 * three agent-only findings, one AuditOwl-only finding and one related pair.
 * Pass extra paper ids to build the same shape for several papers.
 */
export function createFixtureItems(
  paperIds: readonly string[] = ["p1"]
): ReviewItem[] {
  return buildReviewData({
    papers: createFixturePaperInputs(paperIds),
  }).items
}

export function getFixtureItem(
  items: readonly ReviewItem[],
  kind: ItemKind,
  ref: string,
  paperId?: string
): ReviewItem {
  const item = items.find(
    (candidate) =>
      candidate.kind === kind &&
      candidate.ref === ref &&
      (paperId === undefined || candidate.paperId === paperId)
  )
  if (!item) {
    throw new Error(`Missing fixture item ${kind}:${ref}`)
  }
  return item
}
