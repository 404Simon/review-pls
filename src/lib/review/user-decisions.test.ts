import { describe, expect, it } from "vitest"

import {
  buildUserDecisionLog,
  matchesDecisionLogFilters,
  parseDecisionLogFilters,
  type UserDecisionBatch,
} from "@/lib/review/user-decisions"
import type {
  DecisionEventRecord,
  DecisionRecord,
  ItemKind,
  ReviewItem,
} from "@/lib/review/types"

const T0 = 1_800_000_000_000

function item(
  kind: ItemKind,
  ref: string,
  title = `Item ${ref}`,
  paperId = "p1"
): ReviewItem {
  return {
    kind,
    paperId,
    ref,
    id: `${kind}:${paperId}:${ref}`,
    severity: "medium",
    title,
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
    itemHash: "a".repeat(64),
  }
}

function row(
  userId: string,
  status: DecisionRecord["status"],
  updatedAt: number,
  ref = "M01",
  itemHash = "a".repeat(64),
  batchId = "batch-a"
): DecisionRecord {
  return {
    id: `row:${userId}:${status}:${updatedAt}`,
    batchId,
    paperId: "p1",
    itemKind: "cluster",
    itemRef: ref,
    userId,
    status,
    payload: { verdict: "same_defect", note: "" },
    itemHash,
    manifestSha256: "b".repeat(64),
    createdAt: updatedAt,
    updatedAt,
  }
}

function event(
  userId: string,
  status: DecisionEventRecord["status"],
  createdAt: number,
  ref = "M01",
  batchId = "batch-a"
): DecisionEventRecord {
  return {
    id: `event:${userId}:${status}:${createdAt}`,
    batchId,
    paperId: "p1",
    itemKind: "cluster",
    itemRef: ref,
    userId,
    status,
    payload: { verdict: "same_defect", note: "" },
    itemHash: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    createdAt,
  }
}

function batches(): UserDecisionBatch[] {
  return [
    {
      batchId: "batch-a",
      items: [item("cluster", "M01", "A shared defect")],
      manifestSha256: "b".repeat(64),
    },
  ]
}

describe("buildUserDecisionLog", () => {
  it("uses the append-only event instead of the matching current row", () => {
    const log = buildUserDecisionLog(
      "owner",
      [row("owner", "closed", T0 + 10)],
      [event("owner", "closed", T0 + 10)],
      batches()
    )

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]).toMatchObject({
      key: "event:event:owner:closed:1800000000010",
      status: "closed",
      item: { title: "A shared defect" },
      stale: false,
    })
    expect(log.counts).toEqual({
      closed: 1,
      unsure: 0,
      drafts: 0,
      reopened: 0,
    })
  })

  it("keeps final rows that predate the event table", () => {
    const log = buildUserDecisionLog(
      "owner",
      [row("owner", "closed", T0 + 10)],
      [],
      batches()
    )

    expect(log.entries).toEqual([
      expect.objectContaining({
        key: "row:row:owner:closed:1800000000010",
        status: "closed",
      }),
    ])
  })

  it("keeps an unsure event visible after the reviewer resumes with a draft", () => {
    const log = buildUserDecisionLog(
      "owner",
      [row("owner", "draft", T0 + 30)],
      [event("owner", "unsure", T0 + 20)],
      batches()
    )

    expect(log.entries.map((entry) => entry.status)).toEqual([
      "draft",
      "unsure",
    ])
    expect(log.counts).toMatchObject({ unsure: 1, drafts: 1 })
  })

  it("ignores another reviewer's rows and events", () => {
    const log = buildUserDecisionLog(
      "owner",
      [row("other", "closed", T0 + 10)],
      [event("other", "unsure", T0 + 20)],
      batches()
    )

    expect(log.entries).toEqual([])
    expect(log.counts).toEqual({
      closed: 0,
      unsure: 0,
      drafts: 0,
      reopened: 0,
    })
  })

  it("keeps unmounted entries and marks changed sources as stale", () => {
    const log = buildUserDecisionLog(
      "owner",
      [row("owner", "closed", T0 + 10, "M01", "c".repeat(64))],
      [event("owner", "closed", T0 + 20, "M02")],
      batches()
    )

    expect(log.entries).toHaveLength(2)
    expect(log.entries.find((entry) => entry.itemRef === "M01")).toMatchObject({
      stale: true,
      item: { title: "A shared defect" },
    })
    expect(log.entries.find((entry) => entry.itemRef === "M02")).toMatchObject({
      item: null,
      stale: false,
      batchId: "batch-a",
    })
  })
})

describe("decision log filters", () => {
  const log = buildUserDecisionLog(
    "owner",
    [row("owner", "draft", T0 + 30), row("owner", "closed", T0 + 10)],
    [event("owner", "unsure", T0 + 20)],
    batches()
  )

  it("parses known values and defaults the rest", () => {
    expect(parseDecisionLogFilters({})).toEqual({
      status: "all",
      kind: "all",
      search: "",
    })
    expect(
      parseDecisionLogFilters({
        status: "unsure",
        kind: "cluster",
        q: " shared ",
      })
    ).toEqual({ status: "unsure", kind: "cluster", search: "shared" })
    expect(parseDecisionLogFilters({ status: "bogus", kind: "bogus" })).toEqual(
      { status: "all", kind: "all", search: "" }
    )
  })

  it("filters by status, kind and search text", () => {
    const status = parseDecisionLogFilters({ status: "unsure" })
    expect(
      log.entries
        .filter((entry) => matchesDecisionLogFilters(entry, status))
        .map((entry) => entry.status)
    ).toEqual(["unsure"])

    const kind = parseDecisionLogFilters({ kind: "agent_only" })
    expect(
      log.entries.filter((entry) => matchesDecisionLogFilters(entry, kind))
    ).toEqual([])

    const search = parseDecisionLogFilters({ q: "shared defect" })
    expect(
      log.entries.filter((entry) => matchesDecisionLogFilters(entry, search))
    ).toHaveLength(3)
  })
})
