import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { ItemList } from "@/components/review/item-list"
import { StatsCards } from "@/components/review/stats-cards"
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
  normalizeParams,
  parseItemTab,
  parseReviewFilters,
} from "@/lib/review/filters"
import { evidenceFileUrl } from "@/lib/review/evidence"
import { githubTreeUrl } from "@/lib/review/github"
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
        <div className="flex flex-wrap items-start justify-between gap-4">
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
          </div>
          <a
            href={`${paperPdfUrl}#zoom=page-width`}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonVariants({ size: "sm" })}
          >
            <FileText data-icon="inline-start" />
            Open PDF
          </a>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch data-icon="inline-start" />
            Repositories
          </CardTitle>
          <CardDescription>
            GitHub links open the reviewed commit. Local snapshots open in the
            file browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {paper.manifest.code.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No code repositories were bundled with this paper. Evidence will
              fall back to checks, paper text and reports.
            </p>
          ) : (
            paper.manifest.code.map((repo) => {
              const githubRef = {
                name: repo.name,
                url: repo.url,
                commit: repo.commit,
              }
              const githubUrl =
                repo.role === "repository" ? githubTreeUrl(githubRef) : null
              const filesUrl = `${basePath}/files/${repo.dir
                .split("/")
                .map(encodeURIComponent)
                .join("/")}`
              const shortCommit = repo.commit?.slice(0, 12)
              return (
                <div
                  key={repo.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    {githubUrl ? (
                      <a
                        href={githubUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={`Open on GitHub at ${shortCommit}`}
                        aria-label={`Open ${repo.name} on GitHub at ${shortCommit}`}
                        className="flex min-w-0 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                      >
                        <GitBranch
                          data-icon="inline-start"
                          className="shrink-0"
                        />
                        <span className="truncate">{repo.name}</span>
                        <ExternalLink
                          data-icon="inline-end"
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      </a>
                    ) : (
                      <Link
                        href={filesUrl}
                        title={`Browse ${repo.name} files`}
                        aria-label={`Browse ${repo.name} files`}
                        className="flex min-w-0 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                      >
                        <Folder data-icon="inline-start" className="shrink-0" />
                        <span className="truncate">{repo.name}</span>
                      </Link>
                    )}
                    <span className="font-mono text-xs break-all text-muted-foreground">
                      {repo.dir}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{repo.role}</Badge>
                    {githubUrl && shortCommit ? (
                      <Badge
                        variant="secondary"
                        className="font-mono"
                        render={
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={`Open tree at ${repo.commit} on GitHub`}
                            aria-label={`Open tree at ${shortCommit} on GitHub`}
                          />
                        }
                      >
                        {shortCommit}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="font-mono">
                        {repo.commit ? repo.commit.slice(0, 12) : "no revision"}
                      </Badge>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

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
