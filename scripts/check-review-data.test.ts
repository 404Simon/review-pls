import { describe, expect, it } from "vitest"

import { comparePaperCounts } from "./check-review-data"

const counts = {
  high: 3,
  medium: 6,
  low: 4,
  total: 13,
  clusters: 5,
  agentOnly: 8,
  auditowlOnly: 0,
  related: 0,
}

describe("comparePaperCounts", () => {
  it("accepts matching expected and manifest counts", () => {
    expect(comparePaperCounts("1171", counts, counts, counts)).toEqual([])
  })

  it("compares each batch.json severity, not only the total", () => {
    const manifest = { ...counts, high: 2, medium: 7 }
    const failures = comparePaperCounts("1171", counts, counts, manifest)
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("bySeverity.high"),
        expect.stringContaining("bySeverity.medium"),
      ])
    )
  })

  it("compares the expected per-paper counts", () => {
    const failures = comparePaperCounts(
      "1171",
      counts,
      { ...counts, total: 14 },
      counts
    )
    expect(failures).toEqual(
      expect.arrayContaining([expect.stringContaining("expected 14, got 13")])
    )
  })

  it("reports an unexpected included paper", () => {
    expect(comparePaperCounts("9999", counts, undefined, counts)).toEqual([
      "unexpected included paper 9999",
    ])
  })
})
