import { describe, expect, it } from "vitest"

import { collectReviewerIds } from "@/lib/review/ui-data"
import type {
  Claim,
  DecisionEventRecord,
  DecisionRecord,
} from "@/lib/review/types"

function decision(userId: string): DecisionRecord {
  return {
    id: `decision-${userId}`,
    batchId: "batch",
    paperId: "p1",
    itemKind: "cluster",
    itemRef: "M01",
    userId,
    status: "closed",
    payload: {},
    itemHash: "hash",
    manifestSha256: "manifest",
    createdAt: 1,
    updatedAt: 1,
  }
}

function claim(userId: string): Claim {
  return {
    id: `claim-${userId}`,
    batchId: "batch",
    paperId: "p1",
    itemKind: "cluster",
    itemRef: "M01",
    userId,
    claimedAt: 1,
    lastSeenAt: 1,
    expiresAt: 2,
  }
}

function event(userId: string): DecisionEventRecord {
  return {
    id: `event-${userId}`,
    batchId: "batch",
    paperId: "p1",
    itemKind: "cluster",
    itemRef: "M01",
    userId,
    status: "unsure",
    payload: {},
    itemHash: "hash",
    manifestSha256: "manifest",
    createdAt: 1,
  }
}

describe("collectReviewerIds", () => {
  it("merges decisions, claims and history events without duplicates", () => {
    expect(
      collectReviewerIds(
        [decision("alice"), decision("alice")],
        [claim("bob"), claim("bob")],
        [event("carol")]
      )
    ).toEqual(["alice", "bob", "carol"])
  })

  it("works without events", () => {
    expect(collectReviewerIds([decision("alice")], [])).toEqual(["alice"])
    expect(collectReviewerIds([], [])).toEqual([])
  })
})
