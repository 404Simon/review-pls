import { ArrowRight, StickyNote } from "lucide-react"
import Link from "next/link"

import { SeverityBadge } from "@/components/review/severity-badge"
import { StatusBadge } from "@/components/review/status-badge"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { describeDecision } from "@/lib/review/decision-format"
import { formatItemKind, formatTimestamp } from "@/lib/review/format"
import type { ItemReviewState } from "@/lib/review/decisions"
import type { ReviewItem } from "@/lib/review/types"

function reviewerName(
  names: Record<string, string>,
  userId: string | undefined
): string {
  if (!userId) {
    return "a reviewer"
  }
  return names[userId] ?? "a reviewer"
}

export function itemStatusLine(
  item: ReviewItem,
  state: ItemReviewState,
  names: Record<string, string>
): string {
  if (state.status === "closed" && state.finalDecision) {
    return `Closed by ${reviewerName(names, state.finalDecision.record.userId)} · ${formatTimestamp(state.finalDecision.record.updatedAt)}`
  }
  if (state.status === "claimed" && state.claim) {
    return `Reserved by ${reviewerName(names, state.claim.userId)}`
  }
  if (state.status === "unsure" && state.latestUnsure) {
    const note = describeDecision(
      item.kind,
      state.latestUnsure.record.payload
    ).note
    return `Unsure by ${reviewerName(names, state.latestUnsure.record.userId)} · ${formatTimestamp(state.latestUnsure.record.updatedAt)}${note ? ` — “${note}”` : ""}`
  }
  return "Open · not reserved"
}

export function ItemCard({
  item,
  state,
  names,
  href,
  showPaper = false,
  paperTitle,
}: {
  item: ReviewItem
  state: ItemReviewState
  names: Record<string, string>
  href: string
  showPaper?: boolean
  paperTitle?: string
}) {
  const isStale =
    state.finalDecision?.stale === true || state.draft?.stale === true

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-ring/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={item.severity} />
            <Badge variant="outline">{formatItemKind(item.kind)}</Badge>
            <StatusBadge status={state.status} />
            {isStale ? <Badge variant="destructive">Stale source</Badge> : null}
            <span className="font-mono text-xs text-muted-foreground">
              {item.ref}
            </span>
          </div>
          {showPaper && paperTitle ? (
            <p className="text-xs text-muted-foreground">
              Paper {item.paperId} · {paperTitle}
            </p>
          ) : null}
          <Link
            href={href}
            className="font-heading text-base leading-snug font-medium underline-offset-4 hover:underline"
          >
            {item.title}
          </Link>
        </div>
        <Link
          href={href}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open
          <ArrowRight data-icon="inline-end" />
        </Link>
      </div>

      {item.summary ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {item.summary}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <StickyNote data-icon="inline-start" />
          {itemStatusLine(item, state, names)}
        </span>
        {state.draft ? (
          <span className="text-warning-foreground">
            You have a saved draft
          </span>
        ) : null}
      </div>
    </div>
  )
}
