import { describe, expect, it } from "vitest"

import { summarizeUserActivity } from "@/lib/review/user-activity"
import type {
  Claim,
  DecisionEventRecord,
  DecisionEventStatus,
  DecisionRecord,
  DecisionStatus,
} from "@/lib/review/types"

const T0 = 1_800_000_000_000

function decision(
  userId: string,
  status: DecisionStatus,
  updatedAt: number,
  batchId = "batch-a"
): DecisionRecord {
  return {
    id: `${batchId}:${userId}:${status}:${updatedAt}`,
    batchId,
    paperId: "p1",
    itemKind: "agent_only",
    itemRef: `${status}-${updatedAt}`,
    userId,
    status,
    payload: {},
    itemHash: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    createdAt: updatedAt,
    updatedAt,
  }
}

function event(
  userId: string,
  status: DecisionEventStatus,
  createdAt: number,
  batchId = "batch-a"
): DecisionEventRecord {
  return {
    id: `${batchId}:${userId}:${status}:${createdAt}`,
    batchId,
    paperId: "p1",
    itemKind: "agent_only",
    itemRef: `${status}-${createdAt}`,
    userId,
    status,
    payload: {},
    itemHash: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    createdAt,
  }
}

function claim(userId: string, expiresAt: number, batchId = "batch-a"): Claim {
  return {
    id: `${batchId}:${userId}:${expiresAt}`,
    batchId,
    paperId: "p1",
    itemKind: "agent_only",
    itemRef: `claim-${expiresAt}`,
    userId,
    claimedAt: T0,
    lastSeenAt: T0,
    expiresAt,
  }
}

describe("summarizeUserActivity", () => {
  it("counts decision rows per batch and ignores other reviewers", () => {
    const activity = summarizeUserActivity(
      "owner",
      [
        {
          batchId: "batch-a",
          decisions: [
            decision("owner", "closed", T0 + 10),
            decision("owner", "closed", T0 + 20),
            decision("owner", "draft", T0 + 30),
            decision("other", "unsure", T0 + 40),
          ],
          events: [],
          claims: [],
        },
        {
          batchId: "batch-b",
          decisions: [decision("owner", "unsure", T0 + 50, "batch-b")],
          events: [],
          claims: [],
        },
      ],
      T0
    )

    expect(activity.batches).toEqual([
      {
        batchId: "batch-a",
        userId: "owner",
        closed: 2,
        unsure: 0,
        drafts: 1,
        total: 3,
      },
      {
        batchId: "batch-b",
        userId: "owner",
        closed: 0,
        unsure: 1,
        drafts: 0,
        total: 1,
      },
    ])
    expect(activity.lastActivityAt).toBe(T0 + 50)
  })

  it("summarizes the append-only event history", () => {
    const activity = summarizeUserActivity(
      "owner",
      [
        {
          batchId: "batch-a",
          decisions: [decision("owner", "closed", T0 + 10)],
          events: [
            event("owner", "closed", T0 + 10),
            event("owner", "unsure", T0 + 20),
            event("owner", "reopened", T0 + 30),
            event("owner", "unsure", T0 + 40),
            event("other", "closed", T0 + 90),
          ],
          claims: [],
        },
      ],
      T0
    )

    expect(activity.events).toEqual({
      closed: 1,
      unsure: 2,
      reopened: 1,
      total: 4,
      lastAt: T0 + 40,
    })
    expect(activity.lastActivityAt).toBe(T0 + 40)
  })

  it("counts only live claims held by the reviewer", () => {
    const activity = summarizeUserActivity(
      "owner",
      [
        {
          batchId: "batch-a",
          decisions: [],
          events: [],
          claims: [
            claim("owner", T0 + 60_000),
            claim("owner", T0 - 1),
            claim("other", T0 + 60_000),
          ],
        },
      ],
      T0
    )

    expect(activity.activeClaims).toBe(1)
    expect(activity.batches).toEqual([])
    expect(activity.lastActivityAt).toBeNull()
  })

  it("returns an empty summary for a reviewer without rows", () => {
    expect(summarizeUserActivity("nobody", [], T0)).toEqual({
      batches: [],
      events: {
        closed: 0,
        unsure: 0,
        reopened: 0,
        total: 0,
        lastAt: null,
      },
      activeClaims: 0,
      lastActivityAt: null,
    })
  })
})
