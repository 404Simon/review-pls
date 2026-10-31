import { describe, expect, it } from "vitest"

import { ReviewDataError } from "@/lib/review/load"
import {
  describeBatchListError,
  describeDataError,
} from "@/lib/review/public-errors"

const rootMissing = new ReviewDataError(
  "ROOT_MISSING",
  "Review data root does not exist or is not readable: /srv/review-data",
  { path: "/srv/review-data" }
)

const batchMissing = new ReviewDataError(
  "BATCH_NOT_FOUND",
  "Batch directory is missing: /srv/review-data/nope",
  { batchId: "nope", path: "/srv/review-data/nope" }
)

const schemaInvalid = new ReviewDataError(
  "SCHEMA_INVALID",
  "batch.json does not match the schema: /srv/review-data/r16/batch.json"
)

describe("describeBatchListError", () => {
  it("shows reviewers an accurate root-missing message without the path", () => {
    const view = describeBatchListError(rootMissing, false)
    expect(view.summary).toContain("review data root is missing")
    expect(view.summary).not.toContain("/srv/review-data")
    expect(view.adminDetails).toBeNull()
  })

  it("keeps loader details for admins", () => {
    const view = describeBatchListError(rootMissing, true)
    expect(view.adminDetails).toContain("ROOT MISSING")
    expect(view.adminDetails).toContain("/srv/review-data")
  })
})

describe("describeDataError", () => {
  it("distinguishes a missing root from a mounted corrupt batch", () => {
    expect(describeDataError(rootMissing)).toEqual({
      title: "The review data root is missing",
      description: expect.stringContaining("REVIEW_DATA_ROOT is not set"),
    })
    expect(describeDataError(schemaInvalid, "r16")).toEqual({
      title: "The review data could not be loaded",
      description: "Batch “r16” is mounted but could not be read.",
    })
  })

  it("explains an unmounted batch without leaking paths", () => {
    const description = describeDataError(batchMissing, "nope")
    expect(description.title).toBe("This batch is not mounted")
    expect(description.description).toContain("nope")
    expect(description.description).not.toContain("/srv/review-data")
  })
})
