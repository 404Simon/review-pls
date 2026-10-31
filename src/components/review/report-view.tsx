"use client"

import { ExternalLink, FileWarning } from "lucide-react"

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
import { MarkdownContent } from "@/components/review/markdown-content"
import type { ReportEvidence } from "@/lib/review/evidence"
import { formatSide } from "@/lib/review/format"

export function ReportView({ report }: { report: ReportEvidence }) {
  if (!report.available) {
    return (
      <Alert>
        <FileWarning />
        <AlertTitle>{formatSide(report.side)} report unavailable</AlertTitle>
        <AlertDescription>
          {report.note ?? "The audit report is missing from this batch."}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {formatSide(report.side)} audit report
          <Badge variant="outline">
            lines {report.startLine}–{report.endLine}
          </Badge>
          {report.truncated ? <Badge variant="outline">excerpt</Badge> : null}
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {report.relativePath ?? report.label} · {report.totalLines} lines
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MarkdownContent content={report.excerpt} />
        {report.note ? (
          <p className="text-xs text-muted-foreground">{report.note}</p>
        ) : null}
        {report.url ? (
          <a
            href={report.url}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline", size: "xs" })}
          >
            <ExternalLink data-icon="inline-start" />
            Open full report
          </a>
        ) : null}
      </CardContent>
    </Card>
  )
}
