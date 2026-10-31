"use client"

import {
  ArrowLeft,
  ArrowRight,
  Bot,
  FileText,
  History,
  Info,
  Keyboard,
  PencilLine,
  ShieldCheck,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { AdminItemActions } from "@/components/review/admin-item-actions"
import { ClaimBar } from "@/components/review/claim-bar"
import { ComparatorProposal } from "@/components/review/comparator-proposal"
import {
  DecisionForm,
  type DecisionFormActions,
} from "@/components/review/decision-form"
import {
  DecisionHistory,
  type DecisionHistoryEntry,
} from "@/components/review/decision-history"
import { Disclosure } from "@/components/review/disclosure"
import { EvidencePanel } from "@/components/review/evidence-panel"
import { FindingOverview } from "@/components/review/finding-overview"
import type { LinkCandidate } from "@/components/review/link-picker"
import { PaperActions } from "@/components/review/paper-actions"
import { SeverityBadge } from "@/components/review/severity-badge"
import { ShortcutHelp } from "@/components/review/shortcut-help"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { DecisionView, ItemReviewState } from "@/lib/review/decisions"
import {
  claimItemAction,
  heartbeatItemAction,
  releaseItemAction,
} from "@/lib/review/actions"
import { describeDecision } from "@/lib/review/decision-format"
import type { EvidenceBundle } from "@/lib/review/evidence"
import { formatItemKind } from "@/lib/review/format"
import {
  hasOpenOverlay,
  isSearchKey,
  isShortcutSuppressed,
  isTypingTarget,
} from "@/lib/review/shortcuts"
import type { CodeRepoManifest, ReviewItem } from "@/lib/review/types"

function isInternalAppPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname === "/guide" ||
    pathname.startsWith("/batches/")
  )
}

function FinalDecisionDetails({
  item,
  decision,
}: {
  item: ReviewItem
  decision: DecisionView
}) {
  const summary = describeDecision(item.kind, decision.record.payload)

  return (
    <div className="flex flex-col gap-4 p-4 pr-10">
      <h2 className="flex items-center gap-2 font-heading text-base font-medium">
        <ShieldCheck data-icon="inline-start" />
        Final decision
      </h2>
      <Badge>{summary.verdict}</Badge>
      {summary.details.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
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
    </div>
  )
}

export interface ItemReviewProps {
  batchId: string
  item: ReviewItem
  paperTitle: string
  paperHref: string
  paperPdfUrl: string
  paperFilesBase: string
  repositories: readonly CodeRepoManifest[]
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
  paperPdfUrl,
  paperFilesBase,
  repositories,
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
  const [popoverOpen, setPopoverOpen] = useState(false)
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
  const canShowFinalDecision = status === "closed" && finalDecision !== null
  const popoverAvailable = canEdit || canShowFinalDecision

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    setPopoverOpen(open)
  }, [])

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
    function nonDecisionOverlayOpen(): boolean {
      return hasOpenOverlay((selector) =>
        Array.from(document.querySelectorAll(selector)).some(
          (element) => !element.hasAttribute("data-decision-popover")
        )
          ? selector
          : null
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      if (helpOpen) {
        return
      }

      if (popoverOpen && canEdit) {
        // The decision dialog owns the keyboard. Its verdict/save/unsure
        // shortcuts stay available even though dialogs normally suppress the
        // page shortcuts.
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          isTypingTarget(event.target) ||
          nonDecisionOverlayOpen()
        ) {
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
        if (event.key === "s") {
          if (canEdit && decisionActions.current) {
            event.preventDefault()
            decisionActions.current.save()
          }
          return
        }
        if (event.key === "u") {
          if (canEdit && decisionActions.current) {
            event.preventDefault()
            decisionActions.current.markUnsure()
          }
          return
        }
        if (isSearchKey(event.key)) {
          event.preventDefault()
          void navigateTo(focusSearchHref)
        }
        return
      }

      if (isShortcutSuppressed(event)) {
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
    popoverOpen,
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
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
        </div>
        <h1 className="max-w-4xl font-heading text-lg font-medium text-balance sm:text-xl">
          {item.title}
        </h1>
        <Link
          href={paperHref}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <FileText data-icon="inline-start" />
          {paperTitle}
        </Link>
        <PaperActions
          paperPdfUrl={paperPdfUrl}
          repositories={repositories}
          filesBase={paperFilesBase}
        />
      </header>

      <Popover
        open={popoverOpen && popoverAvailable}
        onOpenChange={handlePopoverOpenChange}
      >
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
          actionTrigger={
            canEdit ? (
              <PopoverTrigger render={<Button size="sm" disabled={pending} />}>
                <PencilLine data-icon="inline-start" />
                Your decision
              </PopoverTrigger>
            ) : canShowFinalDecision ? (
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                <Info data-icon="inline-start" />
                Details
              </PopoverTrigger>
            ) : null
          }
        />
        <PopoverContent
          data-decision-popover
          aria-label={canEdit ? "Your decision" : "Final decision"}
          align="end"
          side="bottom"
          sideOffset={8}
          collisionAvoidance={{ side: "shift", align: "shift" }}
          keepMounted
          className={`max-h-(--available-height) overflow-y-auto p-0 ${
            canEdit
              ? "w-[min(44rem,calc(100vw-2rem))]"
              : "w-[min(32rem,calc(100vw-2rem))]"
          }`}
        >
          <PopoverClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2 z-10"
              />
            }
          >
            <X />
            <span className="sr-only">Close</span>
          </PopoverClose>
          {canEdit ? (
            <DecisionForm
              // A server refresh that changes editability or the draft remounts
              // the form, which clears a completed release/discard lock.
              key={`${item.id}:${canEdit ? "edit" : "read"}:${claim?.id ?? "none"}`}
              embedded
              item={item}
              batchId={batchId}
              draft={draft}
              canEdit={canEdit}
              nextHref={saveNextHref ?? nextItemHref}
              returnHref={returnHref}
              linkCandidates={linkCandidates}
              actionRef={decisionActions}
            />
          ) : canShowFinalDecision && finalDecision ? (
            <FinalDecisionDetails item={item} decision={finalDecision} />
          ) : null}
        </PopoverContent>
      </Popover>

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

      <div className="flex flex-col gap-6">
        <FindingOverview item={item} />

        <section
          id="evidence"
          tabIndex={-1}
          className="flex scroll-mt-24 flex-col gap-3 outline-none"
        >
          <h2 className="font-heading text-lg font-medium">Evidence</h2>
          <EvidencePanel bundle={evidence} />
        </section>

        <Disclosure
          title="Comparator proposal"
          description="Proposed labels and verification from the automated comparator."
          icon={Bot}
        >
          <ComparatorProposal item={item} />
        </Disclosure>

        <Disclosure
          title="Decision history"
          description="Final, unsure and reopen events, newest first."
          icon={History}
        >
          <DecisionHistory kind={item.kind} entries={history} />
        </Disclosure>
      </div>

      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
