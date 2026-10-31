import { describe, expect, it } from "vitest"

import {
  buildDecisionsExport,
  buildReviewDataset,
  decisionsExportSchema,
  exportFileName,
  reviewDatasetExportSchema,
  type ExportInput,
} from "@/lib/review/export"
import type { LoadedBatch, LoadedItems } from "@/lib/review/load"
import type {
  Claim,
  DecisionEventRecord,
  DecisionRecord,
  PaperManifest,
  PaperReview,
  ReviewCounts,
} from "@/lib/review/types"
import {
  createFixtureItems,
  createFixtureSources,
  FIXTURE_BATCH_ID,
  getFixtureItem,
} from "@/lib/review/test-support"

const T0 = 1_800_000_000_000
const MANIFEST_SHA = "b".repeat(64)

const manifest: PaperManifest = {
  id: "p1",
  title: "Fixture paper p1",
  category: "empirical",
  auditowlStatus: "audited",
  comparisonEligible: true,
  scopeNote: null,
  dir: "papers/p1",
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
  code: [
    {
      name: "repo",
      dir: "code/repo",
      role: "repository",
      commit: "abc123",
    },
  ],
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
}

const counts: ReviewCounts = {
  total: 6,
  clusters: 1,
  agentOnly: 3,
  auditowlOnly: 1,
  related: 1,
  bySeverity: { high: 1, medium: 1, low: 4 },
  byKind: {
    cluster: { high: 1, medium: 0, low: 0, total: 1 },
    agent_only: { high: 0, medium: 1, low: 2, total: 3 },
    auditowl_only: { high: 0, medium: 0, low: 1, total: 1 },
    related: { high: 0, medium: 0, low: 1, total: 1 },
  },
}

const batch: LoadedBatch = {
  root: "/tmp/review-data",
  dir: "/tmp/review-data/test-batch",
  manifest: {
    schemaVersion: 1,
    batchId: FIXTURE_BATCH_ID,
    label: "Fixture batch",
    generatedAt: "2026-10-30T12:00:00.000Z",
    contentSha256: "a".repeat(64),
    protocol: { name: "fixture", version: "1", path: "docs/fixture.md" },
    excluded: [{ paperId: "e1", reason: "no evidence" }],
    papers: [manifest],
  },
  manifestSha256: MANIFEST_SHA,
  papers: [manifest],
  excluded: [{ paperId: "e1", reason: "no evidence" }],
}

const items = createFixtureItems(["p1"])
const paperReview: PaperReview = {
  manifest,
  items,
  counts,
  issues: [],
}
const loaded: LoadedItems = {
  batch,
  papers: [paperReview],
  sources: createFixtureSources(["p1"]),
  items,
  counts,
  issues: [],
  excluded: batch.excluded,
}

function decision(
  kind: Parameters<typeof getFixtureItem>[1],
  ref: string,
  userId: string,
  status: DecisionRecord["status"],
  payload: unknown,
  updatedAt: number,
  itemHash = getFixtureItem(items, kind, ref).itemHash
): DecisionRecord {
  return {
    id: `${kind}:${ref}:${userId}:${status}`,
    batchId: FIXTURE_BATCH_ID,
    paperId: "p1",
    itemKind: kind,
    itemRef: ref,
    userId,
    status,
    payload,
    itemHash,
    manifestSha256: MANIFEST_SHA,
    createdAt: updatedAt - 10,
    updatedAt,
  }
}

function event(
  kind: Parameters<typeof getFixtureItem>[1],
  ref: string,
  userId: string,
  status: DecisionEventRecord["status"],
  payload: unknown,
  createdAt: number
): DecisionEventRecord {
  return {
    id: `event:${kind}:${ref}:${userId}:${status}`,
    batchId: FIXTURE_BATCH_ID,
    paperId: "p1",
    itemKind: kind,
    itemRef: ref,
    userId,
    status,
    payload,
    itemHash: getFixtureItem(items, kind, ref).itemHash,
    manifestSha256: MANIFEST_SHA,
    createdAt,
  }
}

const claim: Claim = {
  id: "claim-1",
  batchId: FIXTURE_BATCH_ID,
  paperId: "p1",
  itemKind: "agent_only",
  itemRef: "a3",
  userId: "u2",
  claimedAt: T0 - 1000,
  lastSeenAt: T0 - 500,
  expiresAt: T0 + 60_000,
}

const closed = decision(
  "cluster",
  "M01",
  "u1",
  "closed",
  { verdict: "same_defect", note: "same loop" },
  T0 + 10
)
const draft = decision(
  "agent_only",
  "a3",
  "u2",
  "draft",
  { verdict: "confirmed_valid", note: "draft only" },
  T0 + 20
)
const unsure = decision(
  "auditowl_only",
  "o2",
  "u1",
  "unsure",
  { verdict: "unsure", note: "needs a second look" },
  T0 + 30
)
const secondClosed = decision(
  "cluster",
  "M01",
  "u2",
  "closed",
  { verdict: "same_defect", note: "older close" },
  T0 + 5
)
const unsureEvent = event(
  "auditowl_only",
  "o2",
  "u1",
  "unsure",
  { verdict: "unsure", note: "needs a second look" },
  T0 + 30
)
const reopenedEvent = event(
  "cluster",
  "M01",
  "u2",
  "reopened",
  { verdict: "same_defect", note: "older close" },
  T0 + 40
)

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    loaded,
    decisions: [closed, draft, unsure, secondClosed],
    events: [unsureEvent, reopenedEvent],
    claims: [claim],
    reviewers: [
      { id: "u1", name: "Alice", email: "alice@example.org" },
      { id: "u2", name: "Bob", email: "bob@example.org" },
    ],
    exportedAt: T0 + 1000,
    ...overrides,
  }
}

describe("buildReviewDataset", () => {
  it("includes the batch, items, claims, drafts and event history", () => {
    const dataset = buildReviewDataset(input())
    expect(reviewDatasetExportSchema.safeParse(dataset).success).toBe(true)
    // JSON round-trip keeps the shape and values stable for the archival file.
    expect(
      reviewDatasetExportSchema.parse(JSON.parse(JSON.stringify(dataset)))
    ).toEqual(dataset)
    expect(dataset.batchId).toBe(FIXTURE_BATCH_ID)
    expect(dataset.source.manifestSha256).toBe(MANIFEST_SHA)
    expect(dataset.batch).toEqual(batch.manifest)
    expect(dataset.papers[0]?.items).toHaveLength(6)
    expect(dataset.papers[0]?.items[0]?.itemHash).toHaveLength(64)
    expect(dataset.papers[0]?.repositories[0]?.commit).toBe("abc123")

    // The archival file keeps the complete source: the raw overlap object,
    // both findings files and the built items with their comparator/findings.
    const paper = dataset.papers[0]
    expect(paper?.overlap.paper.id).toBe("p1")
    expect(paper?.overlap.matches[0]?.match_id).toBe("M01")
    expect(paper?.overlap.matches[0]?.shared_defect).toBe("Shared defect")
    expect(paper?.findings.auditowl.map((finding) => finding.id)).toEqual([
      "o1",
      "o2",
    ])
    expect(paper?.findings.agent.map((finding) => finding.id)).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
    ])
    const clusterItem = paper?.items.find((row) => row.kind === "cluster")
    expect(clusterItem?.comparator.relation).toBe("same")
    expect(clusterItem?.comparator.anchor).toBeNull()
    expect(clusterItem?.findings.auditowl[0]?.quote).toBe("quote for o1")
    expect(clusterItem?.findings.agent[0]?.claim).toBe("claim for a1")
    expect(paper?.items.every((row) => row.itemHash.length === 64)).toBe(true)

    // Excluded papers stay provenance in batch.json and never become items.
    expect(dataset.papers.map((row) => row.id)).toEqual(["p1"])
    expect(dataset.papers.some((row) => row.id === "e1")).toBe(false)

    expect(dataset.claims).toHaveLength(1)
    expect(dataset.decisions.map((row) => row.status)).toEqual([
      "closed",
      "closed",
      "draft",
      "unsure",
    ])
    expect(dataset.decisionEvents.map((row) => row.status)).toEqual([
      "reopened",
      "unsure",
    ])
    expect(dataset.decisions[0]?.reviewer).toEqual({
      id: "u1",
      name: "Alice",
      email: "alice@example.org",
    })
    expect(dataset.stats.batch.total).toBe(6)
    expect(dataset.stats.papers[0]?.paperId).toBe("p1")
    expect(dataset.stats.reviewers.map((row) => row.userId)).toEqual([
      "u1",
      "u2",
    ])
  })

  it("is deterministic regardless of input order", () => {
    const first = buildReviewDataset(input())
    const reversed = buildReviewDataset(
      input({
        decisions: [unsure, draft, secondClosed, closed].reverse(),
        events: [reopenedEvent, unsureEvent],
        claims: [claim],
      })
    )
    expect(reversed).toEqual(first)
  })

  it("marks a decision on a missing item as stale", () => {
    const orphan: DecisionRecord = {
      ...closed,
      id: "orphan-decision",
      itemKind: "agent_only",
      itemRef: "missing",
      itemHash: "c".repeat(64),
    }
    const dataset = buildReviewDataset(input({ decisions: [orphan] }))
    expect(dataset.decisions[0]?.stale).toBe(true)
  })
})

describe("buildDecisionsExport", () => {
  it("keeps only the latest closed decision per item and excludes drafts", () => {
    const compact = buildDecisionsExport(input())
    expect(decisionsExportSchema.safeParse(compact).success).toBe(true)
    expect(
      decisionsExportSchema.parse(JSON.parse(JSON.stringify(compact)))
    ).toEqual(compact)
    expect(compact.decisions).toHaveLength(1)
    const final = compact.decisions[0]
    expect(final?.paperId).toBe("p1")
    expect(final?.itemKind).toBe("cluster")
    expect(final?.itemRef).toBe("M01")
    expect(final?.decision).toEqual(closed.payload)
    expect(final?.reviewer).toEqual({ id: "u1", name: "Alice" })
    expect(final?.stale).toBe(false)
    expect(compact.decisions.some((row) => row.itemKind === "agent_only")).toBe(
      false
    )
  })

  it("includes the durable unsure history from events", () => {
    const compact = buildDecisionsExport(input())
    expect(compact.unsure).toEqual([
      {
        paperId: "p1",
        itemKind: "auditowl_only",
        itemRef: "o2",
        note: "needs a second look",
        reviewer: { id: "u1", name: "Alice" },
        at: new Date(T0 + 30).toISOString(),
      },
    ])
  })

  it("exports proposed links without duplicating finding payloads", () => {
    const linked = decision(
      "agent_only",
      "a2",
      "u2",
      "closed",
      {
        verdict: "confirmed_valid",
        note: "same defect",
        proposedLink: { kind: "auditowl_only", ref: "o2" },
      },
      T0 + 60
    )
    const compact = buildDecisionsExport(input({ decisions: [linked] }))
    expect(compact.decisions[0]?.proposedLink).toEqual({
      kind: "auditowl_only",
      ref: "o2",
    })
  })
})

describe("exportFileName", () => {
  it("uses a filesystem-safe UTC timestamp", () => {
    expect(exportFileName("dataset", T0)).toBe(
      "review-dataset-2027-01-15T08-00-00-000Z.json"
    )
    expect(exportFileName("decisions", T0)).toBe(
      "decisions-2027-01-15T08-00-00-000Z.json"
    )
  })
})
