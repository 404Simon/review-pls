"use client"

import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileSearch,
  FolderTree,
  Link2,
  Search,
} from "lucide-react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { CodeEvidence } from "@/lib/review/evidence"
import { formatLineRange } from "@/lib/review/format"
import { cn } from "@/lib/utils"

const QUOTE_STYLES = {
  exact: "bg-secondary text-secondary-foreground ring-1 ring-border",
  fuzzy: "bg-muted text-muted-foreground ring-1 ring-border",
  missing: "bg-destructive/10 text-destructive ring-1 ring-destructive/20",
  not_checkable: "bg-muted text-muted-foreground ring-1 ring-border",
} as const

const QUOTE_LABELS = {
  exact: "quote exact",
  fuzzy: "quote fuzzy",
  missing: "quote missing",
  not_checkable: "quote not checkable",
} as const

export function QuoteMatchBadge({
  quoteMatch,
}: {
  quoteMatch: CodeEvidence["quoteMatch"]
}) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", QUOTE_STYLES[quoteMatch])}
    >
      {QUOTE_LABELS[quoteMatch]}
    </Badge>
  )
}

function CopyPathButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={copy}
      aria-label={copied ? "Path copied" : "Copy path"}
    >
      {copied ? (
        <Check data-icon="inline-start" />
      ) : (
        <Copy data-icon="inline-start" />
      )}
      {copied ? "Copied" : "Copy path"}
    </Button>
  )
}

function MissingCode({ evidence }: { evidence: CodeEvidence }) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <AlertTriangle
            className="text-destructive"
            data-icon="inline-start"
          />
          Missing code anchor
        </CardTitle>
        <CardDescription className="font-mono break-all">
          {evidence.raw}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {evidence.note ?? "The cited path was not found in the batch."}
        </p>
        {evidence.closestMatches.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Closest matches</p>
            <ul className="flex flex-col gap-1">
              {evidence.closestMatches.map((match) => (
                <li key={match.path} className="text-xs">
                  <a
                    href={match.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono break-all underline underline-offset-4"
                  >
                    {match.path}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {evidence.missingAttempts.length > 0 ? (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {evidence.missingAttempts.length} resolution attempt
              {evidence.missingAttempts.length === 1 ? "" : "s"}
            </summary>
            <ol className="mt-2 flex flex-col gap-1.5">
              {evidence.missingAttempts.map((attempt, index) => (
                <li
                  key={`${attempt.step}-${attempt.path}-${index}`}
                  className="flex flex-wrap items-baseline gap-2 text-xs"
                >
                  <Badge variant="outline">{attempt.outcome}</Badge>
                  <span className="font-medium">{attempt.step}</span>
                  <span className="font-mono break-all text-muted-foreground">
                    {attempt.path || "(none)"}
                  </span>
                  {attempt.note ? (
                    <span className="text-muted-foreground">
                      {attempt.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {evidence.treeUrl ? (
            <a
              href={evidence.treeUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <FolderTree data-icon="inline-start" />
              Open tree
            </a>
          ) : null}
          {evidence.searchUrl ? (
            <a
              href={evidence.searchUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <Search data-icon="inline-start" />
              Search repo
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function CodeView({ evidence }: { evidence: CodeEvidence }) {
  if (evidence.kind === "missing") {
    return <MissingCode evidence={evidence} />
  }

  if (evidence.kind === "url") {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 data-icon="inline-start" />
            External source
          </CardTitle>
          <CardDescription className="font-mono break-all">
            {evidence.raw}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={evidence.externalUrl ?? evidence.raw}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink data-icon="inline-start" />
            Open source
          </a>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-sm break-all">
            {evidence.relativePath ?? evidence.raw}
          </CardTitle>
          <QuoteMatchBadge quoteMatch={evidence.quoteMatch} />
          {evidence.preview?.truncated ? (
            <Badge variant="outline">truncated</Badge>
          ) : null}
        </div>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {evidence.repo ? (
            <span>
              repo <span className="font-medium">{evidence.repo}</span>
              {evidence.commit ? (
                <>
                  {" · "}
                  <span className="font-mono" title={evidence.commit}>
                    {evidence.commit.slice(0, 10)}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
          <span>{formatLineRange(evidence.lineStart, evidence.lineEnd)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {evidence.quote ? (
          <blockquote className="rounded-md border-l-2 border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {evidence.quote}
          </blockquote>
        ) : null}

        {evidence.note ? (
          <p className="text-xs text-muted-foreground">{evidence.note}</p>
        ) : null}

        {evidence.preview ? (
          <div className="max-h-[26rem] overflow-auto rounded-md border bg-muted/20">
            <pre className="min-w-max py-2 font-mono text-xs leading-relaxed">
              {evidence.preview.lines.map((line) => (
                <div
                  key={line.number}
                  className={cn(
                    "flex",
                    line.cited && "bg-accent/70 text-accent-foreground"
                  )}
                >
                  <span className="sticky left-0 w-12 shrink-0 border-r bg-inherit pr-2 text-right text-muted-foreground select-none">
                    {line.number}
                  </span>
                  <span className="pl-3 whitespace-pre">
                    {line.text || " "}
                  </span>
                </div>
              ))}
            </pre>
          </div>
        ) : (
          <Alert>
            <AlertTriangle />
            <AlertTitle>No inline preview</AlertTitle>
            <AlertDescription>
              Open the full file to inspect it.
            </AlertDescription>
          </Alert>
        )}

        {evidence.preview ? (
          <p className="text-xs text-muted-foreground">
            Showing lines {evidence.preview.startLine}–
            {evidence.preview.endLine}
            {evidence.preview.truncated
              ? ` of the first ${evidence.preview.totalLines} readable lines (file or excerpt capped)`
              : ` of ${evidence.preview.totalLines}`}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {evidence.fileUrl ? (
            <a
              href={evidence.fileUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <FileSearch data-icon="inline-start" />
              Open full file
            </a>
          ) : null}
          {evidence.treeUrl ? (
            <a
              href={evidence.treeUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <FolderTree data-icon="inline-start" />
              Open repo tree
            </a>
          ) : null}
          {evidence.searchUrl ? (
            <a
              href={evidence.searchUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <Search data-icon="inline-start" />
              Search repo
            </a>
          ) : null}
          <CopyPathButton value={evidence.relativePath ?? evidence.raw} />
        </div>
      </CardContent>
    </Card>
  )
}
