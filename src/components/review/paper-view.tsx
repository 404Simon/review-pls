"use client"

import { ExternalLink, FileQuestion, FileText, Search } from "lucide-react"
import { useId, useState, type FormEvent } from "react"

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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { PaperEvidence } from "@/lib/review/evidence"

interface SearchResult {
  path: string | null
  url: string | null
  line: number
  excerpt: string
  repo: string | null
  page: number | null
}

function isSearchResult(value: unknown): value is SearchResult {
  if (typeof value !== "object" || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.line === "number" &&
    typeof candidate.excerpt === "string" &&
    (candidate.page === null || typeof candidate.page === "number")
  )
}

function parseSearchResponse(
  value: unknown
): { results: SearchResult[]; truncated: boolean } | null {
  if (typeof value !== "object" || value === null) {
    return null
  }
  const candidate = value as Record<string, unknown>
  if (
    !Array.isArray(candidate.results) ||
    !candidate.results.every(isSearchResult) ||
    typeof candidate.truncated !== "boolean"
  ) {
    return null
  }
  return { results: candidate.results, truncated: candidate.truncated }
}

/** One shared PDF viewer per item; findings only link to their own pages. */
export function PaperPdfViewer({ url, page }: { url: string; page: number }) {
  return (
    <iframe
      key={url}
      src={`${url}#page=${page}&zoom=page-width`}
      title="Paper PDF"
      className="h-[32rem] w-full rounded-md border bg-muted/20"
    />
  )
}

export function PaperView({
  evidence,
  batchId,
  paperId,
  activePage,
  onShowPage,
}: {
  evidence: PaperEvidence
  batchId: string
  paperId: string
  activePage: number
  onShowPage: ((page: number) => void) | null
}) {
  const searchId = useId()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const linkPage = evidence.pages.includes(activePage)
    ? activePage
    : (evidence.pages[0] ?? 1)

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (trimmed === "") {
      setResults(null)
      setTruncated(false)
      setError(null)
      return
    }
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/search?batch=${encodeURIComponent(batchId)}&paper=${encodeURIComponent(paperId)}&scope=paper&q=${encodeURIComponent(trimmed)}`
      )
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : "Paper search failed."
        setError(message)
        setResults(null)
        setTruncated(false)
        return
      }
      const parsed = parseSearchResponse(payload)
      if (!parsed) {
        setError("The search response was malformed.")
        setResults(null)
        setTruncated(false)
        return
      }
      setResults(parsed.results)
      setTruncated(parsed.truncated)
    } catch {
      setError("Paper search failed.")
      setResults(null)
      setTruncated(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <FileText data-icon="inline-start" />
            {evidence.paperRef ?? "No paper reference recorded"}
            {evidence.pages.map((page) => (
              <Badge key={page} variant="outline">
                p. {page}
              </Badge>
            ))}
          </CardTitle>
          {evidence.quote ? (
            <CardDescription className="font-mono text-xs whitespace-pre-wrap">
              {evidence.quote}
            </CardDescription>
          ) : (
            <CardDescription>
              The finding does not quote the paper.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {evidence.pages.length > 0 && evidence.pdfAvailable && onShowPage ? (
            <div className="flex flex-wrap gap-2">
              {evidence.pages.map((page) => (
                <Button
                  key={page}
                  type="button"
                  size="xs"
                  variant={page === activePage ? "secondary" : "outline"}
                  onClick={() => onShowPage(page)}
                >
                  Show page {page}
                </Button>
              ))}
            </div>
          ) : null}

          {evidence.paperTextTruncated ? (
            <p className="text-xs text-muted-foreground">
              The extracted text is larger than 8 MB; only the first 8 MB was
              read and searched.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {evidence.pdfUrl ? (
              <a
                href={`${evidence.pdfUrl}#page=${linkPage}&zoom=page-width`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "xs" })}
              >
                <ExternalLink data-icon="inline-start" />
                Open PDF at page {linkPage}
              </a>
            ) : null}
            {evidence.paperTextUrl ? (
              <a
                href={evidence.paperTextUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "xs" })}
              >
                <FileText data-icon="inline-start" />
                Open full text
              </a>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {evidence.contexts.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Quote context in the paper</CardTitle>
            <CardDescription>
              ±200 characters around the finding quote in the extracted text.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {evidence.contexts.map((context) => (
              <div key={context.offset} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">page {context.page}</Badge>
                  {evidence.pdfAvailable && onShowPage ? (
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={() => onShowPage(context.page)}
                    >
                      Find in PDF
                    </Button>
                  ) : null}
                </div>
                <p className="rounded-md border bg-muted/20 p-3 text-xs leading-relaxed">
                  {context.before}
                  <mark className="bg-accent px-0.5 text-accent-foreground">
                    {context.match}
                  </mark>
                  {context.after}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Search the paper text</CardTitle>
          <CardDescription>
            Case-insensitive search over the extracted text.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex gap-2" onSubmit={search}>
            <label htmlFor={searchId} className="sr-only">
              Search the paper text
            </label>
            <Input
              id={searchId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. ablation, seed, Table 4"
              className="flex-1"
            />
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Search data-icon="inline-start" />
              )}
              Search
            </Button>
          </form>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Search failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {results ? (
            results.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matches in the paper text.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {results.map((result, index) => (
                  <li
                    key={`${result.line}-${index}`}
                    className="flex flex-col gap-1 rounded-md border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>line {result.line}</span>
                      {result.page !== null ? (
                        <span>· page {result.page}</span>
                      ) : null}
                      {result.page !== null &&
                      evidence.pdfAvailable &&
                      onShowPage ? (
                        <Button
                          type="button"
                          variant="link"
                          size="xs"
                          onClick={() => onShowPage(result.page ?? 1)}
                        >
                          Find in PDF
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-xs whitespace-pre-wrap">
                      {result.excerpt}
                    </p>
                  </li>
                ))}
              </ol>
            )
          ) : null}
          {truncated ? (
            <p className="text-xs text-muted-foreground">
              Results are capped; refine the query to see fewer matches.
              {evidence.paperTextTruncated
                ? " Only the first 8 MB of the extracted text was searched."
                : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

export function MissingPaperPdf() {
  return (
    <Alert>
      <FileQuestion />
      <AlertTitle>PDF not available</AlertTitle>
      <AlertDescription>
        The paper PDF is missing from this batch. Use the extracted text below
        instead.
      </AlertDescription>
    </Alert>
  )
}
