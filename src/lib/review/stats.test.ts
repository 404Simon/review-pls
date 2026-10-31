import { describe, expect, it } from "vitest"

import type {
  Claim,
  DecisionRecord,
  DecisionStatus,
  ReviewItem,
} from "@/lib/review/types"
import {
  computeBatchStats,
  computePaperStats,
  computeReviewerStats,
  type ReviewStatsInput,
} from "@/lib/review/stats"
import {
  createFixtureItems,
  FIXTURE_BATCH_ID,
  FIXTURE_MANIFEST_SHA256,
  getFixtureItem,
} from "@/lib/review/test-support"

const T0 = 1_800_000_000_000

const items = createFixtureItems()
const cluster = getFixtureItem(items, "cluster", "M01")
const agentMedium = getFixtureItem(items, "agent_only", "a2")
const agentLow = getFixtureItem(items, "agent_only", "a3")
const relatedAgent = getFixtureItem(items, "agent_only", "a4")
const auditowlOnly = getFixtureItem(items, "auditowl_only", "o2")

function decision(
  item: ReviewItem,
  userId: string,
  status: DecisionStatus,
  updatedAt: number,
  itemHash = item.itemHash
): DecisionRecord {
  return {
    id: `${item.id}:${userId}:${status}`,
    batchId: FIXTURE_BATCH_ID,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
    userId,
    status,
    payload: {},
    itemHash,
    manifestSha256: FIXTURE_MANIFEST_SHA256,
    createdAt: updatedAt,
    updatedAt,
  }
}

function claim(item: ReviewItem, userId: string, expiresAt: number): Claim {
  return {
    id: `${item.id}:${userId}`,
    batchId: FIXTURE_BATCH_ID,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
    userId,
    claimedAt: T0,
    lastSeenAt: T0,
    expiresAt,
  }
}

function input(overrides: Partial<ReviewStatsInput> = {}): ReviewStatsInput {
  return {
    batchId: FIXTURE_BATCH_ID,
    items,
    decisions: [
      decision(cluster, "owner", "closed", T0 + 10),
      decision(agentMedium, "owner", "unsure", T0 + 20),
      decision(agentLow, "other", "draft", T0 + 30),
    ],
    claims: [claim(relatedAgent, "other", T0 + 60_000)],
    manifestSha256: FIXTURE_MANIFEST_SHA256,
    now: T0 + 1,
    ...overrides,
  }
}

describe("computeBatchStats", () => {
  it("counts by severity, kind and derived status", () => {
    const stats = computeBatchStats(input())
    expect(stats.total).toBe(6)
    expect(stats.bySeverity).toEqual({ high: 1, medium: 1, low: 4 })
    expect(stats.byKind.cluster).toEqual({
      high: 1,
      medium: 0,
      low: 0,
      total: 1,
    })
    expect(stats.byKind.agent_only).toEqual({
      high: 0,
      medium: 1,
      low: 2,
      total: 3,
    })
    expect(stats.byKind.auditowl_only).toEqual({
      high: 0,
      medium: 0,
      low: 1,
      total: 1,
    })
    expect(stats.byKind.related).toEqual({
      high: 0,
      medium: 0,
      low: 1,
      total: 1,
    })

    expect(stats.byStatus).toEqual({
      open: 3,
      claimed: 1,
      unsure: 1,
      closed: 1,
    })
    expect(stats.closed).toBe(1)
    expect(stats.unsure).toBe(1)
    expect(stats.completion).toBeCloseTo(1 / 6)
  })

  it("does not count unsure or drafts as closed", () => {
    const stats = computeBatchStats(
      input({
        decisions: [
          decision(agentMedium, "owner", "unsure", T0 + 10),
          decision(agentLow, "owner", "draft", T0 + 20),
        ],
        claims: [],
      })
    )
    expect(stats.closed).toBe(0)
    expect(stats.unsure).toBe(1)
    expect(stats.byStatus).toEqual({
      open: 5,
      claimed: 0,
      unsure: 1,
      closed: 0,
    })
    expect(stats.completion).toBe(0)
  })

  it("follows the active claim after an unsure note was resumed by a draft", () => {
    const resumed = computeBatchStats(
      input({
        decisions: [
          decision(agentMedium, "owner", "unsure", T0 + 10),
          decision(agentMedium, "owner", "draft", T0 + 20),
        ],
        claims: [claim(agentMedium, "owner", T0 + 60_000)],
        now: T0 + 1,
      })
    )
    expect(resumed.byStatus.claimed).toBe(1)
    expect(resumed.byStatus.unsure).toBe(0)
    expect(resumed.unsure).toBe(0)
  })

  it("treats expired claims as open", () => {
    const stats = computeBatchStats(
      input({
        decisions: [],
        claims: [claim(cluster, "owner", T0 - 1)],
        now: T0,
      })
    )
    expect(stats.byStatus.claimed).toBe(0)
    expect(stats.byStatus.open).toBe(6)
  })

  it("counts stale final decisions", () => {
    const stats = computeBatchStats(
      input({
        decisions: [
          decision(cluster, "owner", "closed", T0 + 10, "b".repeat(64)),
        ],
        claims: [],
      })
    )
    expect(stats.closed).toBe(1)
    expect(stats.stale).toBe(1)
  })

  it("handles an empty batch", () => {
    const stats = computeBatchStats(
      input({ items: [], decisions: [], claims: [] })
    )
    expect(stats.total).toBe(0)
    expect(stats.completion).toBe(0)
    expect(stats.byStatus).toEqual({
      open: 0,
      claimed: 0,
      unsure: 0,
      closed: 0,
    })
  })
})

describe("computePaperStats", () => {
  it("limits counts to one paper", () => {
    const stats = computePaperStats(input(), cluster.paperId)
    expect(stats.total).toBe(6)

    const missing = computePaperStats(input(), "missing-paper")
    expect(missing.total).toBe(0)
    expect(missing.byStatus.open).toBe(0)
  })
})

describe("multi-paper fixtures", () => {
  it("computes per-paper and per-reviewer counts across papers", () => {
    const batchItems = createFixtureItems(["p1", "p2"])
    const p1Cluster = getFixtureItem(batchItems, "cluster", "M01", "p1")
    const p1Agent = getFixtureItem(batchItems, "agent_only", "a2", "p1")
    const p2Cluster = getFixtureItem(batchItems, "cluster", "M01", "p2")

    const multiInput = input({
      items: batchItems,
      decisions: [
        decision(p1Cluster, "owner", "closed", T0 + 10),
        decision(p1Agent, "owner", "unsure", T0 + 20),
        decision(p2Cluster, "other", "closed", T0 + 30),
      ],
      claims: [],
    })

    expect(computeBatchStats(multiInput).total).toBe(12)
    expect(computeBatchStats(multiInput).closed).toBe(2)

    const p1 = computePaperStats(multiInput, "p1")
    expect(p1.total).toBe(6)
    expect(p1.closed).toBe(1)
    expect(p1.unsure).toBe(1)

    const p2 = computePaperStats(multiInput, "p2")
    expect(p2.total).toBe(6)
    expect(p2.closed).toBe(1)
    expect(p2.unsure).toBe(0)

    expect(
      computeReviewerStats(FIXTURE_BATCH_ID, multiInput.decisions)
    ).toEqual([
      { userId: "other", closed: 1, unsure: 0, drafts: 0, total: 1 },
      { userId: "owner", closed: 1, unsure: 1, drafts: 0, total: 2 },
    ])
  })
})

describe("computeReviewerStats", () => {
  it("counts decisions per reviewer and ignores other batches", () => {
    const decisions = [
      decision(cluster, "owner", "closed", T0 + 10),
      decision(agentMedium, "owner", "unsure", T0 + 20),
      decision(agentLow, "other", "draft", T0 + 30),
      {
        ...decision(auditowlOnly, "owner", "closed", T0 + 40),
        batchId: "other-batch",
      },
    ]
    expect(computeReviewerStats(FIXTURE_BATCH_ID, decisions)).toEqual([
      { userId: "owner", closed: 1, unsure: 1, drafts: 0, total: 2 },
      { userId: "other", closed: 0, unsure: 0, drafts: 1, total: 1 },
    ])
  })

  it("returns an empty list when nobody has decided", () => {
    expect(computeReviewerStats(FIXTURE_BATCH_ID, [])).toEqual([])
  })
})
