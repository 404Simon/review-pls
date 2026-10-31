import { ClipboardList, FilterX, Inbox } from "lucide-react"
import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { EmptyState } from "@/components/review/empty-state"
import { FilterBar } from "@/components/review/filter-bar"
import { QueueTable, type QueueRow } from "@/components/review/queue-table"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  itemPath,
  matchesReviewFilters,
  normalizeParams,
  parseReviewFilters,
  queryFromFilters,
  withQuery,
} from "@/lib/review/filters"
import { loadBatchReviewView } from "@/lib/review/ui-data"
import { isMissingReviewData, ReviewDataError } from "@/lib/review/load"
import { getUserRole } from "@/lib/review/roles"
import { db } from "@/db"
import { getSession } from "@/lib/session"

interface PageProps {
  params: Promise<{ batch: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function QueuePage({ params, searchParams }: PageProps) {
  const session = await getSession()
  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })
  const { batch: batchId } = await params
  const rawParams = await searchParams
  const query = normalizeParams(rawParams)
  const filters = parseReviewFilters(rawParams)
  const paperFilter =
    query.paper === undefined || query.paper === "all" ? "" : query.paper

  let view: Awaited<ReturnType<typeof loadBatchReviewView>>
  try {
    view = await loadBatchReviewView(batchId, session.user.id)
  } catch (error) {
    if (error instanceof ReviewDataError) {
      if (isMissingReviewData(error)) {
        notFound()
      }
      return (
        <DataErrorState
          error={error}
          batchId={batchId}
          isAdmin={role === "admin"}
        />
      )
    }
    throw error
  }

  const titles = new Map(
    view.loaded.papers.map((paper) => [paper.manifest.id, paper.manifest.title])
  )

  const items = view.loaded.items.filter((item) => {
    if (paperFilter !== "" && item.paperId !== paperFilter) {
      return false
    }
    const state = view.states[item.id]
    return state
      ? matchesReviewFilters(item, state, filters, session.user.id, {
          hideClosedWhenAll: true,
        })
      : false
  })

  const readOnly = filters.status === "closed"
  const hrefParams = {
    ...queryFromFilters(filters),
    paper: paperFilter,
    from: "queue",
  }
  const rows: QueueRow[] = items.flatMap((item) => {
    const state = view.states[item.id]
    if (!state) {
      return []
    }
    return [
      {
        item,
        state,
        paperTitle: titles.get(item.paperId) ?? item.paperId,
        href: withQuery(itemPath(batchId, item.id), hrefParams),
      },
    ]
  })

  const activeFilters =
    paperFilter !== "" ||
    filters.severity !== "all" ||
    filters.kind !== "all" ||
    filters.status !== "all" ||
    filters.mine ||
    filters.search !== ""

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-medium text-balance">
            Queue
          </h1>
          <Badge variant="outline">
            <ClipboardList data-icon="inline-start" />
            {rows.length} visible
          </Badge>
          {readOnly ? (
            <Badge variant="secondary">Read-only closed view</Badge>
          ) : null}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every item in the batch, sorted by severity. Closed items are hidden
          by default; choose <span className="font-medium">Closed</span> to
          inspect them read-only.
        </p>
      </header>

      <FilterBar
        basePath={`/batches/${encodeURIComponent(batchId)}/queue`}
        params={query}
        focusSearch={query.focus === "search"}
        fields={[
          {
            key: "paper",
            label: "Paper",
            value: paperFilter === "" ? "all" : paperFilter,
            options: [
              { value: "all", label: "All papers" },
              ...view.loaded.papers.map((paper) => ({
                value: paper.manifest.id,
                label: `${paper.manifest.id} · ${paper.manifest.title}`,
              })),
            ],
          },
          {
            key: "kind",
            label: "Type",
            value: filters.kind,
            options: [
              { value: "all", label: "All types" },
              { value: "cluster", label: "Match cluster" },
              { value: "agent_only", label: "Agent-only" },
              { value: "auditowl_only", label: "AuditOwl-only" },
              { value: "related", label: "Related pair" },
            ],
          },
          {
            key: "severity",
            label: "Severity",
            value: filters.severity,
            options: [
              { value: "all", label: "All severities" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
          },
          {
            key: "status",
            label: "Status",
            value: filters.status,
            options: [
              { value: "all", label: "All open work" },
              { value: "open", label: "Open" },
              { value: "claimed", label: "Claimed" },
              { value: "unsure", label: "Unsure" },
              { value: "closed", label: "Closed (read-only)" },
            ],
          },
          {
            key: "mine",
            label: "Assignment",
            value: filters.mine ? "mine" : "all",
            options: [
              { value: "all", label: "Anyone" },
              { value: "mine", label: "Only mine" },
            ],
          },
        ]}
        search={{
          value: filters.search,
          label: "Search the queue",
          placeholder: "Title, summary, ref or paper id",
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Severity queue</CardTitle>
          <CardDescription>
            {readOnly
              ? "Closed items are shown for inspection. Reopen them from the item page if you are an admin."
              : "Reserve an item to edit it. Leases last two hours and extend while the item page is open."}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <div className="px-4">
              <EmptyState
                icon={activeFilters ? FilterX : Inbox}
                title={
                  activeFilters
                    ? "No items match these filters"
                    : "The queue is clear"
                }
                description={
                  activeFilters
                    ? "Reset the filters to see the whole queue, or choose a different paper."
                    : "Every item in this view is closed. Open the paper table to review progress or choose Closed to inspect decisions."
                }
              />
            </div>
          ) : (
            <QueueTable
              batchId={batchId}
              rows={rows}
              reviewerNames={view.reviewerNames}
              currentUserId={session.user.id}
              readOnly={readOnly}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
