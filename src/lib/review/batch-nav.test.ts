import { describe, expect, it } from "vitest"

import {
  batchNavItems,
  batchSwitchHref,
  isBatchScopedPath,
} from "@/lib/review/batch-nav"

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

describe("isBatchScopedPath", () => {
  it("keeps the decision log routes on the same page", () => {
    expect(isBatchScopedPath("/decisions")).toBe(true)
    expect(isBatchScopedPath("/decisions/")).toBe(true)
    expect(isBatchScopedPath("/admin/users/user-1")).toBe(true)
    expect(isBatchScopedPath("/admin/users/user-1/")).toBe(true)
  })

  it("sends every other route back to the dashboard", () => {
    expect(isBatchScopedPath("/dashboard")).toBe(false)
    expect(isBatchScopedPath("/admin")).toBe(false)
    expect(isBatchScopedPath("/admin/users")).toBe(false)
    expect(isBatchScopedPath("/profile")).toBe(false)
  })
})

describe("batchNavItems", () => {
  it("links the dashboard, guide and optionally admin", () => {
    expect(batchNavItems(null)).toEqual([
      { href: "/dashboard", label: "Papers", activePrefixes: ["/dashboard"] },
      {
        href: "/decisions",
        label: "My decisions",
        activePrefixes: ["/decisions"],
      },
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
