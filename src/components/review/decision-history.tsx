import { History, StickyNote } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  describeDecision,
  formatDecisionEventStatus,
} from "@/lib/review/decision-format"
import { formatTimestamp } from "@/lib/review/format"
import type {
  DecisionEventStatus,
  DecisionStatus,
  ItemKind,
} from "@/lib/review/types"

export interface DecisionHistoryEntry {
  key: string
  status: DecisionStatus | DecisionEventStatus
  payload: unknown
  userId: string
  reviewerName: string
  at: number
  stale: boolean
}

export function DecisionHistory({
  kind,
  entries,
}: {
  kind: ItemKind
  entries: readonly DecisionHistoryEntry[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History data-icon="inline-start" />
          Decision history
        </CardTitle>
        <CardDescription>
          Every final, unsure and reopen event, newest first. Drafts are shown
          to their owner and admins.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No decision has been saved yet. Your draft will appear here after
            the first autosave.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.map((entry) => {
              const summary = describeDecision(kind, entry.payload)
              return (
                <li
                  key={entry.key}
                  className="flex flex-col gap-2 border-l-2 border-border pl-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        entry.status === "draft"
                          ? "outline"
                          : entry.status === "unsure"
                            ? "secondary"
                            : entry.status === "reopened"
                              ? "destructive"
                              : "default"
                      }
                    >
                      {formatDecisionEventStatus(entry.status)}
                    </Badge>
                    <span className="text-sm font-medium">
                      {summary.verdict}
                    </span>
                    {entry.stale ? (
                      <Badge variant="destructive">Source changed</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.reviewerName} · {formatTimestamp(entry.at)}
                  </p>
                  {summary.details.length > 0 ? (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {summary.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  {summary.note ? (
                    <p className="flex items-start gap-1.5 rounded-md bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">
                      <StickyNote
                        data-icon="inline-start"
                        className="mt-0.5 text-muted-foreground"
                      />
                      {summary.note}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
