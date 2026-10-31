import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPercent } from "@/lib/review/format"
import { paperPath } from "@/lib/review/filters"
import type { ItemStatus, SeverityCounts } from "@/lib/review/types"
import { cn } from "@/lib/utils"

export interface PaperTableRow {
  id: string
  title: string
  category: string
  comparisonEligible: boolean
  counts: {
    total: number
    bySeverity: SeverityCounts
    clusters: number
    agentOnly: number
    auditowlOnly: number
    related: number
  }
  status: Record<ItemStatus, number>
  completion: number
}

const STATUS_DOTS: Readonly<Record<ItemStatus, string>> = {
  open: "bg-muted-foreground/50",
  claimed: "bg-info-foreground",
  unsure: "bg-warning-foreground",
  closed: "bg-success",
}

const SEVERITY_TEXT: Readonly<Record<keyof SeverityCounts, string>> = {
  high: "text-destructive",
  medium: "text-warning-foreground",
  low: "text-info-foreground",
}

const STATUS_ORDER: readonly ItemStatus[] = [
  "open",
  "claimed",
  "unsure",
  "closed",
]

function StatusChip({ status, count }: { status: ItemStatus; count: number }) {
  if (count === 0) {
    return null
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", STATUS_DOTS[status])}
      />
      {count} {status}
    </span>
  )
}

function severityCellLabel(severity: keyof SeverityCounts, paperId: string) {
  return `${severity[0].toUpperCase()}${severity.slice(1)} severity items in paper ${paperId}`
}

export function PaperTable({
  batchId,
  papers,
}: {
  batchId: string
  papers: readonly PaperTableRow[]
}) {
  const sorted = [...papers].sort((a, b) => {
    if (a.counts.bySeverity.high !== b.counts.bySeverity.high) {
      return b.counts.bySeverity.high - a.counts.bySeverity.high
    }
    if (a.counts.bySeverity.medium !== b.counts.bySeverity.medium) {
      return b.counts.bySeverity.medium - a.counts.bySeverity.medium
    }
    if (a.counts.total !== b.counts.total) {
      return b.counts.total - a.counts.total
    }
    return a.id.localeCompare(b.id)
  })

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Paper</TableHead>
          <TableHead className="w-32 min-w-32 sm:w-72 sm:min-w-40">
            Progress
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((paper) => {
          const href = paperPath(batchId, paper.id)
          return (
            <TableRow key={paper.id} className="group">
              <TableCell className="whitespace-normal">
                <div className="flex flex-col gap-0.5">
                  <Link
                    href={href}
                    className="font-medium underline-offset-4 group-hover:underline"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {paper.id}
                    </span>{" "}
                    {paper.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{paper.category}</span>
                    {(["high", "medium", "low"] as const).map((severity) => {
                      const count = paper.counts.bySeverity[severity]
                      return (
                        <span
                          key={severity}
                          aria-label={`${severityCellLabel(severity, paper.id)}: ${count}`}
                          className={cn(
                            "tabular-nums",
                            count === 0
                              ? "text-muted-foreground/50"
                              : SEVERITY_TEXT[severity]
                          )}
                        >
                          {count} {severity}
                        </span>
                      )
                    })}
                    {paper.comparisonEligible ? null : (
                      <Badge variant="destructive">
                        Not comparison eligible
                      </Badge>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 flex-col gap-1.5 sm:min-w-40">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatPercent(paper.completion)}</span>
                    <span className="tabular-nums">
                      {paper.status.closed}/{paper.counts.total}
                    </span>
                  </div>
                  <Progress
                    value={paper.completion * 100}
                    aria-label={`Paper ${paper.id} completion: ${formatPercent(paper.completion)}`}
                  />
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {STATUS_ORDER.map((status) => (
                      <StatusChip
                        key={status}
                        status={status}
                        count={paper.status[status]}
                      />
                    ))}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
