import {
  firstParam,
  parseKindFilter,
  type KindFilter,
  type SearchParamsRecord,
} from "@/lib/review/filters"
import type {
  DecisionEventRecord,
  DecisionEventStatus,
  DecisionRecord,
  DecisionStatus,
  ItemKind,
  ReviewItem,
} from "@/lib/review/types"

/** A decision log entry is a final/unsure event or a current draft. */
export type DecisionLogStatus = DecisionStatus | DecisionEventStatus

export interface UserDecisionBatch {
  batchId: string
  items: readonly ReviewItem[]
  manifestSha256: string
}

export interface UserDecisionLogEntry {
  key: string
  status: DecisionLogStatus
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
  /** The current mounted item, or null when the batch/item is unavailable. */
  item: ReviewItem | null
  payload: unknown
  /** Event time for history entries, row update time for drafts. */
  at: number
  /** The item hash or manifest changed after the decision was saved. */
  stale: boolean
}

export interface UserDecisionCounts {
  closed: number
  unsure: number
  drafts: number
  reopened: number
}

export interface UserDecisionLog {
  entries: UserDecisionLogEntry[]
  counts: UserDecisionCounts
}

export interface DecisionLogFilters {
  status: "all" | DecisionLogStatus
  kind: KindFilter
  search: string
}

const LOG_STATUSES: readonly DecisionLogStatus[] = [
  "closed",
  "unsure",
  "draft",
  "reopened",
]

function isLogStatus(value: string): value is DecisionLogStatus {
  return LOG_STATUSES.some((status) => status === value)
}

export function parseDecisionLogFilters(
  params: SearchParamsRecord
): DecisionLogFilters {
  const status = firstParam(params.status).trim()
  return {
    status: isLogStatus(status) ? status : "all",
    kind: parseKindFilter(firstParam(params.kind)),
    search: firstParam(params.q).trim(),
  }
}

function itemKey(
  batchId: string,
  paperId: string,
  kind: ItemKind,
  ref: string
): string {
  return `${batchId}\u0000${paperId}\u0000${kind}\u0000${ref}`
}

function matchKey(
  record: Pick<
    DecisionRecord | DecisionEventRecord,
    "batchId" | "paperId" | "itemKind" | "itemRef" | "userId" | "status"
  >,
  at: number
): string {
  return `${itemKey(record.batchId, record.paperId, record.itemKind, record.itemRef)}\u0000${record.userId}\u0000${record.status}\u0000${at}`
}

function isStale(
  record: Pick<DecisionRecord, "itemHash" | "manifestSha256">,
  item: ReviewItem | null,
  manifestSha256: string | undefined
): boolean {
  if (!item || manifestSha256 === undefined) {
    return false
  }
  return (
    record.itemHash !== item.itemHash ||
    record.manifestSha256 !== manifestSha256
  )
}

/**
 * Turn one reviewer's current rows and append-only events into a single,
 * newest-first decision log.
 *
 * Final and unsure events are canonical. A row is only added when no matching
 * event exists (pre-event legacy rows) or when it is the reviewer's current
 * draft. That deliberately keeps an unsure note visible after the same
 * reviewer resumes the item and saves a draft.
 */
export function buildUserDecisionLog(
  userId: string,
  rows: readonly DecisionRecord[],
  events: readonly DecisionEventRecord[],
  batches: readonly UserDecisionBatch[]
): UserDecisionLog {
  const batchById = new Map(batches.map((batch) => [batch.batchId, batch]))
  const itemByKey = new Map<string, ReviewItem>()
  for (const batch of batches) {
    for (const item of batch.items) {
      itemByKey.set(
        itemKey(batch.batchId, item.paperId, item.kind, item.ref),
        item
      )
    }
  }

  const userEvents = events.filter((event) => event.userId === userId)
  const eventMatchKeys = new Set(
    userEvents.map((event) => matchKey(event, event.createdAt))
  )
  const entries: UserDecisionLogEntry[] = userEvents.map((event) => {
    const batch = batchById.get(event.batchId)
    const item =
      itemByKey.get(
        itemKey(event.batchId, event.paperId, event.itemKind, event.itemRef)
      ) ?? null
    return {
      key: `event:${event.id}`,
      status: event.status,
      batchId: event.batchId,
      paperId: event.paperId,
      itemKind: event.itemKind,
      itemRef: event.itemRef,
      item,
      payload: event.payload,
      at: event.createdAt,
      stale: isStale(event, item, batch?.manifestSha256),
    }
  })

  for (const row of rows) {
    if (row.userId !== userId) {
      continue
    }
    const isDraft = row.status === "draft"
    if (!isDraft && eventMatchKeys.has(matchKey(row, row.updatedAt))) {
      continue
    }
    const batch = batchById.get(row.batchId)
    const item =
      itemByKey.get(
        itemKey(row.batchId, row.paperId, row.itemKind, row.itemRef)
      ) ?? null
    entries.push({
      key: `row:${row.id}`,
      status: row.status,
      batchId: row.batchId,
      paperId: row.paperId,
      itemKind: row.itemKind,
      itemRef: row.itemRef,
      item,
      payload: row.payload,
      at: row.updatedAt,
      stale: isStale(row, item, batch?.manifestSha256),
    })
  }

  entries.sort((a, b) => {
    if (a.at !== b.at) {
      return b.at - a.at
    }
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0
  })

  const counts: UserDecisionCounts = {
    closed: 0,
    unsure: 0,
    drafts: 0,
    reopened: 0,
  }
  for (const entry of entries) {
    switch (entry.status) {
      case "closed":
        counts.closed += 1
        break
      case "unsure":
        counts.unsure += 1
        break
      case "draft":
        counts.drafts += 1
        break
      case "reopened":
        counts.reopened += 1
        break
    }
  }

  return { entries, counts }
}

function matchesSearch(entry: UserDecisionLogEntry, search: string): boolean {
  if (search === "") {
    return true
  }
  const haystack = [
    entry.item?.title ?? "",
    entry.item?.summary ?? "",
    entry.itemRef,
    entry.paperId,
    entry.itemKind,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(search.toLowerCase())
}

export function matchesDecisionLogFilters(
  entry: UserDecisionLogEntry,
  filters: DecisionLogFilters
): boolean {
  if (filters.status !== "all" && entry.status !== filters.status) {
    return false
  }
  if (filters.kind !== "all" && entry.itemKind !== filters.kind) {
    return false
  }
  return matchesSearch(entry, filters.search)
}
