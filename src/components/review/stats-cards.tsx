import {
  CheckCircle2,
  CircleDot,
  CircleDashed,
  CircleHelp,
  Gauge,
  Layers,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react"

import { SeverityBadge } from "@/components/review/severity-badge"
import { StatusBadge } from "@/components/review/status-badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatPercent } from "@/lib/review/format"
import type { ReviewStats } from "@/lib/review/stats"

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-heading text-2xl leading-none font-medium tabular-nums">
        {value}
      </span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
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
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge data-icon="inline-start" />
            Overall progress
          </CardTitle>
          <CardDescription>
            {stats.closed} of {stats.total} items closed
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-2">
            <span className="font-heading text-4xl leading-none font-medium tabular-nums">
              {formatPercent(stats.completion)}
            </span>
            <span className="text-sm text-muted-foreground">
              {stats.total - stats.closed} remaining
            </span>
          </div>
          <Progress
            value={stats.completion * 100}
            aria-label={`${completionLabel}: ${formatPercent(stats.completion)}`}
          />
          {stats.stale > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <ShieldAlert data-icon="inline-start" />
              {stats.stale} decision{stats.stale === 1 ? "" : "s"} need a
              re-check because the source changed.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers data-icon="inline-start" />
            Severity mix
          </CardTitle>
          <CardDescription>{scopeLabel}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2">
            <SeverityBadge severity="high" />
            <span className="font-heading text-2xl leading-none font-medium tabular-nums">
              {stats.bySeverity.high}
            </span>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2">
            <SeverityBadge severity="medium" />
            <span className="font-heading text-2xl leading-none font-medium tabular-nums">
              {stats.bySeverity.medium}
            </span>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2">
            <SeverityBadge severity="low" />
            <span className="font-heading text-2xl leading-none font-medium tabular-nums">
              {stats.bySeverity.low}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDot data-icon="inline-start" />
            Review state
          </CardTitle>
          <CardDescription>Live status across all reviewers.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status="open" />
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              <CircleDashed
                data-icon="inline-start"
                className="text-muted-foreground"
              />
              {stats.byStatus.open}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status="claimed" />
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              <CircleHelp
                data-icon="inline-start"
                className="text-info-foreground"
              />
              {stats.byStatus.claimed}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status="unsure" />
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              <TriangleAlert
                data-icon="inline-start"
                className="text-warning-foreground"
              />
              {stats.byStatus.unsure}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge status="closed" />
            <span className="flex items-center gap-1.5 text-sm tabular-nums">
              <CheckCircle2 data-icon="inline-start" className="text-success" />
              {stats.byStatus.closed}
            </span>
          </div>
          <Metric label="Total items" value={stats.total} />
        </CardContent>
      </Card>
    </div>
  )
}
