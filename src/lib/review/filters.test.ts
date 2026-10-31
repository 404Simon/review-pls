import { describe, expect, it } from "vitest"

import {
  ITEM_TABS,
  kindForTab,
  matchesReviewFilters,
  parseItemTab,
  parseReviewFilters,
  queryFromFilters,
} from "@/lib/review/filters"
import type { ItemStatus, ReviewItem } from "@/lib/review/types"

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    kind: "cluster",
    paperId: "p1",
    ref: "M01",
    id: "cluster:p1:M01",
    severity: "high",
    title: "Selection loop leaks test data",
    summary: "Train and test share an index.",
    auditowlIds: ["o1"],
    agentIds: ["a1"],
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
    itemHash: "hash",
    ...overrides,
  }
}

function state(
  status: ItemStatus,
  userId: string | null = null
): Parameters<typeof matchesReviewFilters>[1] {
  return {
    status,
    claim: userId ? { userId } : null,
    finalDecision: userId ? { record: { userId } } : null,
  }
}

describe("parseReviewFilters", () => {
  it("parses valid filters and drops invalid enum values", () => {
    expect(
      parseReviewFilters({
        severity: "high",
        kind: "agent_only",
        status: "unsure",
        mine: "1",
        q: "  seed  ",
      })
    ).toEqual({
      severity: "high",
      kind: "agent_only",
      status: "unsure",
      mine: true,
      search: "seed",
    })

    expect(
      parseReviewFilters({
        severity: "critical",
        kind: "nonsense",
        status: "done",
        mine: "0",
      })
    ).toEqual({
      severity: "all",
      kind: "all",
      status: "all",
      mine: false,
      search: "",
    })
  })

  it("takes the first value of repeated params", () => {
    expect(parseReviewFilters({ q: ["first", "second"] }).search).toBe("first")
  })
})

describe("item tabs", () => {
  it("maps tabs to kinds and defaults unknown tabs to all", () => {
    expect(kindForTab("matches")).toBe("cluster")
    expect(kindForTab("new")).toBe("agent_only")
    expect(kindForTab("auditowl")).toBe("auditowl_only")
    expect(kindForTab("related")).toBe("related")
    expect(kindForTab("all")).toBeNull()
    expect(ITEM_TABS).toHaveLength(5)
    expect(parseItemTab("new")).toBe("new")
    expect(parseItemTab("unknown")).toBe("all")
  })
})

describe("matchesReviewFilters", () => {
  const currentUser = "alice"

  it("filters by severity, kind and status", () => {
    const cluster = item()
    expect(
      matchesReviewFilters(
        cluster,
        state("open"),
        {
          severity: "high",
          kind: "all",
          status: "all",
          mine: false,
          search: "",
        },
        currentUser
      )
    ).toBe(true)
    expect(
      matchesReviewFilters(
        cluster,
        state("open"),
        {
          severity: "medium",
          kind: "all",
          status: "all",
          mine: false,
          search: "",
        },
        currentUser
      )
    ).toBe(false)
    expect(
      matchesReviewFilters(
        cluster,
        state("unsure"),
        {
          severity: "all",
          kind: "all",
          status: "closed",
          mine: false,
          search: "",
        },
        currentUser
      )
    ).toBe(false)
  })

  it("hides closed items only when the caller asks for the queue default", () => {
    const filters = {
      severity: "all" as const,
      kind: "all" as const,
      status: "all" as const,
      mine: false,
      search: "",
    }
    expect(
      matchesReviewFilters(item(), state("closed"), filters, currentUser, {
        hideClosedWhenAll: true,
      })
    ).toBe(false)
    expect(
      matchesReviewFilters(item(), state("closed"), filters, currentUser)
    ).toBe(true)
    expect(
      matchesReviewFilters(
        item(),
        state("closed"),
        { ...filters, status: "closed" },
        currentUser,
        { hideClosedWhenAll: true }
      )
    ).toBe(true)
  })

  it("implements only-mine via claim or final decision", () => {
    const filters = {
      severity: "all" as const,
      kind: "all" as const,
      status: "all" as const,
      mine: true,
      search: "",
    }
    expect(
      matchesReviewFilters(
        item(),
        state("claimed", "alice"),
        filters,
        currentUser
      )
    ).toBe(true)
    expect(
      matchesReviewFilters(
        item(),
        state("closed", "alice"),
        filters,
        currentUser
      )
    ).toBe(true)
    expect(
      matchesReviewFilters(
        item(),
        state("claimed", "bob"),
        filters,
        currentUser
      )
    ).toBe(false)
    expect(
      matchesReviewFilters(item(), state("open"), filters, currentUser)
    ).toBe(false)
  })

  it("searches title, summary, ref, paper id and kind case-insensitively", () => {
    const filters = {
      severity: "all" as const,
      kind: "all" as const,
      status: "all" as const,
      mine: false,
      search: "LEAKS",
    }
    expect(
      matchesReviewFilters(item(), state("open"), filters, currentUser)
    ).toBe(true)
    expect(
      matchesReviewFilters(
        item({ title: "Unrelated", summary: null }),
        state("open"),
        filters,
        currentUser
      )
    ).toBe(false)
  })
})

describe("queryFromFilters", () => {
  it("omits defaults and keeps the tab/batch extras", () => {
    const params = queryFromFilters(
      {
        severity: "all",
        kind: "all",
        status: "all",
        mine: false,
        search: "",
      },
      { tab: "matches", from: "paper" }
    )
    expect(params).toEqual({
      tab: "matches",
      from: "paper",
      severity: "all",
      kind: "all",
      status: "all",
      mine: "",
      q: "",
    })
  })
})
