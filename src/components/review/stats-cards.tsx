import { ShieldAlert } from "lucide-react"

import { SeverityBadge } from "@/components/review/severity-badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatPercent } from "@/lib/review/format"
import type { ReviewStats } from "@/lib/review/stats"
import type { ItemStatus, Severity } from "@/lib/review/types"
import { cn } from "@/lib/utils"

const SEVERITY_VALUES: readonly Severity[] = ["high", "medium", "low"]

const STATUS_DOTS: Readonly<Record<ItemStatus, string>> = {
  open: "bg-muted-foreground/50",
  claimed: "bg-info-foreground",
  unsure: "bg-warning-foreground",
  closed: "bg-success",
}

const STATUS_ORDER: readonly ItemStatus[] = ["open", "claimed", "unsure"]

function SeverityCount({
  severity,
  value,
}: {
  severity: Severity
  value: number
}) {
  return (
    <span className="flex items-center gap-1.5">
      <SeverityBadge severity={severity} />
      <span className="font-heading text-lg leading-none font-medium tabular-nums">
        {value}
      </span>
    </span>
  )
}

function StatusCount({ status, value }: { status: ItemStatus; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", STATUS_DOTS[status])}
      />
      <span className="tabular-nums">{value}</span>
      {status}
    </span>
  )
}

export function StatsCards({
  stats,
  scopeLabel = "All items in the batch.",
  completionLabel = "Batch completion",
}: {
  stats: ReviewStats
  scopeLabel?: string
  completionLabel?: string
}) {
  const remaining = stats.total - stats.closed

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex min-w-64 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-heading text-3xl leading-none font-medium tabular-nums">
                {formatPercent(stats.completion)}
              </span>
              <span className="text-sm text-muted-foreground">
                {stats.closed} of {stats.total} closed
                {remaining > 0 ? ` · ${remaining} remaining` : null}
              </span>
            </div>
            <Progress
              value={stats.completion * 100}
              aria-label={`${completionLabel}: ${formatPercent(stats.completion)}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {SEVERITY_VALUES.map((severity) => (
              <SeverityCount
                key={severity}
                severity={severity}
                value={stats.bySeverity[severity]}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <span>{scopeLabel}</span>
          {STATUS_ORDER.map((status) => (
            <StatusCount
              key={status}
              status={status}
              value={stats.byStatus[status]}
            />
          ))}
          {stats.stale > 0 ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <ShieldAlert data-icon="inline-start" />
              {stats.stale} decision{stats.stale === 1 ? "" : "s"} need a
              re-check because the source changed.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
