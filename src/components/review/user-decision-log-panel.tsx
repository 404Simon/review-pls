import { Database } from "lucide-react"

import {
  DecisionLog,
  DecisionLogFilterBar,
  DecisionSummary,
} from "@/components/review/decision-log"
import { EmptyState } from "@/components/review/empty-state"
import { normalizeParams } from "@/lib/review/filters"
import {
  matchesDecisionLogFilters,
  parseDecisionLogFilters,
} from "@/lib/review/user-decisions"
import { loadScopedUserDecisionLog } from "@/lib/review/user-decisions-data"

/**
 * The scoped decision log shared by the reviewer page and the admin user page.
 * The batch comes from the header selector.
 */
export async function UserDecisionLogPanel({
  userId,
  basePath,
  searchParams,
  emptyTitle,
  emptyDescription,
}: {
  userId: string
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
  emptyTitle?: string
  emptyDescription?: string
}) {
  const params = normalizeParams(searchParams)
  const filters = parseDecisionLogFilters(searchParams)
  const scope = await loadScopedUserDecisionLog(userId, params.batch ?? "")

  if (scope.batchId === null) {
    return (
      <EmptyState
        icon={Database}
        title={
          scope.unknownBatch
            ? `Batch “${scope.requestedBatchId}” is not mounted`
            : "No review batch is mounted"
        }
        description={
          scope.unknownBatch
            ? "Use the batch selector in the header to pick a mounted batch."
            : "Set REVIEW_DATA_ROOT to a directory containing prepared batch folders, then use the batch selector in the header."
        }
      />
    )
  }

  const entries = scope.log.entries.filter((entry) =>
    matchesDecisionLogFilters(entry, filters)
  )
  const hasEntries = scope.log.entries.length > 0

  return (
    <>
      {hasEntries ? (
        <>
          <DecisionSummary counts={scope.log.counts} />
          <DecisionLogFilterBar
            basePath={basePath}
            params={params}
            filters={filters}
          />
        </>
      ) : null}

      <DecisionLog
        entries={entries}
        total={scope.log.entries.length}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </>
  )
}
