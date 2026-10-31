import { AlertTriangle, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { ItemList } from "@/components/review/item-list"
import { PaperActions } from "@/components/review/paper-actions"
import { StatsCards } from "@/components/review/stats-cards"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  normalizeParams,
  parseItemTab,
  parseReviewFilters,
} from "@/lib/review/filters"
import { evidenceFileUrl } from "@/lib/review/evidence"
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
  const paperPdfUrl = evidenceFileUrl(
    batchId,
    paperId,
    paper.manifest.files.paperPdf
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
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{paper.manifest.category}</span>
            <span aria-hidden>·</span>
            <span>AuditOwl {paper.manifest.auditowlStatus}</span>
            <span aria-hidden>·</span>
            <span>
              {paper.counts.total} item
              {paper.counts.total === 1 ? "" : "s"}
            </span>
            {paper.manifest.comparisonEligible ? null : (
              <Badge variant="destructive">Not comparison eligible</Badge>
            )}
          </div>
          <h1 className="max-w-5xl font-heading text-2xl font-medium text-balance sm:text-3xl">
            {paper.manifest.title}
          </h1>
          <PaperActions
            paperPdfUrl={paperPdfUrl}
            repositories={paper.manifest.code}
            filesBase={`${basePath}/files`}
          />
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
      </header>

      <StatsCards
        stats={stats}
        scopeLabel="All items on this paper."
        completionLabel="Paper completion"
      />

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

      <Card>
        <CardHeader>
          <CardTitle>Review items</CardTitle>
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
    </div>
  )
}
