import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  GitBranch,
  Layers,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { ItemList } from "@/components/review/item-list"
import { SeverityBadge } from "@/components/review/severity-badge"
import { StatsCards } from "@/components/review/stats-cards"
import { StatusBadge } from "@/components/review/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  normalizeParams,
  parseItemTab,
  parseReviewFilters,
} from "@/lib/review/filters"
import { formatItemKind } from "@/lib/review/format"
import { ITEM_KINDS } from "@/lib/review/ids"
import {
  isMissingReviewData,
  loadPaper,
  ReviewDataError,
} from "@/lib/review/load"
import { getUserRole } from "@/lib/review/roles"
import { computePaperStats } from "@/lib/review/stats"
import { loadBatchReviewView } from "@/lib/review/ui-data"
import { db } from "@/db"
import { getSession } from "@/lib/session"

interface PageProps {
  params: Promise<{ batch: string; paperId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PaperPage({ params, searchParams }: PageProps) {
  const session = await getSession()
  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })
  const { batch: batchId, paperId } = await params
  const rawParams = await searchParams
  const query = normalizeParams(rawParams)
  const filters = parseReviewFilters(rawParams)
  const tab = parseItemTab(query.tab ?? "all")

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

  const paper = view.loaded.papers.find(
    (candidate) => candidate.manifest.id === paperId
  )
  if (!paper) {
    notFound()
  }

  let loadedPaper: Awaited<ReturnType<typeof loadPaper>>
  try {
    loadedPaper = await loadPaper(batchId, paperId)
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

  const statusCounts = countItemStatuses(paper.items, view.states)
  const stats = computePaperStats(
    {
      batchId,
      items: view.loaded.items,
      decisions: view.decisions,
      claims: view.claims,
      manifestSha256: view.loaded.batch.manifestSha256,
      now: view.now,
    },
    paperId
  )
  const caveats = loadedPaper.overlap.caveats ?? []
  const caveatCount =
    caveats.length +
    (paper.manifest.scopeNote ? 1 : 0) +
    (paper.manifest.comparisonEligible ? 0 : 1)
  const revisionMismatches = (loadedPaper.overlap.repositories ?? []).filter(
    (repository) =>
      repository.revision_match === false ||
      (repository.auditowl_commit !== null &&
        repository.auditowl_commit !== undefined &&
        repository.agent_commit !== null &&
        repository.agent_commit !== undefined &&
        repository.auditowl_commit !== repository.agent_commit)
  )
  const basePath = `/batches/${encodeURIComponent(batchId)}/papers/${encodeURIComponent(paperId)}`

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={`/dashboard?batch=${encodeURIComponent(batchId)}`}
          className={buttonVariants({ variant: "ghost", size: "xs" })}
        >
          <ArrowLeft data-icon="inline-start" />
          Papers
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-xs">{paperId}</span>
      </div>

      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{paper.manifest.category}</Badge>
            <Badge variant="outline">{paper.manifest.auditowlStatus}</Badge>
            <Badge
              variant={
                paper.manifest.comparisonEligible ? "secondary" : "destructive"
              }
            >
              <ShieldCheck data-icon="inline-start" />
              {paper.manifest.comparisonEligible
                ? "Comparison eligible"
                : "Not comparison eligible"}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              paper {paperId}
            </span>
          </div>
          <h1 className="max-w-5xl font-heading text-2xl font-medium text-balance sm:text-3xl">
            {paper.manifest.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {paper.counts.total} review item
            {paper.counts.total === 1 ? "" : "s"} across {ITEM_KINDS.length}{" "}
            item kinds. Tabs count the whole paper; filters narrow the list.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {ITEM_KINDS.map((kind) => (
            <Badge key={kind} variant="outline">
              {formatItemKind(kind)} {paper.counts.byKind[kind].total}
            </Badge>
          ))}
          <StatusBadge status="open" />
          <span className="text-xs text-muted-foreground">
            {statusCounts.open}
          </span>
          <StatusBadge status="claimed" />
          <span className="text-xs text-muted-foreground">
            {statusCounts.claimed}
          </span>
          <StatusBadge status="unsure" />
          <span className="text-xs text-muted-foreground">
            {statusCounts.unsure}
          </span>
          <StatusBadge status="closed" />
          <span className="text-xs text-muted-foreground">
            {statusCounts.closed}
          </span>
        </div>

        {caveats.length > 0 ||
        paper.manifest.scopeNote ||
        !paper.manifest.comparisonEligible ? (
          <details className="rounded-xl border bg-card">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
              <AlertTriangle
                data-icon="inline-start"
                className="text-warning-foreground"
              />
              Caveats and scope
              <Badge variant="outline">
                {caveatCount} note{caveatCount === 1 ? "" : "s"}
              </Badge>
            </summary>
            <div className="border-t px-4 py-3">
              <Alert className="border-0 bg-transparent px-0">
                <AlertTriangle />
                <AlertTitle>Read before judging overlap</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {paper.manifest.scopeNote ? (
                      <li>{paper.manifest.scopeNote}</li>
                    ) : null}
                    {!paper.manifest.comparisonEligible ? (
                      <li>
                        This paper is not comparison eligible. Treat matches as
                        informational and focus on the findings themselves.
                      </li>
                    ) : null}
                    {caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          </details>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch data-icon="inline-start" />
                Repositories and revisions
              </CardTitle>
              <CardDescription>
                Evidence paths resolve inside these snapshots. Commits are
                display-only.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {paper.manifest.code.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No code repositories were bundled with this paper. Evidence
                  will fall back to checks, paper text and reports.
                </p>
              ) : (
                paper.manifest.code.map((repo) => (
                  <div
                    key={repo.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {repo.name}
                      </span>
                      <span className="font-mono text-xs break-all text-muted-foreground">
                        {repo.dir}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{repo.role}</Badge>
                      <Badge variant="secondary" className="font-mono">
                        {repo.commit ? repo.commit.slice(0, 12) : "no revision"}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers data-icon="inline-start" />
                Severity
              </CardTitle>
              <CardDescription>
                Severity is the maximum of both sides where applicable.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
              {(["high", "medium", "low"] as const).map((severity) => (
                <div
                  key={severity}
                  className="flex flex-col gap-2 rounded-lg border px-3 py-2"
                >
                  <SeverityBadge severity={severity} />
                  <span className="font-heading text-2xl leading-none font-medium tabular-nums">
                    {paper.counts.bySeverity[severity]}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </header>

      {revisionMismatches.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Repository revision mismatch</AlertTitle>
          <AlertDescription>
            <p>
              The comparator and the review agent read different revisions for{" "}
              {revisionMismatches.length} repositor
              {revisionMismatches.length === 1 ? "y" : "ies"}. Treat overlap
              labels for those paths as provisional until the difference is
              checked.
            </p>
            <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">
              {revisionMismatches.map((repository) => (
                <li key={repository.name}>
                  {repository.name}:{" "}
                  {repository.auditowl_commit?.slice(0, 12) ?? "unknown"} vs{" "}
                  {repository.agent_commit?.slice(0, 12) ?? "unknown"}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <StatsCards
        stats={stats}
        scopeLabel="All items on this paper."
        completionLabel="Paper completion"
      />

      <Card>
        <CardHeader>
          <CardTitle>Review items</CardTitle>
          <CardDescription>
            Open any item to read its evidence and record a decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemList
            batchId={batchId}
            basePath={basePath}
            params={query}
            items={paper.items}
            states={view.states}
            reviewerNames={view.reviewerNames}
            currentUserId={session.user.id}
            filters={filters}
            tab={tab}
            focusSearch={query.focus === "search"}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <ExternalLink data-icon="inline-start" />
        Evidence opens inside the item page. The paper PDF stays behind the
        authenticated evidence route.
      </div>
    </div>
  )
}
