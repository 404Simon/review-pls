import { describe, expect, it } from "vitest"

import { batchSwitchHref } from "@/lib/review/batch-nav"

describe("batchSwitchHref", () => {
  it("switches batch routes to the new batch queue", () => {
    expect(batchSwitchHref("/batches/first/queue", "second")).toBe(
      "/batches/second/queue"
    )
    expect(batchSwitchHref("/batches/first/papers/1001", "second")).toBe(
      "/batches/second/queue"
    )
    expect(
      batchSwitchHref("/batches/first/items/cluster:1001:M01", "second")
    ).toBe("/batches/second/queue")
  })

  it("keeps dashboard routes on the dashboard with a batch query", () => {
    expect(batchSwitchHref("/dashboard", "second")).toBe(
      "/dashboard?batch=second"
    )
    expect(batchSwitchHref("/guide", "second")).toBe("/dashboard?batch=second")
  })

  it("encodes the batch id", () => {
    expect(batchSwitchHref("/batches/first/queue", "a b")).toBe(
      "/batches/a%20b/queue"
    )
  })
})
