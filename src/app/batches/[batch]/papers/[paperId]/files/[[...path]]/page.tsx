import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  File as FileIcon,
  Folder,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatBytes } from "@/lib/review/format"
import { listPaperDirectory } from "@/lib/review/evidence"
import {
  isMissingReviewData,
  loadBatch,
  ReviewDataError,
} from "@/lib/review/load"
import { joinWithin } from "@/lib/review/paths"
import { getUserRole } from "@/lib/review/roles"
import { db } from "@/db"
import { getSession } from "@/lib/session"

interface PageProps {
  params: Promise<{ batch: string; paperId: string; path?: string[] }>
}

function encodePath(relative: string): string {
  return relative.split("/").map(encodeURIComponent).join("/")
}

export default async function PaperFilesPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })
  const { batch: batchId, paperId, path: pathSegments } = await params

  let batch: Awaited<ReturnType<typeof loadBatch>>
  try {
    batch = await loadBatch(batchId)
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

  const paper = batch.papers.find((candidate) => candidate.id === paperId)
  if (!paper) {
    notFound()
  }

  const requested = (pathSegments ?? []).join("/")
  const repo = paper.code.find(
    (candidate) =>
      requested === candidate.dir || requested.startsWith(`${candidate.dir}/`)
  )
  if (!repo) {
    notFound()
  }

  const paperDir = joinWithin(batch.dir, paper.dir)
  if (!paperDir) {
    notFound()
  }
  const listing = await listPaperDirectory(paperDir, batch.dir, requested)
  if (!listing) {
    notFound()
  }

  const basePath = `/batches/${encodeURIComponent(batchId)}/papers/${encodeURIComponent(paperId)}`
  const repoTrailing =
    requested === repo.dir
      ? []
      : requested.slice(repo.dir.length + 1).split("/")
  const parent =
    requested === repo.dir ? null : requested.split("/").slice(0, -1).join("/")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={basePath}
          className={buttonVariants({ variant: "ghost", size: "xs" })}
        >
          <ArrowLeft data-icon="inline-start" />
          {paperId}
        </Link>
        <span aria-hidden>/</span>
        <Link
          href={`${basePath}/files/${encodePath(repo.dir)}`}
          className="truncate font-medium underline-offset-4 hover:underline"
        >
          {repo.name}
        </Link>
        {repoTrailing.map((segment, index) => {
          const cumulative = [
            repo.dir,
            ...repoTrailing.slice(0, index + 1),
          ].join("/")
          const isLast = index === repoTrailing.length - 1
          return (
            <span key={cumulative} className="flex items-center gap-2">
              <ChevronRight aria-hidden className="size-3" />
              {isLast ? (
                <span className="truncate font-medium text-foreground">
                  {segment}
                </span>
              ) : (
                <Link
                  href={`${basePath}/files/${encodePath(cumulative)}`}
                  className="truncate underline-offset-4 hover:underline"
                >
                  {segment}
                </Link>
              )}
            </span>
          )
        })}
      </div>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{repo.role}</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {requested}
          </span>
        </div>
        <h1 className="font-heading text-2xl font-medium">
          Files in {repo.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only local snapshot. PDFs and images open in the browser; other
          formats download.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder data-icon="inline-start" />
            {requested === repo.dir ? repo.name : repoTrailing.join("/")}
          </CardTitle>
          <CardDescription>
            {listing.entries.length} entr
            {listing.entries.length === 1 ? "y" : "ies"}
            {listing.truncated ? ", truncated" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listing.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This directory is empty.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {parent ? (
                <li>
                  <Link
                    href={`${basePath}/files/${encodePath(parent)}`}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <ArrowUp
                      data-icon="inline-start"
                      className="size-4 text-muted-foreground"
                    />
                    <span className="font-medium">Parent directory</span>
                  </Link>
                </li>
              ) : null}
              {listing.entries.map((entry) => {
                const icon =
                  entry.type === "directory" ? (
                    <Folder
                      data-icon="inline-start"
                      className="size-4 text-muted-foreground"
                    />
                  ) : (
                    <FileIcon
                      data-icon="inline-start"
                      className="size-4 text-muted-foreground"
                    />
                  )
                const meta =
                  entry.type === "directory"
                    ? "Directory"
                    : entry.binary
                      ? `Binary · ${formatBytes(entry.size)}`
                      : formatBytes(entry.size)
                const content = (
                  <>
                    {icon}
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">
                      {entry.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {meta}
                    </span>
                  </>
                )
                return (
                  <li key={entry.path}>
                    {entry.type === "directory" ? (
                      <Link
                        href={`${basePath}/files/${encodePath(entry.path)}`}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50"
                      >
                        {content}
                      </Link>
                    ) : (
                      <a
                        href={`/api/evidence/${encodeURIComponent(batchId)}/${encodeURIComponent(paperId)}/${encodePath(entry.path)}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50"
                      >
                        {content}
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
