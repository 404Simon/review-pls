"use client"

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileWarning,
} from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MarkdownContent } from "@/components/review/markdown-content"
import type { CheckEvidence } from "@/lib/review/evidence"
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
      <p className="text-xs text-muted-foreground">
        {rows.length} of {totalRows} row{totalRows === 1 ? "" : "s"}
        {truncated ? " (only the first 100 rows are loaded)" : ""}
        {needle === "" ? "" : ` matching “${filter.trim()}”`}. The filter
        applies to the displayed rows; matching reference rows are highlighted.
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
                rel="noreferrer"
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
      <pre className="max-h-[24rem] overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap">
        {check.text}
      </pre>
    )
  }

  return null
}

export function CheckView({ checks }: { checks: CheckEvidence[] }) {
  if (checks.length === 0) {
    return (
      <Alert>
        <AlertTriangle />
        <AlertTitle>No check artifacts</AlertTitle>
        <AlertDescription>
          This finding does not name a check script or a checked path.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Tabs defaultValue="check-0">
      <TabsList variant="line" className="w-full flex-wrap justify-start">
        {checks.map((check, index) => (
          <TabsTrigger
            key={`${check.raw}-${index}`}
            value={`check-${index}`}
            className="flex-none"
          >
            {check.format === "url" ? (
              <ExternalLink className="text-muted-foreground" />
            ) : check.resolved ? (
              <CheckCircle2 className="text-muted-foreground" />
            ) : (
              <FileWarning className="text-destructive" />
            )}
            <span className="max-w-48 truncate">{check.label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {checks.map((check, index) => (
        <TabsContent
          key={`${check.raw}-${index}`}
          value={`check-${index}`}
          className="pt-3"
        >
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm break-all">
                {check.raw}
                {check.format === "url" ? (
                  <Badge variant="outline">external URL</Badge>
                ) : (
                  <Badge variant={check.resolved ? "secondary" : "destructive"}>
                    {check.resolved ? "resolved" : "missing"}
                  </Badge>
                )}
                {check.truncated ? (
                  <Badge variant="outline">truncated</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                {formatBytes(check.size)}
                {check.note ? ` · ${check.note}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <CheckBody check={check} />
              {check.url && check.format !== "url" ? (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-4"
                >
                  Open full artifact
                </a>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  )
}
