import { ClipboardList, ShieldAlert } from "lucide-react"
import Link from "next/link"

import { EmptyState } from "@/components/review/empty-state"
import { FilterBar } from "@/components/review/filter-bar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  describeDecision,
  formatDecisionEventStatus,
} from "@/lib/review/decision-format"
import { itemPath } from "@/lib/review/filters"
import { formatItemKind, formatTimestamp } from "@/lib/review/format"
import type {
  DecisionLogFilters,
  DecisionLogStatus,
  UserDecisionCounts,
  UserDecisionLogEntry,
} from "@/lib/review/user-decisions"
const STATUS_VARIANTS: Readonly<
  Record<DecisionLogStatus, "default" | "secondary" | "destructive" | "outline">
> = {
  closed: "default",
  unsure: "secondary",
  draft: "outline",
  reopened: "destructive",
}

export function DecisionLogFilterBar({
  basePath,
  params,
  filters,
}: {
  basePath: string
  params: Record<string, string>
  filters: DecisionLogFilters
}) {
  return (
    <FilterBar
      basePath={basePath}
      params={params}
      fields={[
        {
          key: "status",
          label: "Decision status",
          value: filters.status,
          options: [
            { value: "all", label: "All statuses" },
            { value: "closed", label: "Closed" },
            { value: "unsure", label: "Unsure" },
            { value: "draft", label: "Drafts" },
            { value: "reopened", label: "Reopened" },
          ],
        },
        {
          key: "kind",
          label: "Item type",
          value: filters.kind,
          options: [
            { value: "all", label: "All types" },
            { value: "cluster", label: "Match cluster" },
            { value: "agent_only", label: "Agent-only" },
            { value: "auditowl_only", label: "AuditOwl-only" },
            { value: "related", label: "Related pair" },
          ],
        },
      ]}
      search={{
        value: filters.search,
        label: "Search decisions",
        placeholder: "Title, ref or paper",
      }}
    />
  )
}

const SUMMARY_METRICS: ReadonlyArray<{
  key: keyof UserDecisionCounts
  label: string
}> = [
  { key: "closed", label: "Closed" },
  { key: "unsure", label: "Unsure" },
  { key: "drafts", label: "Drafts" },
  { key: "reopened", label: "Reopened" },
]

export function DecisionSummary({ counts }: { counts: UserDecisionCounts }) {
  return (
    <Card size="sm" className="w-fit max-w-full py-0">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1.5">
        <span className="font-heading text-sm font-medium">Summary</span>
        {SUMMARY_METRICS.map(({ key, label }) => (
          <span key={key} className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{counts[key]}</span>
          </span>
        ))}
      </CardContent>
    </Card>
  )
}

export function DecisionLog({
  entries,
  total,
  emptyTitle = "No decisions yet",
  emptyDescription = "Open an item and save a decision. Drafts, closed decisions and unsure markers all appear here.",
}: {
  /** Entries after filters have been applied. */
  entries: readonly UserDecisionLogEntry[]
  /** Unfiltered entry count, used to distinguish empty from filtered empty. */
  total: number
  emptyTitle?: string
  emptyDescription?: string
}) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        {entries.length === 0 ? (
          <div className="px-4">
            <EmptyState
              icon={ClipboardList}
              title={
                total === 0 ? emptyTitle : "No decisions match these filters"
              }
              description={
                total === 0
                  ? emptyDescription
                  : "Reset the filters above to see every decision again."
              }
            />
          </div>
        ) : (
          <Table className="min-w-[80rem] table-fixed">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[18%]" />
              <col className="w-[20%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <DecisionLogRow key={entry.key} entry={entry} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function DecisionLogRow({ entry }: { entry: UserDecisionLogEntry }) {
  const summary = describeDecision(entry.itemKind, entry.payload)
  const details = summary.details.join(" · ")

  return (
    <TableRow className="h-14">
      <TableCell>
        <div className="flex min-w-0 flex-col gap-0.5">
          {entry.item ? (
            <Link
              href={itemPath(entry.batchId, entry.item.id)}
              title={entry.item.title}
              className="block truncate font-medium hover:underline"
            >
              {entry.item.title}
            </Link>
          ) : (
            <span className="block truncate font-medium">
              {formatItemKind(entry.itemKind)} {entry.itemRef}
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {entry.paperId} · {formatItemKind(entry.itemKind)} {entry.itemRef}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium" title={summary.verdict}>
            {summary.verdict}
          </span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={details || undefined}
          >
            {details || "—"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {summary.note ? (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={summary.note}
          >
            {summary.note}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-nowrap items-center gap-1">
          <Badge variant={STATUS_VARIANTS[entry.status]}>
            {formatDecisionEventStatus(entry.status)}
          </Badge>
          {entry.stale ? (
            <Badge variant="destructive">
              <ShieldAlert data-icon="inline-start" />
              Stale
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {formatTimestamp(entry.at)}
      </TableCell>
    </TableRow>
  )
}
