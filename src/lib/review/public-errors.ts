import type { ReviewDataError } from "@/lib/review/load"

export interface PublicDataError {
  /** Reviewer-safe summary. Never contains the mount root or file paths. */
  summary: string
  /** Admin-only details. `null` for reviewers. */
  adminDetails: string | null
}

function adminDetailsFor(error: ReviewDataError): string {
  return [
    error.code.replace(/_/g, " "),
    error.message,
    error.details.path ?? null,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join("\n")
}

/**
 * The dashboard can fail before any batch is loaded (for example when
 * `REVIEW_DATA_ROOT` is missing). Reviewers must not see the absolute mount
 * path from the loader error, so the page renders this generic summary and
 * keeps the raw message in an admin-only block.
 */
export function describeBatchListError(
  error: ReviewDataError,
  isAdmin: boolean
): PublicDataError {
  return {
    summary:
      error.code === "ROOT_MISSING"
        ? "The review data root is missing or unreadable. Ask an administrator to check REVIEW_DATA_ROOT and mount the batch files. The guide explains how a batch is structured."
        : "The review data mount could not be read. Ask an administrator to check REVIEW_DATA_ROOT and the mounted batch files. The guide explains how a batch is structured.",
    adminDetails: isAdmin ? adminDetailsFor(error) : null,
  }
}

export interface DataErrorDescription {
  title: string
  description: string
}

/**
 * Accurate wording for the data-error page. A missing root is not a mounted
 * batch that failed to parse, and an absent batch is not a data-contract error.
 * The raw details stay in the admin-only block rendered by `DataErrorState`.
 */
export function describeDataError(
  error: ReviewDataError,
  batchId?: string
): DataErrorDescription {
  if (error.code === "ROOT_MISSING") {
    return {
      title: "The review data root is missing",
      description:
        "REVIEW_DATA_ROOT is not set, or it points to a directory that is missing or unreadable. Ask an administrator to mount the review data.",
    }
  }
  if (error.code === "BATCH_NOT_FOUND") {
    return {
      title: "This batch is not mounted",
      description: batchId
        ? `No mounted batch directory matches “${batchId}”. Ask an administrator to check REVIEW_DATA_ROOT.`
        : "No mounted batch directory matches this request. Ask an administrator to check REVIEW_DATA_ROOT.",
    }
  }
  return {
    title: "The review data could not be loaded",
    description: batchId
      ? `Batch “${batchId}” is mounted but could not be read.`
      : "The mounted review data could not be read.",
  }
}
