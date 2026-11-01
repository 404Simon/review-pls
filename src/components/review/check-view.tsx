"use client"

import { ExternalLink, FileWarning, ScrollText, Terminal } from "lucide-react"
import { useId, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MarkdownContent } from "@/components/review/markdown-content"
import type { CheckEvidence, CheckRole } from "@/lib/review/evidence"
import { formatBytes } from "@/lib/review/format"
import { cn } from "@/lib/utils"

function CsvView({ check }: { check: CheckEvidence }) {
  const filterId = useId()
  const [filter, setFilter] = useState("")
  const table = check.csv
  if (!table) {
    return null
  }
  const { columns, totalRows, truncated } = table
  const needle = filter.trim().toLowerCase()
  const rows =
    needle === ""
      ? table.rows
      : table.rows.filter((row) =>
          row.cells.some((cell) => cell.toLowerCase().includes(needle))
        )
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={filterId} className="sr-only">
          Filter CSV rows
        </label>
        <Input
          id={filterId}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter displayed rows by any cell…"
        />
      </div>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={`${column}-${index}`}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow
                key={rowIndex}
                className={cn(row.highlight && "bg-accent/60")}
              >
                {columns.map((_, columnIndex) => (
                  <TableCell
                    key={columnIndex}
                    className="max-w-[32rem] truncate font-mono text-xs"
                    title={row.cells[columnIndex]}
                  >
                    {row.cells[columnIndex] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {rows.length} of {totalRows} row{totalRows === 1 ? "" : "s"}
        {truncated ? " (only the first 100 rows are loaded)" : ""}
        {needle === "" ? "" : ` matching “${filter.trim()}”`}.
      </p>
    </div>
  )
}

function CheckBody({ check }: { check: CheckEvidence }) {
  if (check.format === "missing") {
    return (
      <Alert>
        <FileWarning />
        <AlertTitle>Artifact not found</AlertTitle>
        <AlertDescription>
          <span className="font-mono break-all">{check.raw}</span>
          {check.note ? ` — ${check.note}` : null}
          {check.missingAttempts.length > 0 ? (
            <ol className="mt-2 flex flex-col gap-1 text-xs">
              {check.missingAttempts.map((attempt, index) => (
                <li key={`${attempt.step}-${attempt.path}-${index}`}>
                  <span className="font-medium">{attempt.step}</span>{" "}
                  <span className="font-mono break-all">
                    {attempt.path || "(none)"}
                  </span>{" "}
                  <span>{attempt.note ?? attempt.outcome}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }

  if (check.format === "binary") {
    return (
      <Alert>
        <FileWarning />
        <AlertTitle>Binary artifact</AlertTitle>
        <AlertDescription>
          {check.note ?? "Download the artifact to inspect it."}
        </AlertDescription>
      </Alert>
    )
  }

  if (check.format === "url") {
    return (
      <Alert>
        <ExternalLink />
        <AlertTitle>External URL artifact</AlertTitle>
        <AlertDescription>
          <span className="font-mono break-all">{check.raw}</span>
          {check.note ? ` — ${check.note}` : null}
          {check.url ? (
            <span className="mt-2 block">
              <a
                href={check.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4"
              >
                Open external artifact
              </a>
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }

  if (check.format === "csv" && check.csv) {
    return <CsvView check={check} />
  }

  if (check.format === "markdown" && check.text !== null) {
    return <MarkdownContent content={check.text} />
  }

  if (check.text !== null) {
    return (
      <pre className="max-h-60 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap">
        {check.text}
      </pre>
    )
  }

  return null
}

const ROLE_LABELS: Record<CheckRole, string> = {
  output: "output",
  script: "script",
  artifact: "artifact",
}

const ROLE_RANK: Record<CheckRole, number> = {
  output: 0,
  artifact: 1,
  script: 2,
}

function CheckCard({ check }: { check: CheckEvidence }) {
  const isScript = check.role === "script"
  const showBodyImmediately = !isScript || !check.resolved

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm break-all">
          {isScript ? (
            <Terminal data-icon="inline-start" />
          ) : (
            <ScrollText data-icon="inline-start" />
          )}
          {check.label}
          <Badge variant="outline">{ROLE_LABELS[check.role]}</Badge>
          {check.format === "url" ? (
            <Badge variant="outline">external URL</Badge>
          ) : isScript ? null : (
            <Badge variant={check.resolved ? "secondary" : "destructive"}>
              {check.resolved ? "resolved" : "missing"}
            </Badge>
          )}
          {check.truncated ? <Badge variant="outline">truncated</Badge> : null}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="font-mono break-all">{check.raw}</span>
          <span>{formatBytes(check.size)}</span>
          {check.note ? <span>· {check.note}</span> : null}
        </CardDescription>
      </CardHeader>

      {showBodyImmediately ? (
        <CardContent className="flex flex-col gap-3">
          <CheckBody check={check} />
          {check.url && check.format !== "url" ? (
            <a
              href={check.url}
              target="_blank"
              rel="noreferrer noopener"
              className="w-fit text-xs underline underline-offset-4"
            >
              Open full artifact
            </a>
          ) : null}
        </CardContent>
      ) : (
        <details className="border-t">
          <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted-foreground select-none">
            Show script source
          </summary>
          <div className="px-4 pb-4">
            <CheckBody check={check} />
          </div>
        </details>
      )}
    </Card>
  )
}

/**
 * Check evidence is shown output-first: the artifact that supports the claim is
 * expanded, while the script itself stays available but collapsed.
 */
export function CheckView({ checks }: { checks: CheckEvidence[] }) {
  if (checks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No check script or output is recorded for this finding.
      </p>
    )
  }

  const ordered = [...checks].sort(
    (a, b) =>
      ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.label.localeCompare(b.label)
  )

  return (
    <div className="flex flex-col gap-3">
      {ordered.map((check, index) => (
        <CheckCard key={`${check.raw}-${index}`} check={check} />
      ))}
    </div>
  )
}
