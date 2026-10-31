import { describe, expect, it } from "vitest"

import {
  compareReviewItems,
  itemId,
  parseItemId,
  parseItemIdParam,
  parseRelatedRef,
  relatedRef,
  severityMax,
} from "@/lib/review/ids"
import type { ReviewItem } from "@/lib/review/types"

function reviewItem(
  kind: ReviewItem["kind"],
  paperId: string,
  ref: string,
  severity: ReviewItem["severity"]
): ReviewItem {
  return {
    kind,
    paperId,
    ref,
    id: itemId(kind, paperId, ref),
    severity,
    title: ref,
    summary: null,
    auditowlIds: [],
    agentIds: [],
    findings: { auditowl: [], agent: [] },
    comparator: {
      relation: null,
      coverage: null,
      strength: null,
      severityAgreement: null,
      statusAgreement: null,
      verification: null,
      anchor: null,
      agentAdds: null,
      auditowlAdds: null,
      note: null,
      missReason: null,
      proposedAssessment: null,
      proposedNovelty: null,
      closestAuditowl: [],
      closestAgent: [],
      relatedReason: null,
    },
    itemHash: "",
  }
}

describe("item ids", () => {
  it("round-trips cluster ids", () => {
    const id = itemId("cluster", "1171", "M01")
    expect(id).toBe("cluster:1171:M01")
    expect(parseItemId(id)).toEqual({
      kind: "cluster",
      paperId: "1171",
      ref: "M01",
    })
  })

  it("encodes refs for URLs and decodes the route param exactly once", () => {
    const id = itemId("agent_only", "1829", "a/b c")
    expect(id).toBe("agent_only:1829:a%2Fb%20c")
    expect(parseItemIdParam(id).ref).toBe("a/b c")
    // Next escapes the path delimiters in the param it hands to the page.
    expect(parseItemIdParam("agent_only%3A1829%3Aa%2Fb%20c").ref).toBe("a/b c")
  })

  it("keeps a literal percent sequence after the page boundary", () => {
    const id = itemId("agent_only", "1829", "a%20b")
    expect(id).toBe("agent_only:1829:a%2520b")
    // The URL carries %2520. Decoding once at the page boundary yields the
    // literal ref `a%20b`; parsing the result must not decode it again.
    expect(parseItemIdParam(id).ref).toBe("a%20b")
    expect(parseItemIdParam("agent_only%3A1829%3Aa%2520b").ref).toBe("a%20b")
  })

  it("parses already-decoded ids without decoding them again", () => {
    expect(parseItemId("cluster:1001:M01")).toEqual({
      kind: "cluster",
      paperId: "1001",
      ref: "M01",
    })
    expect(parseItemId("agent_only:1829:a%20b").ref).toBe("a%20b")
  })

  it("builds related refs from both sides", () => {
    const ref = relatedRef(["a", "b"], ["c", "d"])
    expect(ref).toBe("a+b--c+d")
    expect(parseRelatedRef(ref)).toEqual({
      auditowl: ["a", "b"],
      agent: ["c", "d"],
    })
  })

  it("rejects malformed related refs", () => {
    expect(() => relatedRef([], ["c"])).toThrow()
    expect(() => parseRelatedRef("no-separator")).toThrow()
  })
})

describe("severity", () => {
  it("returns the maximum rank", () => {
    expect(severityMax(["low", "high", "medium"])).toBe("high")
    expect(severityMax(["low"])).toBe("low")
    expect(() => severityMax([])).toThrow()
  })
})

describe("item ordering", () => {
  it("sorts by severity, paper id, kind and ref", () => {
    const items = [
      reviewItem("related", "654", "a--b", "low"),
      reviewItem("cluster", "1171", "M02", "high"),
      reviewItem("agent_only", "654", "a", "high"),
      reviewItem("cluster", "1171", "M01", "high"),
      reviewItem("auditowl_only", "654", "o", "low"),
    ]
    items.sort(compareReviewItems)
    expect(items.map((item) => item.id)).toEqual([
      "cluster:1171:M01",
      "cluster:1171:M02",
      "agent_only:654:a",
      "auditowl_only:654:o",
      "related:654:a--b",
    ])
  })
})
