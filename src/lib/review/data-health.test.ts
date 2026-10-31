import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  anchorsFromLoadedItems,
  clearDataHealthCache,
  HEALTH_CACHE_TTL_MS,
  inspectBatchHealth,
  inspectEvidenceAnchors,
  summarizeDecisionHealth,
} from "@/lib/review/data-health"
import type { DecisionRecord } from "@/lib/review/types"
import {
  createFixtureItems,
  FIXTURE_BATCH_ID,
  FIXTURE_MANIFEST_SHA256,
  getFixtureItem,
} from "@/lib/review/test-support"

const T0 = 1_800_000_000_000
const items = createFixtureItems()
const cluster = getFixtureItem(items, "cluster", "M01")
const agent = getFixtureItem(items, "agent_only", "a2")

function decision(
  item = cluster,
  status: DecisionRecord["status"] = "closed",
  itemHash = item.itemHash
): DecisionRecord {
  return {
    id: `${item.id}:${status}`,
    batchId: FIXTURE_BATCH_ID,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
    userId: "owner",
    status,
    payload: {},
    itemHash,
    manifestSha256: FIXTURE_MANIFEST_SHA256,
    createdAt: T0,
    updatedAt: T0,
  }
}

describe("summarizeDecisionHealth", () => {
  it("reports stale closed decisions and ignores current drafts", () => {
    const health = summarizeDecisionHealth(
      items,
      [
        decision(cluster, "closed", "b".repeat(64)),
        decision(agent, "draft", "c".repeat(64)),
      ],
      FIXTURE_MANIFEST_SHA256
    )
    expect(health.stale.map((row) => row.itemRef)).toEqual(["M01"])
    expect(health.orphaned).toEqual([])
  })

  it("reports decisions whose item no longer exists", () => {
    const orphan: DecisionRecord = {
      ...decision(agent),
      id: "orphan",
      itemRef: "gone",
    }
    const health = summarizeDecisionHealth(
      items,
      [orphan],
      FIXTURE_MANIFEST_SHA256
    )
    expect(health.stale).toEqual([])
    expect(health.orphaned).toEqual([orphan])
  })
})

describe("inspectBatchHealth", () => {
  it("resolves the committed fixture anchors and caches the result", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    clearDataHealthCache()
    const first = await inspectBatchHealth("review-fixture", { root })
    const second = await inspectBatchHealth("review-fixture", { root })

    expect(second).toBe(first)
    expect(first.loaded.counts.total).toBe(11)
    expect(first.evidence.total).toBeGreaterThan(0)
    expect(first.evidence.local).toBeGreaterThan(0)
    expect(first.evidence.missing).toBe(0)
    expect(first.evidence.quotes.exact).toBeGreaterThan(0)
    const anchors = anchorsFromLoadedItems(first.loaded)
    expect(anchors).toHaveLength(first.loaded.papers.length)
    expect(anchors.every((paper) => paper.anchors.length > 0)).toBe(true)
    const anchorIds = anchors.flatMap((paper) =>
      paper.anchors.map(
        (anchor) => `${paper.manifest.id}:${anchor.side}:${anchor.id}`
      )
    )
    // 1001: 5 agent + 3 AuditOwl, 1002: 2 agent + 2 AuditOwl. The related pair
    // reuses findings, so the deduped total is the exact kept-source count.
    expect(anchorIds).toHaveLength(12)
    expect(new Set(anchorIds).size).toBe(12)
    expect(anchorIds).toHaveLength(first.evidence.total)
    clearDataHealthCache()
  })

  it("serves the cached inspection for five minutes and refreshes after it", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    const t0 = 1_800_000_000_000
    clearDataHealthCache()
    const first = await inspectBatchHealth("review-fixture", {
      root,
      now: t0,
    })
    const cached = await inspectBatchHealth("review-fixture", {
      root,
      now: t0 + HEALTH_CACHE_TTL_MS - 1,
    })
    expect(cached).toBe(first)

    const refreshed = await inspectBatchHealth("review-fixture", {
      root,
      now: t0 + HEALTH_CACHE_TTL_MS,
    })
    expect(refreshed).not.toBe(first)
    expect(refreshed.inspectedAt).toBe(t0 + HEALTH_CACHE_TTL_MS)
    clearDataHealthCache()
  })

  it("clears the cached inspection immediately when the admin reloads", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    const t0 = 1_800_000_000_000
    clearDataHealthCache()
    const first = await inspectBatchHealth("review-fixture", {
      root,
      now: t0,
    })
    expect(
      await inspectBatchHealth("review-fixture", { root, now: t0 + 1 })
    ).toBe(first)

    clearDataHealthCache()
    const reloaded = await inspectBatchHealth("review-fixture", {
      root,
      now: t0 + 1,
    })
    expect(reloaded).not.toBe(first)
    expect(reloaded.inspectedAt).toBe(t0 + 1)
    clearDataHealthCache()
  })

  it("resolves each kept finding once even when a related pair reuses it", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    const inspection = await inspectBatchHealth("review-fixture", { root })
    const anchors = anchorsFromLoadedItems(inspection.loaded)
    const ids = anchors.flatMap((paper) =>
      paper.anchors.map(
        (anchor) => `${paper.manifest.id}:${anchor.side}:${anchor.id}`
      )
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(inspection.evidence.total)
  })
})

describe("inspectEvidenceAnchors", () => {
  it("aggregates URL and missing anchors separately", async () => {
    const root = path.join(process.cwd(), "e2e", "fixtures", "review-data")
    const health = await inspectEvidenceAnchors(
      path.join(root, "review-fixture"),
      [
        {
          manifest: {
            id: "x",
            title: "x",
            category: "empirical",
            auditowlStatus: "audited",
            comparisonEligible: true,
            scopeNote: null,
            dir: "papers/x",
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
              clusters: 0,
              agentOnly: 0,
              auditowlOnly: 0,
              related: 0,
              bySeverity: { high: 0, medium: 0, low: 0 },
            },
          },
          dir: path.join(root, "review-fixture", "papers", "1001"),
          anchors: [
            {
              paperId: "x",
              side: "agent",
              id: "url",
              file: "https://example.org/issue",
              quote: null,
              lineStart: null,
              lineEnd: null,
            },
            {
              paperId: "x",
              side: "agent",
              id: "missing",
              file: "does/not/exist.py",
              quote: "nothing",
              lineStart: 1,
              lineEnd: 1,
            },
          ],
        },
      ]
    )
    expect(health.total).toBe(2)
    expect(health.url).toBe(1)
    expect(health.missing).toBe(1)
    expect(health.urlAnchors.map((anchor) => anchor.id)).toEqual(["url"])
    expect(health.missingAnchors.map((anchor) => anchor.id)).toEqual([
      "missing",
    ])
  })
})
