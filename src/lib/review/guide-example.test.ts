import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  declaredPaperTotal,
  loadGuideExample,
  rankGuidePapers,
} from "@/lib/review/guide-example"
import type { PaperCounts, PaperManifest } from "@/lib/review/types"

type KindCounts = Pick<
  PaperCounts,
  "clusters" | "agentOnly" | "auditowlOnly" | "related"
>

function paper(
  id: string,
  counts: Partial<KindCounts> = {},
  options: { comparisonEligible?: boolean } = {}
): PaperManifest {
  return {
    id,
    title: `Paper ${id}`,
    category: "test",
    auditowlStatus: "audited",
    comparisonEligible: options.comparisonEligible ?? true,
    scopeNote: null,
    dir: `papers/${id}`,
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
        commit: null,
        url: null,
      },
    ],
    sha256: {
      overlap: "overlap-sha",
      agentFindings: "agent-sha",
      auditowlFindings: "auditowl-sha",
    },
    counts: {
      clusters: 0,
      agentOnly: 0,
      auditowlOnly: 0,
      related: 0,
      ...counts,
      bySeverity: { high: 0, medium: 0, low: 0 },
    },
  }
}

describe("declaredPaperTotal", () => {
  it("adds the four declared item kinds", () => {
    expect(
      declaredPaperTotal({
        clusters: 2,
        agentOnly: 3,
        auditowlOnly: 4,
        related: 5,
        bySeverity: { high: 1, medium: 1, low: 1 },
      })
    ).toBe(14)
  })

  it("does not invent a total from severity counts", () => {
    expect(
      declaredPaperTotal({
        clusters: 0,
        agentOnly: 0,
        auditowlOnly: 0,
        related: 0,
        bySeverity: { high: 9, medium: 9, low: 9 },
      })
    ).toBe(0)
  })
})

describe("rankGuidePapers", () => {
  it("drops papers without reviewable items", () => {
    const ranked = rankGuidePapers([
      paper("no-items", {}),
      paper("usable", { clusters: 1 }),
    ])
    expect(ranked.map((entry) => entry.id)).toEqual(["usable"])
  })

  it("prefers comparison-eligible papers, then the most items, then id", () => {
    const ranked = rankGuidePapers([
      paper("b-small", { clusters: 1 }),
      paper("a-large", { clusters: 2, agentOnly: 1 }),
      paper("c-ineligible", { clusters: 20 }, { comparisonEligible: false }),
      paper("d-large", { auditowlOnly: 3 }),
    ])
    expect(ranked.map((entry) => entry.id)).toEqual([
      "a-large",
      "d-large",
      "b-small",
      "c-ineligible",
    ])
  })

  it("does not reorder the input array", () => {
    const papers = [paper("b", { clusters: 1 }), paper("a", { clusters: 2 })]
    rankGuidePapers(papers)
    expect(papers.map((entry) => entry.id)).toEqual(["b", "a"])
  })
})

describe("loadGuideExample", () => {
  it("resolves a real paper and item from the fixture mount", async () => {
    const example = await loadGuideExample({
      root: path.resolve("e2e/fixtures/review-data"),
    })

    expect(example).not.toBeNull()
    expect(example?.paperHref).toBe("/batches/review-fixture/papers/1001")
    expect(example?.itemHref).toBe(
      "/batches/review-fixture/items/cluster:1001:M01"
    )
    expect(example?.paperTitle).toBe("Fixture Paper: Evidence Viewer")
    expect(example?.itemTitle).toBe(
      "Test statistics leak into augmentation search"
    )
  })

  it("returns null when the mount contains no batches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "review-data-empty-"))
    try {
      expect(await loadGuideExample({ root })).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
