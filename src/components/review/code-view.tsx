"use client"

import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  FileSearch,
  FolderTree,
  Link2,
  Quote,
  Search,
} from "lucide-react"
import { useState } from "react"

import { GithubIcon } from "@/components/review/github-icon"
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

/**
 * The raw quote is the fallback evidence: it is shown when the cited file
 * could not be resolved, or when the quote does not line up with the cited
 * lines. A quote that matches the file exactly is already visible in the
 * preview, so rendering it again would duplicate the same code.
 */
function CitedQuote({
  quote,
  collapsible = false,
}: {
  quote: string
  collapsible?: boolean
}) {
  if (!collapsible) {
    return (
      <figure className="flex flex-col gap-1">
        <figcaption className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Quote data-icon="inline-start" />
          Cited quote
        </figcaption>
        <blockquote className="rounded-md border-l-2 border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
          {quote}
        </blockquote>
      </figure>
    )
  }

  const lines = quote.replace(/\r\n?/g, "\n").split("\n").length
  return (
    <details className="rounded-md border bg-muted/20">
      <summary className="flex cursor-pointer items-center gap-1 px-3 py-2 text-xs font-medium text-muted-foreground select-none">
        <Quote data-icon="inline-start" />
        Cited quote · {lines} line{lines === 1 ? "" : "s"}
      </summary>
      <blockquote className="border-t p-3 font-mono text-xs whitespace-pre-wrap">
        {quote}
      </blockquote>
    </details>
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
        {evidence.quote ? <CitedQuote quote={evidence.quote} /> : null}
        {evidence.closestMatches.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Closest matches</p>
            <ul className="flex flex-col gap-1">
              {evidence.closestMatches.map((match) => (
                <li key={match.path} className="text-xs">
                  <a
                    href={match.url}
                    target="_blank"
                    rel="noreferrer noopener"
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
          {evidence.githubRepoUrl ? (
            <a
              href={evidence.githubRepoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <GithubIcon data-icon="inline-start" />
              Browse repository
              {evidence.githubCommit
                ? ` at ${evidence.githubCommit.slice(0, 7)}`
                : ""}
            </a>
          ) : null}
          {evidence.treeUrl ? (
            <a
              href={evidence.treeUrl}
              target="_blank"
              rel="noreferrer noopener"
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
              rel="noreferrer noopener"
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
        <CardContent className="flex flex-col gap-3">
          {evidence.quote ? <CitedQuote quote={evidence.quote} /> : null}
          <a
            href={evidence.externalUrl ?? evidence.raw}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink data-icon="inline-start" />
            Open source
          </a>
        </CardContent>
      </Card>
    )
  }

  const showCitedQuote =
    evidence.quote !== null &&
    (evidence.preview === null || evidence.quoteMatch !== "exact")

  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-sm break-all">
            {evidence.relativePath ?? evidence.raw}
          </CardTitle>
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
        {evidence.note ? (
          <p className="text-xs text-muted-foreground">{evidence.note}</p>
        ) : null}

        {showCitedQuote && evidence.quote ? (
          <CitedQuote quote={evidence.quote} collapsible />
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
              {showCitedQuote
                ? "The cited file could not be shown; the recorded quote above is the evidence."
                : "Open the full file to inspect it."}
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
          {evidence.githubFileUrl ? (
            <a
              href={evidence.githubFileUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <GithubIcon data-icon="inline-start" />
              View on GitHub
            </a>
          ) : (
            <>
              {evidence.fileUrl ? (
                <a
                  href={evidence.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={buttonVariants({ variant: "outline", size: "xs" })}
                >
                  <FileSearch data-icon="inline-start" />
                  Open file
                </a>
              ) : null}
              {evidence.searchUrl ? (
                <a
                  href={evidence.searchUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={buttonVariants({ variant: "outline", size: "xs" })}
                >
                  <Search data-icon="inline-start" />
                  Search repo
                </a>
              ) : null}
            </>
          )}
          <CopyPathButton value={evidence.relativePath ?? evidence.raw} />
        </div>
      </CardContent>
    </Card>
  )
}
