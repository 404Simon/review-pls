import { buildReviewData } from "@/lib/review/build"
import { itemPath, paperPath } from "@/lib/review/filters"
import {
  listBatches,
  loadBatch,
  loadPaper,
  ReviewDataError,
  type ReviewDataOptions,
} from "@/lib/review/load"
import type { PaperManifest } from "@/lib/review/types"

const MAX_BATCHES = 3
const MAX_PAPERS = 3

export interface GuideExample {
  paperTitle: string
  itemTitle: string
  paperHref: string
  itemHref: string
}

/**
 * `PaperManifest` has per-kind counts but no precomputed total. The guide ranks
 * papers by how much there is to review, not by how it is split.
 */
export function declaredPaperTotal(counts: PaperManifest["counts"]): number {
  return (
    counts.clusters + counts.agentOnly + counts.auditowlOnly + counts.related
  )
}

/**
 * Prefer papers that can actually be compared and have reviewable items. Ties
 * fall back to the paper id so the guide example is stable between loads.
 */
export function rankGuidePapers(
  papers: readonly PaperManifest[]
): PaperManifest[] {
  return papers
    .filter((paper) => declaredPaperTotal(paper.counts) > 0)
    .sort((a, b) => {
      if (a.comparisonEligible !== b.comparisonEligible) {
        return a.comparisonEligible ? -1 : 1
      }
      const totalDifference =
        declaredPaperTotal(b.counts) - declaredPaperTotal(a.counts)
      if (totalDifference !== 0) {
        return totalDifference
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * Pick one real paper and item for the guide's tours and links. Missing or
 * unreadable batches are skipped; only data errors are swallowed, because a
 * programming error should still surface.
 */
export async function loadGuideExample(
  options?: ReviewDataOptions
): Promise<GuideExample | null> {
  let summaries: Awaited<ReturnType<typeof listBatches>>
  try {
    summaries = await listBatches(options)
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return null
    }
    throw error
  }

  const healthy = summaries
    .filter((batch) => batch.error === undefined)
    .slice(0, MAX_BATCHES)

  for (const summary of healthy) {
    let batch: Awaited<ReturnType<typeof loadBatch>>
    try {
      batch = await loadBatch(summary.batchId, options)
    } catch (error) {
      if (error instanceof ReviewDataError) {
        continue
      }
      throw error
    }

    for (const candidate of rankGuidePapers(batch.papers).slice(
      0,
      MAX_PAPERS
    )) {
      try {
        const loaded = await loadPaper(summary.batchId, candidate.id, options)
        const built = buildReviewData({
          papers: [
            {
              manifest: loaded.manifest,
              overlap: loaded.overlap,
              agentFindings: loaded.agentFindings,
              auditowlFindings: loaded.auditowlFindings,
            },
          ],
        })
        const item =
          built.items.find((entry) => entry.kind === "cluster") ??
          built.items[0]
        if (!item) {
          continue
        }

        return {
          paperTitle: loaded.manifest.title,
          itemTitle: item.title,
          paperHref: paperPath(summary.batchId, candidate.id),
          itemHref: itemPath(summary.batchId, item.id),
        }
      } catch (error) {
        if (error instanceof ReviewDataError) {
          continue
        }
        throw error
      }
    }
  }

  return null
}
