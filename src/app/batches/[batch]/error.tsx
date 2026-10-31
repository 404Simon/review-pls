"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function BatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle data-icon="inline-start" />
          This review page could not be loaded
        </CardTitle>
        <CardDescription>
          The batch data or the review database returned an unexpected error.
          Nothing was changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          The page failed unexpectedly. Nothing was changed. Reload and try
          again; if it keeps happening, tell an administrator.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs break-all text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
          <Link
            href="/dashboard"
            className={buttonVariants({ variant: "outline" })}
          >
            Back to papers
          </Link>
          <Link href="/guide" className={buttonVariants({ variant: "ghost" })}>
            Read the guide
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
