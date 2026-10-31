import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ZodError } from "zod"

import { itemClaim } from "@/db/review-schema"
import {
  ClaimExpiredError,
  CLAIM_LEASE_MS,
  claimItem,
  getItemClaim,
  type ItemKey,
} from "@/lib/review/claims"
import {
  DecisionStatusError,
  discardDraft,
  getBatchDecisionEvents,
  getBatchDecisionRows,
  getItemDecisionEvents,
  getItemDecisionRows,
  getItemReviewState,
  getPaperDecisionRows,
  getReviewStateForItems,
  ItemClosedError,
  reopenDecision,
  saveDecision,
  type ItemWithHash,
  type SaveDecisionInput,
} from "@/lib/review/decisions"
import type { DecisionStatus, ReviewItem } from "@/lib/review/types"
import {
  createFixtureItems,
  createTestDb,
  FIXTURE_BATCH_ID,
  FIXTURE_MANIFEST_SHA256,
  getFixtureItem,
  type TestDb,
} from "@/lib/review/test-support"

const T0 = 1_800_000_000_000

let testDb: TestDb
let owner: string
let other: string
let admin: string
let items: ReviewItem[]
let cluster: ReviewItem
let agentOnly: ReviewItem

function keyOf(item: ReviewItem): ItemKey {
  return {
    batchId: FIXTURE_BATCH_ID,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
  }
}

function decisionItem(item: ReviewItem): ItemWithHash {
  return {
    id: item.id,
    kind: item.kind,
    paperId: item.paperId,
    ref: item.ref,
    itemHash: item.itemHash,
  }
}

function input(
  item: ReviewItem,
  userId: string,
  status: DecisionStatus,
  payload: unknown
): SaveDecisionInput {
  return {
    batchId: FIXTURE_BATCH_ID,
    item,
    batchItems: items,
    manifestSha256: FIXTURE_MANIFEST_SHA256,
    userId,
    status,
    payload,
  }
}

const sameDefect = { verdict: "same_defect", note: "" } as const
const unsure = { verdict: "unsure", note: "Needs another opinion" } as const

beforeEach(() => {
  testDb = createTestDb()
  owner = testDb.createUser("owner")
  other = testDb.createUser("other")
  admin = testDb.createUser("admin")
  items = createFixtureItems()
  cluster = getFixtureItem(items, "cluster", "M01")
  agentOnly = getFixtureItem(items, "agent_only", "a2")
})

afterEach(() => {
  testDb.close()
})

describe("saveDecision", () => {
  it("keeps the claim for a draft and extends the lease", async () => {
    const record = await saveDecision(
      testDb.db,
      input(cluster, owner, "draft", sameDefect),
      T0
    )
    expect(record.status).toBe("draft")

    const claim = await getItemClaim(testDb.db, keyOf(cluster), T0 + 1)
    expect(claim?.userId).toBe(owner)
    expect(claim?.expiresAt).toBe(T0 + CLAIM_LEASE_MS)

    await saveDecision(
      testDb.db,
      input(cluster, owner, "draft", sameDefect),
      T0 + 60_000
    )
    const extended = await getItemClaim(testDb.db, keyOf(cluster), T0 + 60_000)
    expect(extended?.expiresAt).toBe(T0 + 60_000 + CLAIM_LEASE_MS)

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 60_000
    )
    expect(state.status).toBe("claimed")
    expect(state.draft?.record.id).toBe(record.id)
  })

  it("claims a free item and releases it when closed", async () => {
    const record = await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )
    expect(record.status).toBe("closed")
    expect(await getItemClaim(testDb.db, keyOf(cluster), T0 + 1)).toBeNull()

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      other,
      FIXTURE_MANIFEST_SHA256,
      T0 + 1
    )
    expect(state.status).toBe("closed")
    expect(state.finalDecision?.record.id).toBe(record.id)
  })

  it("marks unsure and releases the claim so another reviewer can claim", async () => {
    await claimItem(testDb.db, keyOf(cluster), owner, T0)
    const record = await saveDecision(
      testDb.db,
      input(cluster, owner, "unsure", unsure),
      T0 + 1
    )
    expect(record.status).toBe("unsure")
    expect(await getItemClaim(testDb.db, keyOf(cluster), T0 + 2)).toBeNull()

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 2
    )
    expect(state.status).toBe("unsure")
    expect(state.latestUnsure?.record.payload).toEqual(unsure)

    const claimed = await claimItem(testDb.db, keyOf(cluster), other, T0 + 3)
    expect(claimed.userId).toBe(other)
  })

  it("preserves the unsure event when the same reviewer re-claims and drafts", async () => {
    await saveDecision(testDb.db, input(cluster, owner, "unsure", unsure), T0)
    await claimItem(testDb.db, keyOf(cluster), owner, T0 + 1)
    await saveDecision(
      testDb.db,
      input(cluster, owner, "draft", sameDefect),
      T0 + 2
    )

    // The current row is a draft again, but the append-only event keeps the
    // unsure note for history and exports.
    const ownerState = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 3
    )
    expect(ownerState.status).toBe("claimed")
    expect(ownerState.latestUnsure).toBeNull()
    expect(ownerState.unsureHistory).toHaveLength(1)
    expect(ownerState.unsureHistory[0]?.record.payload).toEqual(unsure)

    const otherState = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      other,
      FIXTURE_MANIFEST_SHA256,
      T0 + 3
    )
    expect(otherState.unsureHistory[0]?.record.payload).toEqual(unsure)

    const events = await getItemDecisionEvents(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster)
    )
    expect(events.map((event) => event.status)).toEqual(["unsure"])
  })

  it("preserves the unsure event when the same reviewer later closes", async () => {
    await saveDecision(testDb.db, input(cluster, owner, "unsure", unsure), T0)
    await claimItem(testDb.db, keyOf(cluster), owner, T0 + 1)
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0 + 2
    )

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 3
    )
    expect(state.status).toBe("closed")
    expect(state.latestUnsure).toBeNull()
    expect(state.unsureHistory[0]?.record.payload).toEqual(unsure)

    const events = await getBatchDecisionEvents(testDb.db, FIXTURE_BATCH_ID)
    expect(events.map((event) => event.status)).toEqual(["closed", "unsure"])
  })

  it("adds a reopen event without deleting the earlier history", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )
    await reopenDecision(testDb.db, keyOf(cluster), admin, T0 + 1)

    const events = await getItemDecisionEvents(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster)
    )
    expect(events.map((event) => event.status)).toEqual(["reopened", "closed"])
    expect(events[1]?.payload).toEqual(sameDefect)
  })

  it("rejects a save while another reviewer holds a live claim", async () => {
    await claimItem(testDb.db, keyOf(cluster), owner, T0)
    await expect(
      saveDecision(
        testDb.db,
        input(cluster, other, "closed", sameDefect),
        T0 + 1
      )
    ).rejects.toThrow(/reserved by another reviewer/)
  })

  it("rejects a save from an expired claim owned by the same reviewer", async () => {
    await claimItem(testDb.db, keyOf(cluster), owner, T0)
    await expect(
      saveDecision(
        testDb.db,
        input(cluster, owner, "draft", sameDefect),
        T0 + CLAIM_LEASE_MS
      )
    ).rejects.toBeInstanceOf(ClaimExpiredError)

    // The explicit re-claim clears the expired row and then works.
    const reclaimed = await claimItem(
      testDb.db,
      keyOf(cluster),
      owner,
      T0 + CLAIM_LEASE_MS
    )
    expect(reclaimed.expiresAt).toBe(T0 + 2 * CLAIM_LEASE_MS)
    await expect(
      saveDecision(
        testDb.db,
        input(cluster, owner, "draft", sameDefect),
        T0 + CLAIM_LEASE_MS + 1
      )
    ).resolves.toMatchObject({ status: "draft" })
  })

  it("atomically claims a free item when no claim row exists", async () => {
    const record = await saveDecision(
      testDb.db,
      input(cluster, owner, "draft", sameDefect),
      T0
    )
    expect(record.status).toBe("draft")
    const claim = await getItemClaim(testDb.db, keyOf(cluster), T0 + 1)
    expect(claim?.userId).toBe(owner)
  })

  it("treats another reviewer's expired claim as free and takes it over", async () => {
    await claimItem(testDb.db, keyOf(cluster), owner, T0)
    const record = await saveDecision(
      testDb.db,
      input(cluster, other, "draft", sameDefect),
      T0 + CLAIM_LEASE_MS
    )
    expect(record.userId).toBe(other)
    const claim = await getItemClaim(
      testDb.db,
      keyOf(cluster),
      T0 + CLAIM_LEASE_MS
    )
    expect(claim?.userId).toBe(other)
  })

  it("is read-only after closing, even for the owner", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )

    await expect(
      saveDecision(
        testDb.db,
        input(cluster, owner, "draft", sameDefect),
        T0 + 1
      )
    ).rejects.toBeInstanceOf(ItemClosedError)
    await expect(
      saveDecision(
        testDb.db,
        input(cluster, other, "closed", sameDefect),
        T0 + 2
      )
    ).rejects.toBeInstanceOf(ItemClosedError)
  })

  it("lets a later closure win over an earlier unsure decision", async () => {
    await saveDecision(testDb.db, input(cluster, owner, "unsure", unsure), T0)
    const closed = await saveDecision(
      testDb.db,
      input(cluster, other, "closed", sameDefect),
      T0 + 10
    )

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 11
    )
    expect(state.status).toBe("closed")
    expect(state.finalDecision?.record.id).toBe(closed.id)
    expect(state.latestUnsure?.record.userId).toBe(owner)
  })

  it("rolls back an invalid payload without claiming a free item", async () => {
    await expect(
      saveDecision(
        testDb.db,
        input(cluster, owner, "draft", {
          verdict: "nonsense",
          note: "",
        }),
        T0
      )
    ).rejects.toBeInstanceOf(ZodError)

    expect(await getItemClaim(testDb.db, keyOf(cluster), T0)).toBeNull()
    expect(await getBatchDecisionRows(testDb.db, FIXTURE_BATCH_ID)).toEqual([])
  })

  it("rolls back an invalid payload without touching an existing claim", async () => {
    const claim = await claimItem(testDb.db, keyOf(cluster), owner, T0)
    await expect(
      saveDecision(
        testDb.db,
        input(cluster, owner, "draft", {
          verdict: "nonsense",
          note: "",
        }),
        T0 + 1
      )
    ).rejects.toBeInstanceOf(ZodError)

    const after = await getItemClaim(testDb.db, keyOf(cluster), T0 + 1)
    expect(after?.id).toBe(claim.id)
    expect(after?.expiresAt).toBe(claim.expiresAt)
    expect(await getBatchDecisionRows(testDb.db, FIXTURE_BATCH_ID)).toEqual([])
  })

  it("rejects not_checked above low severity using the loaded item severity", async () => {
    await expect(
      saveDecision(
        testDb.db,
        input(agentOnly, owner, "closed", {
          verdict: "not_checked",
          note: "Could not run",
        }),
        T0
      )
    ).rejects.toBeInstanceOf(ZodError)
  })

  it("validates proposedLink through the save path", async () => {
    const accepted = await saveDecision(
      testDb.db,
      input(agentOnly, owner, "closed", {
        verdict: "confirmed_valid",
        note: "",
        proposedLink: { kind: "auditowl_only", ref: "o2" },
      }),
      T0
    )
    expect(accepted.payload).toMatchObject({
      proposedLink: { kind: "auditowl_only", ref: "o2" },
    })

    const agentLow = getFixtureItem(items, "agent_only", "a3")
    await expect(
      saveDecision(
        testDb.db,
        input(agentOnly, other, "closed", {
          verdict: "confirmed_valid",
          note: "",
          proposedLink: { kind: "agent_only", ref: agentLow.ref },
        }),
        T0 + 1
      )
    ).rejects.toBeInstanceOf(ZodError)

    await expect(
      saveDecision(
        testDb.db,
        input(agentOnly, other, "closed", {
          verdict: "confirmed_valid",
          note: "",
          proposedLink: { kind: "auditowl_only", ref: "missing" },
        }),
        T0 + 2
      )
    ).rejects.toBeInstanceOf(ZodError)

    expect(
      await getBatchDecisionRows(testDb.db, FIXTURE_BATCH_ID)
    ).toHaveLength(1)
  })

  it("rejects a status that contradicts the verdict", async () => {
    await expect(
      saveDecision(testDb.db, input(cluster, owner, "closed", unsure), T0)
    ).rejects.toBeInstanceOf(DecisionStatusError)
    await expect(
      saveDecision(testDb.db, input(cluster, owner, "unsure", sameDefect), T0)
    ).rejects.toBeInstanceOf(DecisionStatusError)
  })

  it("replaces the same reviewer's draft when it closes", async () => {
    const draft = await saveDecision(
      testDb.db,
      input(cluster, owner, "draft", sameDefect),
      T0
    )
    const closed = await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0 + 1
    )
    expect(closed.id).toBe(draft.id)
    expect(closed.status).toBe("closed")
    expect(
      await getBatchDecisionRows(testDb.db, FIXTURE_BATCH_ID)
    ).toHaveLength(1)
  })
})

describe("staleness", () => {
  it("flags a decision whose item or manifest hash changed", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )

    const fresh = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 1
    )
    expect(fresh.finalDecision?.stale).toBe(false)

    const changedItem: ItemWithHash = {
      ...decisionItem(cluster),
      itemHash: "b".repeat(64),
    }
    const itemStale = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      changedItem,
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 1
    )
    expect(itemStale.finalDecision?.stale).toBe(true)

    const manifestStale = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      owner,
      "c".repeat(64),
      T0 + 1
    )
    expect(manifestStale.finalDecision?.stale).toBe(true)
  })
})

describe("review state queries", () => {
  it("returns states for all items in one pass", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )
    await claimItem(testDb.db, keyOf(agentOnly), other, T0)

    const states = await getReviewStateForItems(
      testDb.db,
      FIXTURE_BATCH_ID,
      items,
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 1
    )
    expect(states.get(cluster.id)?.status).toBe("closed")
    expect(states.get(agentOnly.id)?.status).toBe("claimed")
    expect(
      states.get(getFixtureItem(items, "auditowl_only", "o2").id)?.status
    ).toBe("open")
  })

  it("reaps expired claims and treats them as open", async () => {
    const auditowlOnly = getFixtureItem(items, "auditowl_only", "o2")
    await claimItem(testDb.db, keyOf(auditowlOnly), owner, T0)

    const states = await getReviewStateForItems(
      testDb.db,
      FIXTURE_BATCH_ID,
      items,
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + CLAIM_LEASE_MS
    )
    expect(states.get(auditowlOnly.id)?.status).toBe("open")
    expect(states.get(auditowlOnly.id)?.claim).toBeNull()

    // The bulk read removed the expired row instead of leaving it behind.
    const remaining = testDb.db
      .select()
      .from(itemClaim)
      .where(eq(itemClaim.batchId, FIXTURE_BATCH_ID))
      .all()
    expect(remaining).toEqual([])
  })

  it("does not expose a live claim on a closed item in bulk reads", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )
    testDb.db
      .insert(itemClaim)
      .values({
        id: randomUUID(),
        batchId: FIXTURE_BATCH_ID,
        paperId: cluster.paperId,
        itemKind: cluster.kind,
        itemRef: cluster.ref,
        userId: owner,
        claimedAt: T0 + 1,
        lastSeenAt: T0 + 1,
        expiresAt: T0 + 1 + CLAIM_LEASE_MS,
      })
      .run()

    const states = await getReviewStateForItems(
      testDb.db,
      FIXTURE_BATCH_ID,
      items,
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 2
    )
    expect(states.get(cluster.id)?.status).toBe("closed")
    expect(states.get(cluster.id)?.claim).toBeNull()
    expect(
      testDb.db
        .select()
        .from(itemClaim)
        .where(eq(itemClaim.batchId, FIXTURE_BATCH_ID))
        .all()
    ).toEqual([])
  })

  it("filters decision rows by paper", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )
    const batchRows = await getBatchDecisionRows(testDb.db, FIXTURE_BATCH_ID)
    const paperRows = await getPaperDecisionRows(
      testDb.db,
      FIXTURE_BATCH_ID,
      cluster.paperId
    )
    expect(batchRows).toHaveLength(1)
    expect(paperRows).toHaveLength(1)
    expect(
      await getPaperDecisionRows(testDb.db, FIXTURE_BATCH_ID, "missing")
    ).toEqual([])
    expect(await getBatchDecisionRows(testDb.db, "other-batch")).toEqual([])
  })
})

describe("discardDraft", () => {
  it("deletes only the caller's draft and leaves other drafts alone", async () => {
    const agentLow = getFixtureItem(items, "agent_only", "a3")
    await saveDecision(
      testDb.db,
      input(cluster, owner, "draft", sameDefect),
      T0
    )
    await saveDecision(
      testDb.db,
      input(agentLow, other, "draft", sameDefect),
      T0 + 1
    )

    await expect(discardDraft(testDb.db, keyOf(cluster), owner)).resolves.toBe(
      true
    )
    expect(
      await getItemDecisionRows(
        testDb.db,
        FIXTURE_BATCH_ID,
        decisionItem(cluster)
      )
    ).toEqual([])
    expect(
      await getItemDecisionRows(
        testDb.db,
        FIXTURE_BATCH_ID,
        decisionItem(agentLow)
      )
    ).toHaveLength(1)

    // A second discard has nothing left to remove.
    await expect(discardDraft(testDb.db, keyOf(cluster), owner)).resolves.toBe(
      false
    )
  })

  it("never removes final or unsure rows, even for their owner", async () => {
    await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0
    )
    await saveDecision(testDb.db, input(agentOnly, owner, "unsure", unsure), T0)

    await expect(discardDraft(testDb.db, keyOf(cluster), owner)).resolves.toBe(
      false
    )
    await expect(
      discardDraft(testDb.db, keyOf(agentOnly), owner)
    ).resolves.toBe(false)

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(agentOnly),
      owner,
      FIXTURE_MANIFEST_SHA256,
      T0 + 1
    )
    expect(state.status).toBe("unsure")
    expect(state.unsureHistory).toHaveLength(1)
  })
})

describe("reopenDecision", () => {
  it("turns the final decision into an admin draft and releases the claim", async () => {
    await claimItem(testDb.db, keyOf(cluster), owner, T0)
    const closed = await saveDecision(
      testDb.db,
      input(cluster, owner, "closed", sameDefect),
      T0 + 1
    )

    const reopened = await reopenDecision(
      testDb.db,
      keyOf(cluster),
      admin,
      T0 + 3
    )
    expect(reopened?.id).toBe(closed.id)
    expect(reopened?.status).toBe("draft")
    expect(reopened?.userId).toBe(admin)
    expect(reopened?.payload).toEqual(sameDefect)
    expect(await getItemClaim(testDb.db, keyOf(cluster), T0 + 4)).toBeNull()

    const state = await getItemReviewState(
      testDb.db,
      FIXTURE_BATCH_ID,
      decisionItem(cluster),
      admin,
      FIXTURE_MANIFEST_SHA256,
      T0 + 4
    )
    expect(state.status).toBe("open")
    expect(state.draft?.record.id).toBe(closed.id)

    // Reopening must make the item claimable again.
    const reclaimed = await claimItem(testDb.db, keyOf(cluster), other, T0 + 5)
    expect(reclaimed.userId).toBe(other)
  })

  it("returns null when the item is not closed", async () => {
    expect(
      await reopenDecision(testDb.db, keyOf(cluster), admin, T0)
    ).toBeNull()
  })
})
