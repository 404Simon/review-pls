import { AlertTriangle, BookOpen, RotateCcw } from "lucide-react"
import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ReviewDataError } from "@/lib/review/load"
import { describeDataError } from "@/lib/review/public-errors"

/**
 * A mounted batch with a broken manifest is an operational data error, not a
 * missing page. Reviewers get a generic message; absolute paths, hashes and
 * loader internals stay in the admin-only details block.
 */
export function DataErrorState({
  error,
  batchId,
  isAdmin = false,
}: {
  error: ReviewDataError
  batchId?: string
  isAdmin?: boolean
}) {
  const description = describeDataError(error, batchId)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle data-icon="inline-start" />
          {description.title}
        </CardTitle>
        <CardDescription>{description.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Data contract error</AlertTitle>
          <AlertDescription>
            This page is unavailable until an administrator checks the mounted
            batch. Nothing was changed.
          </AlertDescription>
        </Alert>
        {isAdmin ? (
          <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">
              Admin details
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              <p className="font-mono">{error.code.replace(/_/g, " ")}</p>
              <p className="break-words">{error.message}</p>
              {error.details.path ? (
                <p className="font-mono break-all">{error.details.path}</p>
              ) : null}
              {error.details.batchId ? (
                <p className="font-mono">batch: {error.details.batchId}</p>
              ) : null}
              {error.details.paperId ? (
                <p className="font-mono">paper: {error.details.paperId}</p>
              ) : null}
            </div>
          </details>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: "outline" })}
          >
            <RotateCcw data-icon="inline-start" />
            Back to papers
          </Link>
          <Link href="/guide" className={buttonVariants({ variant: "ghost" })}>
            <BookOpen data-icon="inline-start" />
            Read the data contract
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
