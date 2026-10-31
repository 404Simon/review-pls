import { ArrowUpRight } from "lucide-react"
import Link from "next/link"

import { SeverityBadge } from "@/components/review/severity-badge"
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

function StatusChip({ status, count }: { status: ItemStatus; count: number }) {
  if (count === 0) {
    return null
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${STATUS_DOTS[status]}`}
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
          <TableHead className="min-w-64">Paper</TableHead>
          <TableHead className="text-center">High</TableHead>
          <TableHead className="text-center">Medium</TableHead>
          <TableHead className="text-center">Low</TableHead>
          <TableHead className="text-center">Total</TableHead>
          <TableHead className="text-center">
            Clusters / New / Misses / Related
          </TableHead>
          <TableHead className="min-w-40">Progress</TableHead>
          <TableHead className="min-w-40">Status</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Open</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((paper) => {
          const href = paperPath(batchId, paper.id)
          return (
            <TableRow key={paper.id} className="group">
              <TableCell className="min-w-64 whitespace-normal">
                <div className="flex flex-col gap-1">
                  <Link
                    href={href}
                    className="font-medium underline-offset-4 group-hover:underline"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {paper.id}
                    </span>{" "}
                    {paper.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{paper.category}</Badge>
                    {paper.comparisonEligible ? null : (
                      <Badge variant="destructive">
                        Not comparison eligible
                      </Badge>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-center">
                <span
                  aria-label={`${severityCellLabel("high", paper.id)}: ${paper.counts.bySeverity.high}`}
                >
                  <SeverityBadge severity="high" />
                  <span className="ml-1 tabular-nums">
                    {paper.counts.bySeverity.high}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-center">
                <span
                  aria-label={`${severityCellLabel("medium", paper.id)}: ${paper.counts.bySeverity.medium}`}
                >
                  <SeverityBadge severity="medium" />
                  <span className="ml-1 tabular-nums">
                    {paper.counts.bySeverity.medium}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-center">
                <span
                  aria-label={`${severityCellLabel("low", paper.id)}: ${paper.counts.bySeverity.low}`}
                >
                  <SeverityBadge severity="low" />
                  <span className="ml-1 tabular-nums">
                    {paper.counts.bySeverity.low}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-center font-medium tabular-nums">
                {paper.counts.total}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center justify-center gap-1.5 font-mono text-xs tabular-nums">
                  <span title="Match clusters">{paper.counts.clusters}</span>
                  <span className="text-muted-foreground">/</span>
                  <span title="Agent-only findings">
                    {paper.counts.agentOnly}
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span title="AuditOwl-only findings">
                    {paper.counts.auditowlOnly}
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span title="Related-not-matched pairs">
                    {paper.counts.related}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex min-w-36 flex-col gap-1">
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
                </div>
              </TableCell>
              <TableCell>
                <div className="flex max-w-48 flex-wrap gap-x-3 gap-y-1">
                  <StatusChip status="open" count={paper.status.open} />
                  <StatusChip status="claimed" count={paper.status.claimed} />
                  <StatusChip status="unsure" count={paper.status.unsure} />
                  <StatusChip status="closed" count={paper.status.closed} />
                </div>
              </TableCell>
              <TableCell>
                <Link
                  href={href}
                  aria-label={`Open paper ${paper.id}`}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
