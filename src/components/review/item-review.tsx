"use client"

import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  FileText,
  Keyboard,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { AdminItemActions } from "@/components/review/admin-item-actions"
import { ClaimBar } from "@/components/review/claim-bar"
import { ComparatorPanel } from "@/components/review/comparator-panel"
import {
  DecisionForm,
  type DecisionFormActions,
} from "@/components/review/decision-form"
import {
  DecisionHistory,
  type DecisionHistoryEntry,
} from "@/components/review/decision-history"
import { EvidencePanel } from "@/components/review/evidence-panel"
import type { LinkCandidate } from "@/components/review/link-picker"
import { SeverityBadge } from "@/components/review/severity-badge"
import { ShortcutHelp } from "@/components/review/shortcut-help"
import { StatusBadge } from "@/components/review/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ItemReviewState } from "@/lib/review/decisions"
import {
  claimItemAction,
  heartbeatItemAction,
  releaseItemAction,
} from "@/lib/review/actions"
import { describeDecision } from "@/lib/review/decision-format"
import type { EvidenceBundle } from "@/lib/review/evidence"
import { formatItemKind, formatTimestamp } from "@/lib/review/format"
import { isSearchKey, isShortcutSuppressed } from "@/lib/review/shortcuts"
import type { ReviewItem } from "@/lib/review/types"

function isInternalAppPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname === "/guide" ||
    pathname.startsWith("/batches/")
  )
}

function ClosedDecisionCard({
  item,
  state,
  reviewerNames,
}: {
  item: ReviewItem
  state: ItemReviewState
  reviewerNames: Record<string, string>
}) {
  if (!state.finalDecision) {
    return null
  }
  const summary = describeDecision(
    item.kind,
    state.finalDecision.record.payload
  )
  const reviewer =
    reviewerNames[state.finalDecision.record.userId] ?? "another reviewer"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck data-icon="inline-start" />
          Final decision
        </CardTitle>
        <CardDescription>
          Closed by {reviewer} at{" "}
          {formatTimestamp(state.finalDecision.record.updatedAt)}. This item is
          read-only for reviewers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{summary.verdict}</Badge>
          {state.finalDecision.stale ? (
            <Badge variant="destructive">Source changed since decision</Badge>
          ) : null}
        </div>
        {summary.details.length > 0 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {summary.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
        {summary.note ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap">
            {summary.note}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The reviewer saved no note.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export interface ItemReviewProps {
  batchId: string
  item: ReviewItem
  paperTitle: string
  paperHref: string
  queueHref: string
  returnHref: string
  focusSearchHref: string
  state: ItemReviewState
  history: readonly DecisionHistoryEntry[]
  reviewerNames: Record<string, string>
  currentUserId: string
  role: "reviewer" | "admin"
  evidence: EvidenceBundle
  linkCandidates: readonly LinkCandidate[]
  nextItemHref: string | null
  previousItemHref: string | null
  saveNextHref: string | null
  /** One server timestamp for the whole page, used to correct clock skew. */
  serverNow: number
}

export function ItemReview({
  batchId,
  item,
  paperTitle,
  paperHref,
  queueHref,
  returnHref,
  focusSearchHref,
  state,
  history,
  reviewerNames,
  currentUserId,
  role,
  evidence,
  linkCandidates,
  nextItemHref,
  previousItemHref,
  saveNextHref,
  serverNow,
}: ItemReviewProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [extendedLease, setExtendedLease] = useState<{
    claimId: string
    expiresAt: number
  } | null>(null)
  const decisionActions = useRef<DecisionFormActions | null>(null)

  // Prefer whichever expiry the server reported most recently. A heartbeat can
  // extend the lease before the refreshed page state arrives; a stale local
  // value must never replace a newer server value.
  const claim =
    state.claim && extendedLease?.claimId === state.claim.id
      ? {
          ...state.claim,
          expiresAt: Math.max(state.claim.expiresAt, extendedLease.expiresAt),
        }
      : state.claim
  const status = state.status
  const finalDecision = state.finalDecision
  const latestUnsure = state.latestUnsure
  const draft = state.draft

  const key = {
    batchId,
    paperId: item.paperId,
    itemKind: item.kind,
    itemRef: item.ref,
  }

  const handleError = useCallback(
    (message: string) => {
      toast.error(message)
      router.refresh()
    },
    [router]
  )

  async function claimItem() {
    setPending(true)
    try {
      const result = await claimItemAction(key)
      if (!result.ok) {
        handleError(result.message)
        return
      }
      toast.success("Item reserved for two hours.")
      router.refresh()
    } catch {
      handleError("The reservation could not be completed. Reload the item.")
    } finally {
      setPending(false)
    }
  }

  const release = useCallback(async () => {
    const actions = decisionActions.current
    // Stop the debounce and wait for any draft write already on the wire.
    // Otherwise a late autosave can atomically re-claim the item after release.
    await actions?.suspendAutosave()
    try {
      const result = await releaseItemAction({
        batchId,
        paperId: item.paperId,
        itemKind: item.kind,
        itemRef: item.ref,
      })
      if (!result.ok) {
        actions?.resumeAutosave()
        handleError(result.message)
        return
      }
      setExtendedLease(null)
      toast.success("Claim released.")
      router.refresh()
    } catch {
      actions?.resumeAutosave()
      handleError("The claim could not be released. Reload the item.")
    }
  }, [batchId, handleError, item.kind, item.paperId, item.ref, router])

  async function releaseItem() {
    setPending(true)
    try {
      await release()
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    const claimOwner = claim?.userId
    if (claimOwner !== currentUserId || status === "closed") {
      return
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return
      }
      void heartbeatItemAction(key)
        .then((result) => {
          if (!result.ok) {
            toast.error(result.message)
            router.refresh()
            return
          }
          setExtendedLease({
            claimId: result.data.id,
            expiresAt: result.data.expiresAt,
          })
        })
        .catch(() => {
          toast.error(
            "The heartbeat failed. Reload the item to check the claim."
          )
        })
    }, 60_000)
    return () => window.clearInterval(timer)
    // `key` is rebuilt from stable primitives; only ownership/status matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim?.userId, currentUserId, router, status])

  const canEdit = status !== "closed" && claim?.userId === currentUserId
  const isStale = finalDecision?.stale === true || draft?.stale === true

  const navigateTo = useCallback(
    async (href: string) => {
      // Do not lose an edit that is still inside the autosave debounce window.
      await decisionActions.current?.flushDraft()
      router.push(href)
    },
    [router]
  )

  useEffect(() => {
    // Anchor navigation leaves the page immediately, before the 800 ms
    // autosave debounce. Capture only an internal app link when this reviewer
    // has a claim and an unsaved draft; everything else (API/file/report links,
    // read-only pages) keeps normal browser navigation.
    function onClick(event: MouseEvent) {
      if (
        !canEdit ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const actions = decisionActions.current
      if (!actions?.hasPendingChanges()) {
        return
      }
      const target = event.target
      const anchor =
        target instanceof Element ? target.closest("a[href]") : null
      if (!(anchor instanceof HTMLAnchorElement)) {
        return
      }
      if (anchor.target && anchor.target !== "_self") {
        return
      }
      if (anchor.hasAttribute("download")) {
        return
      }
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#")) {
        return
      }
      const destination = new URL(anchor.href, window.location.href)
      if (
        destination.origin !== window.location.origin ||
        !isInternalAppPath(destination.pathname)
      ) {
        return
      }
      event.preventDefault()
      void actions
        .flushDraft()
        .catch(() => undefined)
        .finally(() => {
          router.push(
            `${destination.pathname}${destination.search}${destination.hash}`
          )
        })
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [canEdit, router])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isShortcutSuppressed(event) || helpOpen) {
        return
      }
      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault()
        setHelpOpen(true)
        return
      }
      if (isSearchKey(event.key)) {
        // `/` and `'` both point at the search field. The item page has no
        // search input, so reuse the focused search link target instead of
        // consuming the key without doing anything.
        event.preventDefault()
        void navigateTo(focusSearchHref)
        return
      }
      if (/^[1-5]$/.test(event.key)) {
        const handled = canEdit
          ? (decisionActions.current?.chooseVerdict(Number(event.key) - 1) ??
            false)
          : false
        if (handled) {
          event.preventDefault()
        }
        return
      }
      switch (event.key) {
        case "j":
          if (nextItemHref) {
            event.preventDefault()
            void navigateTo(nextItemHref)
          }
          break
        case "k":
          if (previousItemHref) {
            event.preventDefault()
            void navigateTo(previousItemHref)
          }
          break
        case "s":
          if (canEdit && decisionActions.current) {
            event.preventDefault()
            decisionActions.current.save()
          }
          break
        case "u":
          if (canEdit && decisionActions.current) {
            event.preventDefault()
            decisionActions.current.markUnsure()
          }
          break
        case "r":
          if (claim?.userId === currentUserId && status !== "closed") {
            event.preventDefault()
            void release()
          }
          break
        case "e": {
          event.preventDefault()
          const evidence = document.getElementById("evidence")
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
          ).matches
          evidence?.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "start",
          })
          evidence?.focus({ preventScroll: true })
          break
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [
    canEdit,
    claim?.userId,
    currentUserId,
    focusSearchHref,
    helpOpen,
    navigateTo,
    nextItemHref,
    previousItemHref,
    release,
    status,
  ])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link
            href={paperHref}
            className={buttonVariants({ variant: "ghost", size: "xs" })}
          >
            <ArrowLeft data-icon="inline-start" />
            Paper {item.paperId}
          </Link>
          <span aria-hidden>/</span>
          <span className="font-mono text-xs">{item.ref}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous item"
            disabled={!previousItemHref}
            onClick={() => {
              if (previousItemHref) {
                void navigateTo(previousItemHref)
              }
            }}
          >
            <ArrowLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next item"
            disabled={!nextItemHref}
            onClick={() => {
              if (nextItemHref) {
                void navigateTo(nextItemHref)
              }
            }}
          >
            <ArrowRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Keyboard shortcuts"
            onClick={() => setHelpOpen(true)}
          >
            <Keyboard />
          </Button>
        </div>
      </div>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{formatItemKind(item.kind)}</Badge>
          <SeverityBadge severity={item.severity} />
          <StatusBadge status={status} />
          {isStale ? <Badge variant="destructive">Stale source</Badge> : null}
          <span className="font-mono text-xs text-muted-foreground">
            {item.ref}
          </span>
        </div>
        <h1 className="max-w-5xl font-heading text-2xl font-medium text-balance sm:text-3xl">
          {item.title}
        </h1>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FileText data-icon="inline-start" />
          {paperTitle}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={queueHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ClipboardList data-icon="inline-start" />
            Back to queue
          </Link>
        </div>
      </header>

      <ClaimBar
        item={item}
        status={status}
        claim={claim}
        finalDecision={finalDecision}
        latestUnsure={latestUnsure}
        unsureHistory={state.unsureHistory}
        serverNow={serverNow}
        currentUserId={currentUserId}
        reviewerNames={reviewerNames}
        pending={pending}
        onClaim={() => void claimItem()}
        onRelease={() => void releaseItem()}
      />

      {role === "admin" ? (
        <AdminItemActions
          batchId={batchId}
          paperId={item.paperId}
          itemKind={item.kind}
          itemRef={item.ref}
          hasClaim={claim !== null}
          isClosed={status === "closed"}
          onBeforeRelease={async () => {
            // Only the claimant has an autosave that could re-claim the item.
            // Suspending a read-only admin form would leave it stuck on
            // "being updated" after releasing someone else's claim.
            if (claim?.userId === currentUserId) {
              await decisionActions.current?.suspendAutosave()
            }
          }}
          onReleaseFailed={() => decisionActions.current?.resumeAutosave()}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ComparatorPanel item={item} />

          {status === "closed" ? (
            <ClosedDecisionCard
              item={item}
              state={{ ...state, finalDecision }}
              reviewerNames={reviewerNames}
            />
          ) : (
            <DecisionForm
              // A server refresh that changes editability or the draft remounts
              // the form, which clears a completed release/discard lock.
              key={`${item.id}:${canEdit ? "edit" : "read"}:${claim?.id ?? "none"}`}
              item={item}
              batchId={batchId}
              draft={draft}
              canEdit={canEdit}
              nextHref={saveNextHref ?? nextItemHref}
              returnHref={returnHref}
              linkCandidates={linkCandidates}
              actionRef={decisionActions}
            />
          )}

          <DecisionHistory kind={item.kind} entries={history} />
        </div>

        <aside
          id="evidence"
          tabIndex={-1}
          className="min-w-0 scroll-mt-24 outline-none"
        >
          <div className="flex flex-col gap-3 lg:sticky lg:top-[5.5rem] lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto lg:pr-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-medium">Evidence</h2>
              <span className="text-xs text-muted-foreground">
                Code, checks, paper and reports · press e
              </span>
            </div>
            <EvidencePanel bundle={evidence} />
          </div>
        </aside>
      </div>

      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
