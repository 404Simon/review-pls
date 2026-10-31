import { notFound, redirect } from "next/navigation"

import { DataErrorState } from "@/components/review/data-error"
import { ItemReview } from "@/components/review/item-review"
import type { DecisionHistoryEntry } from "@/components/review/decision-history"
import type { LinkCandidate } from "@/components/review/link-picker"
import { db } from "@/db"
import {
  getItemDecisionEvents,
  getItemDecisionRows,
  isDecisionStale,
} from "@/lib/review/decisions"
import {
  buildEvidenceBundle,
  evidenceRootsFromPaper,
} from "@/lib/review/evidence"
import {
  itemPath,
  kindForTab,
  matchesReviewFilters,
  normalizeParams,
  paperPath,
  parseItemTab,
  parseReviewFilters,
  queryFromFilters,
  queuePath,
  withQuery,
} from "@/lib/review/filters"
import { SEVERITY_RANK, parseItemIdParam } from "@/lib/review/ids"
import { loadBatchReviewView } from "@/lib/review/ui-data"
import { joinWithin } from "@/lib/review/paths"
import { getUserRole } from "@/lib/review/roles"
import type { ReviewItem } from "@/lib/review/types"
import { isMissingReviewData, ReviewDataError } from "@/lib/review/load"
import { getSession } from "@/lib/session"

interface PageProps {
  params: Promise<{ batch: string; itemId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function linkCandidates(
  item: ReviewItem,
  paperItems: readonly ReviewItem[]
): LinkCandidate[] {
  if (item.kind !== "agent_only" && item.kind !== "auditowl_only") {
    return []
  }
  const oppositeKind: "agent_only" | "auditowl_only" =
    item.kind === "agent_only" ? "auditowl_only" : "agent_only"
  const closest =
    item.kind === "agent_only"
      ? item.comparator.closestAuditowl
      : item.comparator.closestAgent
  const closestSet = new Set(closest)

  return paperItems
    .filter(
      (candidate) =>
        candidate.paperId === item.paperId && candidate.kind === oppositeKind
    )
    .map((candidate) => ({
      kind: oppositeKind,
      ref: candidate.ref,
      title: candidate.title,
      severity: candidate.severity,
      closest: closestSet.has(candidate.ref),
    }))
    .sort((a, b) => {
      if (a.closest !== b.closest) {
        return a.closest ? -1 : 1
      }
      const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      if (severity !== 0) {
        return severity
      }
      return a.ref.localeCompare(b.ref)
    })
}

export default async function ItemPage({ params, searchParams }: PageProps) {
  const session = await getSession()
  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })
  const rawParams = await params
  const batchId = rawParams.batch

  let parsed: ReturnType<typeof parseItemIdParam>
  try {
    parsed = parseItemIdParam(rawParams.itemId)
  } catch {
    notFound()
  }

  let view: Awaited<ReturnType<typeof loadBatchReviewView>>
  try {
    view = await loadBatchReviewView(batchId, session.user.id)
  } catch (error) {
    if (error instanceof ReviewDataError) {
      if (isMissingReviewData(error)) {
        notFound()
      }
      return (
        <DataErrorState
          error={error}
          batchId={batchId}
          isAdmin={role === "admin"}
        />
      )
    }
    throw error
  }

  const item = view.loaded.items.find(
    (candidate) =>
      candidate.kind === parsed.kind &&
      candidate.paperId === parsed.paperId &&
      candidate.ref === parsed.ref
  )
  if (!item) {
    notFound()
  }

  const paper = view.loaded.papers.find(
    (candidate) => candidate.manifest.id === parsed.paperId
  )
  if (!paper) {
    notFound()
  }

  const paperDir = joinWithin(view.loaded.batch.dir, paper.manifest.dir)
  if (paperDir === null) {
    notFound()
  }

  const rawQuery = await searchParams
  const query = normalizeParams(rawQuery)
  const filters = parseReviewFilters(rawQuery)
  const fromQueue = query.from === "queue"

  const sourceItems = fromQueue ? view.loaded.items : paper.items
  const tabKind = fromQueue
    ? null
    : kindForTab(parseItemTab(query.tab ?? "all"))
  const filtered = sourceItems.filter((candidate) => {
    if (tabKind !== null && candidate.kind !== tabKind) {
      return false
    }
    const state = view.states[candidate.id]
    return state
      ? matchesReviewFilters(candidate, state, filters, session.user.id, {
          hideClosedWhenAll: fromQueue,
        })
      : false
  })
  const currentIndex = filtered.findIndex(
    (candidate) => candidate.id === item.id
  )
  const nextSequential =
    currentIndex >= 0
      ? (filtered[currentIndex + 1] ?? null)
      : (filtered[0] ?? null)
  const previousSequential =
    currentIndex > 0 ? (filtered[currentIndex - 1] ?? null) : null
  const ordered =
    currentIndex >= 0 ? filtered.slice(currentIndex + 1) : filtered
  const nextUnclaimed =
    ordered.find((candidate) => view.states[candidate.id]?.status === "open") ??
    ordered.find(
      (candidate) => view.states[candidate.id]?.status !== "closed"
    ) ??
    filtered.find(
      (candidate) =>
        candidate.id !== item.id && view.states[candidate.id]?.status === "open"
    ) ??
    null

  const navParams = {
    ...queryFromFilters(filters),
    from: fromQueue ? "queue" : "paper",
    paper: fromQueue ? query.paper : undefined,
    tab: fromQueue ? undefined : query.tab,
  }
  const itemHref = (target: ReviewItem | null): string | null =>
    target ? withQuery(itemPath(batchId, target.id), navParams) : null

  const queueHref = withQuery(queuePath(batchId), {
    ...queryFromFilters(filters),
    paper: query.paper,
  })
  const paperHref = withQuery(paperPath(batchId, parsed.paperId), {
    ...queryFromFilters(filters),
    tab: query.tab,
  })
  const focusSearchHref = withQuery(
    fromQueue ? queuePath(batchId) : paperPath(batchId, parsed.paperId),
    {
      ...queryFromFilters(filters),
      paper: fromQueue ? query.paper : undefined,
      tab: fromQueue ? undefined : query.tab,
      focus: "search",
    }
  )

  const [historyRows, historyEvents, evidence] = await Promise.all([
    getItemDecisionRows(db, batchId, item),
    getItemDecisionEvents(db, batchId, item),
    buildEvidenceBundle({
      batchId,
      paperId: parsed.paperId,
      item,
      roots: evidenceRootsFromPaper(view.loaded.batch.dir, {
        manifest: paper.manifest,
        dir: paperDir,
      }),
    }),
  ])

  const reviewerName = (userId: string): string =>
    view.reviewerNames[userId] ?? "another reviewer"
  const history: DecisionHistoryEntry[] = [
    ...historyEvents.map((record) => ({
      key: `event:${record.id}`,
      status: record.status,
      payload: record.payload,
      userId: record.userId,
      reviewerName: reviewerName(record.userId),
      at: record.createdAt,
      stale: isDecisionStale(
        record,
        item.itemHash,
        view.loaded.batch.manifestSha256
      ),
    })),
    ...historyRows
      .filter((record) => {
        if (record.status === "draft") {
          return role === "admin" || record.userId === session.user.id
        }
        // Pre-event rows remain visible; otherwise the event is the canonical
        // history entry.
        return !historyEvents.some(
          (event) =>
            event.userId === record.userId &&
            event.status === record.status &&
            event.createdAt === record.updatedAt
        )
      })
      .map((record) => ({
        key: `decision:${record.id}`,
        status: record.status,
        payload: record.payload,
        userId: record.userId,
        reviewerName: reviewerName(record.userId),
        at: record.updatedAt,
        stale: isDecisionStale(
          record,
          item.itemHash,
          view.loaded.batch.manifestSha256
        ),
      })),
  ].sort((a, b) => {
    if (a.at !== b.at) {
      return b.at - a.at
    }
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0
  })

  return (
    <ItemReview
      batchId={batchId}
      item={item}
      paperTitle={paper.manifest.title}
      paperHref={paperHref}
      queueHref={queueHref}
      focusSearchHref={focusSearchHref}
      returnHref={fromQueue ? queueHref : paperHref}
      serverNow={view.now}
      state={
        view.states[item.id] ?? {
          status: "open",
          claim: null,
          finalDecision: null,
          latestUnsure: null,
          unsureHistory: [],
          draft: null,
        }
      }
      history={history}
      reviewerNames={view.reviewerNames}
      currentUserId={session.user.id}
      role={role}
      evidence={evidence}
      linkCandidates={linkCandidates(item, paper.items)}
      nextItemHref={itemHref(nextSequential)}
      previousItemHref={itemHref(previousSequential)}
      saveNextHref={itemHref(nextUnclaimed)}
    />
  )
}
