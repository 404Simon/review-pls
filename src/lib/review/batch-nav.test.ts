import { describe, expect, it } from "vitest"

import { batchNavItems, batchSwitchHref } from "@/lib/review/batch-nav"

describe("batchSwitchHref", () => {
  it("sends every batch switch to the dashboard for that batch", () => {
    expect(batchSwitchHref("second")).toBe("/dashboard?batch=second")
    expect(batchSwitchHref("review-fixture-b")).toBe(
      "/dashboard?batch=review-fixture-b"
    )
  })

  it("encodes the batch id", () => {
    expect(batchSwitchHref("a b")).toBe("/dashboard?batch=a%20b")
  })
})

describe("batchNavItems", () => {
  it("links the dashboard, guide and optionally admin", () => {
    expect(batchNavItems(null)).toEqual([
      { href: "/dashboard", label: "Papers", activePrefixes: ["/dashboard"] },
      { href: "/guide", label: "Guide", activePrefixes: ["/guide"] },
    ])
    expect(batchNavItems("second", { isAdmin: true })).toContainEqual({
      href: "/admin",
      label: "Admin",
      activePrefixes: ["/admin"],
    })
  })

  it("keeps the candidate batch on the dashboard link", () => {
    const papers = batchNavItems("a b")[0]
    expect(papers).toMatchObject({ href: "/dashboard?batch=a%20b" })
  })
})
