import { describe, expect, it } from "vitest"

import {
  isTourPath,
  parseTourId,
  stripTourParam,
  TOUR_ANCHORS,
  TOUR_IDS,
  TOUR_QUERY_PARAM,
  TOUR_READY_ANCHORS,
  TOURS,
  tourHref,
  tourIdForPath,
  withTourParam,
} from "@/lib/review/tour-routes"

describe("tour paths", () => {
  it("maps reviewer routes to their tour", () => {
    expect(tourIdForPath("/guide")).toBe("guide")
    expect(tourIdForPath("/guide/")).toBe("guide")
    expect(tourIdForPath("/dashboard")).toBe("dashboard")
    expect(
      tourIdForPath("/batches/review-fixture/items/cluster:1001:M01")
    ).toBe("item")
    expect(tourIdForPath("/batches/review-fixture/papers/1001")).toBe("paper")
    expect(tourIdForPath("/batches/review-fixture/papers/1001/")).toBe("paper")
  })

  it("does not match unrelated or partial routes", () => {
    expect(tourIdForPath("/")).toBeNull()
    expect(tourIdForPath("/admin")).toBeNull()
    expect(tourIdForPath("/guides")).toBeNull()
    expect(tourIdForPath("/batches/review-fixture/papers")).toBeNull()
    expect(
      tourIdForPath("/batches/review-fixture/papers/1001/extra")
    ).toBeNull()
    expect(isTourPath("/dashboard")).toBe(true)
    expect(isTourPath("/sign-in")).toBe(false)
    // Files and profile no longer have tours.
    expect(tourIdForPath("/profile")).toBeNull()
    expect(
      tourIdForPath("/batches/review-fixture/papers/1001/files/code/repo")
    ).toBeNull()
  })

  it("parses known tour ids and rejects everything else", () => {
    for (const id of TOUR_IDS) {
      expect(parseTourId(id)).toBe(id)
    }
    expect(parseTourId(null)).toBeNull()
    expect(parseTourId(undefined)).toBeNull()
    expect(parseTourId("")).toBeNull()
    expect(parseTourId("admin")).toBeNull()
  })
})

describe("tour hrefs", () => {
  it("provides static hrefs only for pages without required ids", () => {
    expect(tourHref("guide")).toBe("/guide")
    expect(tourHref("dashboard")).toBe("/dashboard")
    expect(tourHref("paper")).toBeNull()
    expect(tourHref("item")).toBeNull()
  })

  it("adds the tour param while preserving query and hash", () => {
    expect(withTourParam("/paper", "paper")).toBe("/paper?tour=paper")
    expect(withTourParam("/dashboard?batch=a", "dashboard")).toBe(
      "/dashboard?batch=a&tour=dashboard"
    )
    expect(withTourParam("/dashboard?batch=a#papers", "dashboard")).toBe(
      "/dashboard?batch=a&tour=dashboard#papers"
    )
    expect(withTourParam("/dashboard?tour=old", "item")).toBe(
      "/dashboard?tour=item"
    )
  })

  it("strips only the transient tour key", () => {
    expect(stripTourParam(`?${TOUR_QUERY_PARAM}=paper`)).toBe("")
    expect(stripTourParam(`?${TOUR_QUERY_PARAM}=paper&batch=a`)).toBe(
      "?batch=a"
    )
    expect(stripTourParam("?batch=a&tour=item&q=seed")).toBe("?batch=a&q=seed")
    expect(stripTourParam("")).toBe("")
    expect(stripTourParam("?batch=a")).toBe("?batch=a")
  })
})

describe("tour metadata", () => {
  it("describes every tour and uses unique anchor names", () => {
    for (const id of TOUR_IDS) {
      expect(TOURS[id].label.length).toBeGreaterThan(0)
      expect(TOURS[id].description.length).toBeGreaterThan(0)
    }

    const anchors = Object.values(TOUR_ANCHORS)
    expect(new Set(anchors).size).toBe(anchors.length)
  })

  it("has a readiness anchor for every tour", () => {
    for (const id of TOUR_IDS) {
      expect(Object.values(TOUR_ANCHORS)).toContain(TOUR_READY_ANCHORS[id])
    }
  })
})
