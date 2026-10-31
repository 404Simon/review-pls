import { describe, expect, it } from "vitest"

import { buildReviewData } from "@/lib/review/build"
import {
  findingSchema,
  overlapSchema,
  paperManifestSchema,
  type Finding,
  type Overlap,
  type PaperInput,
  type PaperManifest,
  type Severity,
} from "@/lib/review/types"

function finding(
  id: string,
  severity: Severity,
  quote = "print('hello')"
): Finding {
  return findingSchema.parse({
    id: `p1/${id}`,
    id_local: id,
    title: id,
    severity,
    status: "finding",
    file: `${id}.py`,
    quote,
    claim: `${id} claim`,
    concern: `${id} concern`,
    resolution: `${id} resolution`,
    line_start: 1,
    line_end: 1,
    verdict: "keep",
  } satisfies Partial<Finding>)
}

function manifest(): PaperManifest {
  return paperManifestSchema.parse({
    id: "p1",
    title: "Paper one",
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
  })
}

function onlyEntry(id: string, severity: Severity): unknown {
  return {
    id,
    title: id,
    category: "bug",
    severity,
    status: "finding",
    verdict: "keep",
    notes: `${id} note`,
    closest_auditowl: [],
    closest_agent: [],
  }
}

function match(
  id: string,
  auditowl: string[],
  agent: string[],
  auditowlSeverity: Severity[],
  agentSeverity: Severity[]
): unknown {
  return {
    match_id: id,
    relation: "one_to_one",
    coverage: "equivalent",
    strength: "exact",
    auditowl,
    agent,
    shared_defect: `shared ${id}`,
    anchor: `${id}.py:1`,
    severity: {
      auditowl: auditowlSeverity,
      agent: agentSeverity,
      agreement: "same",
    },
    status: {
      auditowl: auditowl.map(() => "finding"),
      agent: agent.map(() => "finding"),
      agreement: "same",
    },
    verification: { status: "confirmed", checked: ["x.py:1"] },
    agent_adds: null,
    auditowl_adds: null,
  }
}

function overlap(config: {
  matches?: unknown[]
  auditowlOnly?: unknown[]
  agentOnly?: unknown[]
  related?: unknown[]
}): Overlap {
  return overlapSchema.parse({
    paper: {
      id: "p1",
      title: "Paper one",
      category: "empirical",
      auditowl_status: "audited",
      comparison_eligible: true,
      scope_note: null,
    },
    matches: config.matches ?? [],
    auditowl_only: config.auditowlOnly ?? [],
    agent_only: config.agentOnly ?? [],
    related_not_matched: config.related ?? [],
  })
}

function input(
  agentFindings: Finding[],
  auditowlFindings: Finding[],
  overlapData: Overlap
): PaperInput {
  return {
    manifest: manifest(),
    overlap: overlapData,
    agentFindings,
    auditowlFindings,
  }
}

describe("buildReviewData", () => {
  const a1 = finding("a1", "high")
  const a2 = finding("a2", "medium")
  const a3 = finding("a3", "low")
  const a4 = finding("a4", "low")
  const o1 = finding("o1", "high")
  const o2 = finding("o2", "medium")
  const o3 = finding("o3", "low")

  const data = input(
    [a1, a2, a3, a4],
    [o1, o2, o3],
    overlap({
      matches: [match("M01", ["o1"], ["a1"], ["high"], ["high"])],
      auditowlOnly: [onlyEntry("o2", "medium"), onlyEntry("o3", "low")],
      agentOnly: [
        onlyEntry("a2", "medium"),
        onlyEntry("a3", "low"),
        onlyEntry("a4", "low"),
      ],
      related: [{ auditowl: ["o3"], agent: ["a4"], reason: "related" }],
    })
  )

  it("builds one item per cluster, only finding and related pair", () => {
    const result = buildReviewData({ papers: [data] })

    expect(result.issues).toEqual([])
    expect(result.items).toHaveLength(7)
    expect(result.counts).toMatchObject({
      total: 7,
      clusters: 1,
      agentOnly: 3,
      auditowlOnly: 2,
      related: 1,
      bySeverity: { high: 1, medium: 2, low: 4 },
    })
    expect(result.items.map((item) => item.ref)).toEqual([
      "M01",
      "a2",
      "o2",
      "a3",
      "a4",
      "o3",
      "o3--a4",
    ])
  })

  it("attaches both sides and comparator data", () => {
    const result = buildReviewData({ papers: [data] })
    const cluster = result.items[0]
    expect(cluster.kind).toBe("cluster")
    expect(cluster.findings.auditowl.map((finding) => finding.idLocal)).toEqual(
      ["o1"]
    )
    expect(cluster.findings.agent.map((finding) => finding.idLocal)).toEqual([
      "a1",
    ])
    expect(cluster.comparator.strength).toBe("exact")
    expect(cluster.comparator.verification?.status).toBe("confirmed")

    const related = result.items.find((item) => item.kind === "related")
    expect(related?.id).toBe("related:p1:o3--a4")
    expect(related?.findings.auditowl).toHaveLength(1)
    expect(related?.findings.agent).toHaveLength(1)
  })

  it("is deterministic and includes finding content in the item hash", () => {
    const first = buildReviewData({ papers: [data] })
    const second = buildReviewData({ papers: [data] })
    expect(first.items.map((item) => item.itemHash)).toEqual(
      second.items.map((item) => item.itemHash)
    )

    const changed = input(
      [finding("a1", "high", "print('changed')"), a2, a3, a4],
      [o1, o2, o3],
      data.overlap
    )
    const third = buildReviewData({ papers: [changed] })
    expect(third.items[0].itemHash).not.toBe(first.items[0].itemHash)
  })

  it("reports kept findings that are not placed exactly once", () => {
    const unplaced = finding("a9", "low")
    const result = buildReviewData({
      papers: [input([a1, a2, a3, a4, unplaced], [o1, o2, o3], data.overlap)],
    })
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unreferenced_finding",
          message: expect.stringContaining("a9"),
        }),
      ])
    )
  })

  it("reports duplicate and missing finding references", () => {
    const result = buildReviewData({
      papers: [
        input(
          [a1],
          [o1],
          overlap({
            matches: [match("M01", ["o1"], ["a1"], ["high"], ["high"])],
            agentOnly: [onlyEntry("a1", "high")],
            related: [{ auditowl: ["missing-o"], agent: ["a1"], reason: "x" }],
          })
        ),
      ],
    })
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_finding" }),
        expect.objectContaining({ code: "missing_finding" }),
        expect.objectContaining({ code: "related_not_in_only" }),
      ])
    )
  })

  it("handles related pairs with several ids on both sides", () => {
    const result = buildReviewData({
      papers: [
        input(
          [a1, a2],
          [o1, o2],
          overlap({
            auditowlOnly: [onlyEntry("o1", "high"), onlyEntry("o2", "medium")],
            agentOnly: [onlyEntry("a1", "medium"), onlyEntry("a2", "high")],
            related: [
              {
                auditowl: ["o1", "o2"],
                agent: ["a1", "a2"],
                reason: "multi",
              },
            ],
          })
        ),
      ],
    })
    expect(result.issues).toEqual([])
    const related = result.items.find((item) => item.kind === "related")
    expect(related?.ref).toBe("o1+o2--a1+a2")
    expect(related?.severity).toBe("high")
    expect(related?.findings.auditowl).toHaveLength(2)
    expect(related?.findings.agent).toHaveLength(2)
  })

  it("keeps the excluded list without requiring excluded papers", () => {
    const result = buildReviewData({
      papers: [data],
      excluded: [{ paperId: "3680", reason: "unavailable" }],
    })
    expect(result.excluded).toEqual([
      { paperId: "3680", reason: "unavailable" },
    ])
    expect(result.issues).toEqual([])
  })
})
