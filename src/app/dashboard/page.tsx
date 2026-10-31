import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  Database,
  PlayCircle,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { EmptyState } from "@/components/review/empty-state"
import { FilterBar } from "@/components/review/filter-bar"
import { PaperTable, type PaperTableRow } from "@/components/review/paper-table"
import { StatsCards } from "@/components/review/stats-cards"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  countItemStatuses,
  itemPath,
  matchesReviewFilters,
  parseReviewFilters,
  normalizeParams,
  queryFromFilters,
  queuePath,
  withQuery,
} from "@/lib/review/filters"
import { db } from "@/db"
import { formatPercent, formatTimestamp } from "@/lib/review/format"
import {
  isMissingReviewData,
  listBatches,
  ReviewDataError,
} from "@/lib/review/load"
import { getUserRole } from "@/lib/review/roles"
import { describeBatchListError } from "@/lib/review/public-errors"
import { computeBatchStats } from "@/lib/review/stats"
import { loadBatchReviewView } from "@/lib/review/ui-data"
import type { ReviewItem, Severity } from "@/lib/review/types"
import { getSession } from "@/lib/session"

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function formatDetail(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed !== "none" ? trimmed : "Not set"
}

function matchingItems(
  items: readonly ReviewItem[],
  states: Awaited<ReturnType<typeof loadBatchReviewView>>["states"],
  filters: ReturnType<typeof parseReviewFilters>,
  userId: string
): ReviewItem[] {
  return items.filter((item) => {
    const state = states[item.id]
    return state ? matchesReviewFilters(item, state, filters, userId) : false
  })
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  const { user } = session
  const role = await getUserRole(user, { db })
  const firstName = user.name.trim().split(/\s+/)[0] || user.email
  const rawParams = await searchParams
  const params = normalizeParams(rawParams)
  const filters = parseReviewFilters(rawParams)

  let batches: Awaited<ReturnType<typeof listBatches>> = []
  let batchListError: ReviewDataError | null = null
  try {
    batches = await listBatches()
  } catch (error) {
    if (error instanceof ReviewDataError) {
      batchListError = error
    } else {
      throw error
    }
  }

  const selectable = batches.filter((batch) => batch.error === undefined)
  const batchListErrorView = batchListError
    ? describeBatchListError(batchListError, role === "admin")
    : null
  const requestedBatch = params.batch ?? ""
  const requested = requestedBatch
    ? batches.find((batch) => batch.batchId === requestedBatch)
    : undefined
  const unknownRequestedBatch = requestedBatch !== "" && requested === undefined
  const activeBatch = unknownRequestedBatch
    ? null
    : (requested ?? selectable[0] ?? batches[0] ?? null)

  const details = [
    { label: "Name", value: user.name },
    { label: "Email", value: user.email },
    { label: "Association", value: user.association },
    { label: "Title", value: user.title },
  ]

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium text-balance">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Review overlap and new findings, then close each item with evidence in
          view.
        </p>
      </div>

      {activeBatch === null ? (
        <>
          <EmptyState
            icon={Database}
            title={
              unknownRequestedBatch && !batchListErrorView
                ? `Batch “${requestedBatch}” is not mounted`
                : "No review batch is mounted"
            }
            description={
              batchListErrorView
                ? batchListErrorView.summary
                : unknownRequestedBatch
                  ? "The batch in the URL is not available. Open the dashboard without ?batch= to use the first mounted batch, or choose another batch in the header."
                  : "Set REVIEW_DATA_ROOT to a directory containing prepared batch folders, then reload. The guide explains how a batch is structured."
            }
            action={
              <Link
                href="/guide"
                className={buttonVariants({ variant: "outline" })}
              >
                <BookOpen data-icon="inline-start" />
                Read the guide
              </Link>
            }
          />
          {batchListErrorView?.adminDetails ? (
            <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Admin details
              </summary>
              <p className="mt-2 font-mono break-words whitespace-pre-wrap">
                {batchListErrorView.adminDetails}
              </p>
            </details>
          ) : null}
        </>
      ) : (
        <DashboardBatch
          batchId={activeBatch.batchId}
          batchLabel={activeBatch.label}
          userId={user.id}
          isAdmin={role === "admin"}
          filters={filters}
          params={params}
          batchOptions={batches.map((batch) => ({
            value: batch.batchId,
            label: batch.error ? `${batch.label} (data error)` : batch.label,
          }))}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card id="profile">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              The details you gave when you registered.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              {details.map((detail) => (
                <div key={detail.label} className="flex flex-col gap-1">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {detail.label}
                  </dt>
                  <dd className="truncate text-sm">
                    {formatDetail(detail.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to review</CardTitle>
            <CardDescription>A calm, repeatable loop.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="flex items-start gap-2">
              <PlayCircle
                data-icon="inline-start"
                className="mt-0.5 text-muted-foreground"
              />
              Reserve one item, read the evidence, and record the verdict that
              the evidence supports.
            </p>
            <p className="flex items-start gap-2">
              <ClipboardList
                data-icon="inline-start"
                className="mt-0.5 text-muted-foreground"
              />
              Use the note field for your reasoning. The comparator is a hint,
              never a decision.
            </p>
            <Link
              href="/guide"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open the protocol guide
              <ArrowRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

async function DashboardBatch({
  batchId,
  batchLabel,
  userId,
  isAdmin,
  filters,
  params,
  batchOptions,
}: {
  batchId: string
  batchLabel: string
  userId: string
  isAdmin: boolean
  filters: ReturnType<typeof parseReviewFilters>
  params: Record<string, string>
  batchOptions: readonly { value: string; label: string }[]
}) {
  let view: Awaited<ReturnType<typeof loadBatchReviewView>>
  try {
    view = await loadBatchReviewView(batchId, userId)
  } catch (error) {
    if (!(error instanceof ReviewDataError)) {
      throw error
    }
    if (isMissingReviewData(error)) {
      notFound()
    }
    return <DataErrorState error={error} batchId={batchId} isAdmin={isAdmin} />
  }

  const { loaded, states, decisions, claims, reviewerNames, now } = view
  const generatedAt = new Date(loaded.batch.manifest.generatedAt).getTime()
  const stats = computeBatchStats({
    batchId,
    items: loaded.items,
    decisions,
    claims,
    manifestSha256: loaded.batch.manifestSha256,
    now,
  })

  const visibleItems = matchingItems(loaded.items, states, filters, userId)
  const visiblePapers = new Set(visibleItems.map((item) => item.paperId))

  const rows: PaperTableRow[] = loaded.papers.map((paper) => {
    const status = countItemStatuses(paper.items, states)
    return {
      id: paper.manifest.id,
      title: paper.manifest.title,
      category: paper.manifest.category,
      comparisonEligible: paper.manifest.comparisonEligible,
      counts: {
        total: paper.counts.total,
        bySeverity: paper.counts.bySeverity,
        clusters: paper.counts.clusters,
        agentOnly: paper.counts.agentOnly,
        auditowlOnly: paper.counts.auditowlOnly,
        related: paper.counts.related,
      },
      status,
      completion:
        paper.counts.total === 0 ? 0 : status.closed / paper.counts.total,
    }
  })

  const filteredRows = rows.filter((row) => visiblePapers.has(row.id))

  const claimed = loaded.items
    .filter((item) => states[item.id]?.claim?.userId === userId)
    .sort((a, b) => {
      const claimA = states[a.id]?.claim
      const claimB = states[b.id]?.claim
      return (claimB?.lastSeenAt ?? 0) - (claimA?.lastSeenAt ?? 0)
    })
  const nextOpen = loaded.items.find(
    (item) => states[item.id]?.status === "open"
  )
  const resumeItem = claimed[0] ?? nextOpen ?? null
  const preserved = queryFromFilters(filters)

  const severityOrder: readonly Severity[] = ["high", "medium", "low"]
  const activeFilterLabels = [
    filters.severity !== "all" ? `severity ${filters.severity}` : null,
    filters.kind !== "all" ? `type ${filters.kind.replace(/_/g, " ")}` : null,
    filters.status !== "all" ? `status ${filters.status}` : null,
    filters.mine ? "only mine" : null,
    filters.search !== "" ? `search “${filters.search}”` : null,
  ].filter((label): label is string => label !== null)

  return (
    <div className="flex flex-col gap-4">
      <StatsCards stats={stats} />

      <FilterBar
        basePath="/dashboard"
        params={params}
        fields={[
          {
            key: "batch",
            label: "Batch",
            value: params.batch ?? batchId,
            options: batchOptions,
          },
          {
            key: "severity",
            label: "Severity",
            value: filters.severity,
            options: [
              { value: "all", label: "All severities" },
              ...severityOrder.map((severity) => ({
                value: severity,
                label: severity[0].toUpperCase() + severity.slice(1),
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
            key: "status",
            label: "Status",
            value: filters.status,
            options: [
              { value: "all", label: "All statuses" },
              { value: "open", label: "Open" },
              { value: "claimed", label: "Claimed" },
              { value: "unsure", label: "Unsure" },
              { value: "closed", label: "Closed" },
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
          label: "Search items",
          placeholder: "Title, ref or paper id",
        }}
      />

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>Papers</CardTitle>
              <CardDescription>
                {batchLabel} · sorted by high, then medium, then total items.
                Headline counts above cover the whole batch; each paper row
                counts the whole paper even while filters hide papers or items.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {resumeItem ? (
                <Link
                  href={withQuery(itemPath(batchId, resumeItem.id), preserved)}
                  className={buttonVariants({ size: "sm" })}
                >
                  <PlayCircle data-icon="inline-start" />
                  {claimed[0] ? "Resume reserved item" : "Start next item"}
                </Link>
              ) : null}
              <Link
                href={withQuery(queuePath(batchId), preserved)}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                })}
              >
                <ClipboardList data-icon="inline-start" />
                Open queue
              </Link>
            </div>
          </div>
          {activeFilterLabels.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Filtering:</span>
              {activeFilterLabels.map((label) => (
                <Badge key={label} variant="outline">
                  {label}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground">
                {filteredRows.length} of {rows.length} papers match
              </span>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="px-0">
          {filteredRows.length === 0 ? (
            <div className="px-4">
              <EmptyState
                icon={ClipboardList}
                title="No papers match these filters"
                description="Reset the filters above, or open the queue for a single severity-sorted worklist."
              />
            </div>
          ) : (
            <PaperTable batchId={batchId} papers={filteredRows} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Batch provenance</CardTitle>
          <CardDescription>
            Mounted at{" "}
            {Number.isNaN(generatedAt)
              ? "an unknown time"
              : formatTimestamp(generatedAt)}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Papers
            </span>
            <span>{loaded.papers.length} included</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Excluded
            </span>
            <span>{loaded.excluded.length}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Completion
            </span>
            <span>{formatPercent(stats.completion)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Reviewer names known
            </span>
            <span>{Object.keys(reviewerNames).length}</span>
          </div>
          {loaded.issues.length > 0 ? (
            <p className="text-destructive sm:col-span-2 lg:col-span-4">
              {loaded.issues.length} data validation issue
              {loaded.issues.length === 1 ? "" : "s"} found while building this
              batch. Open the guide for the data contract.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
