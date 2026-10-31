"use client"

import {
  Clock,
  Lock,
  LockOpen,
  ShieldCheck,
  StickyNote,
  UserRound,
} from "lucide-react"
import { useCallback, useSyncExternalStore } from "react"

import { StatusBadge } from "@/components/review/status-badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { DecisionEventView, DecisionView } from "@/lib/review/decisions"
import { describeDecision } from "@/lib/review/decision-format"
import { formatLease, formatTimestamp } from "@/lib/review/format"
import type { Claim, ItemStatus, ReviewItem } from "@/lib/review/types"

function nameFor(names: Record<string, string>, userId: string): string {
  return names[userId] ?? "another reviewer"
}

const clockListeners = new Set<() => void>()
let clockValue = 0
let clockOffset = 0
let clockTimer: number | null = null

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener)
  clockValue = Date.now()
  if (clockTimer === null) {
    clockTimer = window.setInterval(() => {
      clockValue = Date.now()
      for (const notify of clockListeners) {
        notify()
      }
    }, 30_000)
  }
  queueMicrotask(listener)
  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer)
      clockTimer = null
    }
  }
}

/**
 * Correct the browser clock against the server timestamp captured for this
 * render. The offset is refreshed on subscribe (an effect, not render), so a
 * client clock that is behind cannot make a live lease look expired.
 */
function useNow(serverNow: number): number {
  const subscribe = useCallback(
    (listener: () => void) => {
      clockOffset = serverNow - Date.now()
      return subscribeClock(listener)
    },
    [serverNow]
  )
  return useSyncExternalStore(
    subscribe,
    () => (clockValue === 0 ? 0 : clockValue + clockOffset),
    () => 0
  )
}

export interface ClaimBarProps {
  item: ReviewItem
  status: ItemStatus
  claim: Claim | null
  finalDecision: DecisionView | null
  latestUnsure: DecisionView | null
  /** Append-only unsure events; survives a later re-claim/draft. */
  unsureHistory: readonly DecisionEventView[]
  serverNow: number
  currentUserId: string
  reviewerNames: Record<string, string>
  pending: boolean
  onClaim: () => void
  onRelease: () => void
}

export function ClaimBar({
  item,
  status,
  claim,
  finalDecision,
  latestUnsure,
  unsureHistory,
  serverNow,
  currentUserId,
  reviewerNames,
  pending,
  onClaim,
  onRelease,
}: ClaimBarProps) {
  const now = useNow(serverNow)

  const mine = claim?.userId === currentUserId
  const historyNote = unsureHistory[0]
  const unsure = historyNote
    ? {
        userId: historyNote.record.userId,
        at: historyNote.record.createdAt,
        payload: historyNote.record.payload,
      }
    : latestUnsure
      ? {
          userId: latestUnsure.record.userId,
          at: latestUnsure.record.updatedAt,
          payload: latestUnsure.record.payload,
        }
      : null
  const unsureNote = unsure
    ? describeDecision(item.kind, unsure.payload).note
    : null

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 ring-1 ring-foreground/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge status={status} />

          {status === "closed" && finalDecision ? (
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              <ShieldCheck data-icon="inline-start" className="text-success" />
              Closed by{" "}
              <span className="font-medium">
                {nameFor(reviewerNames, finalDecision.record.userId)}
              </span>
              <span className="text-muted-foreground">
                {" at "}
                {formatTimestamp(finalDecision.record.updatedAt)}
              </span>
              {finalDecision.stale ? (
                <Badge variant="destructive">Stale source</Badge>
              ) : null}
            </span>
          ) : claim ? (
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
              {mine ? (
                <LockOpen
                  data-icon="inline-start"
                  className="text-info-foreground"
                />
              ) : (
                <Lock
                  data-icon="inline-start"
                  className="text-muted-foreground"
                />
              )}
              {mine ? (
                "Reserved by you"
              ) : (
                <>
                  Reserved by{" "}
                  <span className="font-medium">
                    {nameFor(reviewerNames, claim.userId)}
                  </span>
                </>
              )}
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock data-icon="inline-start" />
                {now === 0
                  ? "2 h lease"
                  : `expires in ${formatLease(claim.expiresAt, now)}`}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound data-icon="inline-start" />
              Open · first come, first served
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {status !== "closed" && claim === null ? (
            <Button size="sm" onClick={onClaim} disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Lock data-icon="inline-start" />
              )}
              Reserve
            </Button>
          ) : null}
          {status !== "closed" && mine ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button size="sm" variant="outline" disabled={pending} />
                }
              >
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <LockOpen data-icon="inline-start" />
                )}
                Release
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Release your claim?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Another reviewer can then reserve this item. Your draft, if
                    any, stays in the database.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep claim</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={pending}
                    onClick={onRelease}
                  >
                    Release claim
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {status !== "closed" && claim && !mine ? (
            <Badge variant="outline">View only</Badge>
          ) : null}
        </div>
      </div>

      {status !== "closed" && unsure ? (
        <div className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground">
          <StickyNote data-icon="inline-start" className="mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span>
              Marked unsure by{" "}
              <span className="font-medium">
                {nameFor(reviewerNames, unsure.userId)}
              </span>{" "}
              {formatTimestamp(unsure.at)}.
            </span>
            {unsureNote ? <span>Reason: {unsureNote}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
