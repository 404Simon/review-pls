import { ITEM_KINDS } from "@/lib/review/ids"
import type {
  ItemKind,
  ItemStatus,
  ReviewItem,
  Severity,
} from "@/lib/review/types"

export type SeverityFilter = "all" | Severity
export type KindFilter = "all" | ItemKind
export type StatusFilter = "all" | ItemStatus

export type SearchParamsRecord = Record<string, string | string[] | undefined>

export interface ReviewFilters {
  severity: SeverityFilter
  kind: KindFilter
  status: StatusFilter
  mine: boolean
  search: string
}

export type ItemTab = "matches" | "new" | "auditowl" | "related" | "all"

export const ITEM_TABS: ReadonlyArray<{
  value: ItemTab
  label: string
  kind: ItemKind | null
}> = [
  { value: "matches", label: "Matches", kind: "cluster" },
  { value: "new", label: "New findings", kind: "agent_only" },
  { value: "auditowl", label: "AuditOwl-only", kind: "auditowl_only" },
  { value: "related", label: "Related", kind: "related" },
  { value: "all", label: "All", kind: null },
]

export function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? ""
  }
  return value ?? ""
}

export function normalizeParams(
  params: SearchParamsRecord
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    const first = firstParam(value).trim()
    if (first !== "") {
      normalized[key] = first
    }
  }
  return normalized
}

function isSeverity(value: string): value is Severity {
  return value === "high" || value === "medium" || value === "low"
}

function isStatus(value: string): value is ItemStatus {
  return (
    value === "open" ||
    value === "claimed" ||
    value === "unsure" ||
    value === "closed"
  )
}

function isKind(value: string): value is ItemKind {
  return ITEM_KINDS.includes(value as ItemKind)
}

export function parseSeverityFilter(value: string): SeverityFilter {
  return isSeverity(value) ? value : "all"
}

export function parseStatusFilter(value: string): StatusFilter {
  return isStatus(value) ? value : "all"
}

export function parseKindFilter(value: string): KindFilter {
  return isKind(value) ? value : "all"
}

export function parseMine(value: string): boolean {
  return value === "1" || value === "true" || value === "mine"
}

export function parseReviewFilters(params: SearchParamsRecord): ReviewFilters {
  return {
    severity: parseSeverityFilter(firstParam(params.severity)),
    kind: parseKindFilter(firstParam(params.kind)),
    status: parseStatusFilter(firstParam(params.status)),
    mine: parseMine(firstParam(params.mine)),
    search: firstParam(params.q).trim(),
  }
}

export function parseItemTab(value: string): ItemTab {
  switch (value) {
    case "matches":
    case "new":
    case "auditowl":
    case "related":
    case "all":
      return value
    default:
      return "all"
  }
}

export function kindForTab(tab: ItemTab): ItemKind | null {
  return ITEM_TABS.find((entry) => entry.value === tab)?.kind ?? null
}

export interface ItemFilterState {
  status: ItemStatus
  claim: { userId: string } | null
  finalDecision: { record: { userId: string } } | null
}

function matchesSearch(item: ReviewItem, search: string): boolean {
  if (search === "") {
    return true
  }
  const haystack = [
    item.title,
    item.summary ?? "",
    item.ref,
    item.paperId,
    item.kind,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(search.toLowerCase())
}

/**
 * Shared item predicate for the paper list and the global queue.
 *
 * `hideClosedWhenAll` implements the queue default: closed items disappear
 * unless the reviewer explicitly asks for `status=closed`.
 */
export function countItemStatuses(
  items: readonly { id: string }[],
  states: Record<string, ItemFilterState | undefined>
): Record<ItemStatus, number> {
  const counts: Record<ItemStatus, number> = {
    open: 0,
    claimed: 0,
    unsure: 0,
    closed: 0,
  }
  for (const item of items) {
    const state = states[item.id]
    if (state) {
      counts[state.status] += 1
    }
  }
  return counts
}

export function matchesReviewFilters(
  item: ReviewItem,
  state: ItemFilterState,
  filters: ReviewFilters,
  currentUserId: string,
  options: { hideClosedWhenAll?: boolean } = {}
): boolean {
  if (filters.severity !== "all" && item.severity !== filters.severity) {
    return false
  }
  if (filters.kind !== "all" && item.kind !== filters.kind) {
    return false
  }
  if (filters.status === "all") {
    if (options.hideClosedWhenAll === true && state.status === "closed") {
      return false
    }
  } else if (state.status !== filters.status) {
    return false
  }
  if (filters.mine) {
    const mine =
      state.claim?.userId === currentUserId ||
      state.finalDecision?.record.userId === currentUserId
    if (!mine) {
      return false
    }
  }
  return matchesSearch(item, filters.search)
}

const FILTER_KEYS = new Set(["severity", "kind", "status", "mine", "paper"])

export function buildQueryString(
  params: Record<string, string | undefined>
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue
    }
    if (value === "all" && FILTER_KEYS.has(key)) {
      continue
    }
    search.set(key, value)
  }
  const query = search.toString()
  return query === "" ? "" : `?${query}`
}

export function withQuery(
  path: string,
  params: Record<string, string | undefined>
): string {
  return `${path}${buildQueryString(params)}`
}

export function itemPath(batchId: string, itemId: string): string {
  return `/batches/${encodeURIComponent(batchId)}/items/${itemId}`
}

export function paperPath(batchId: string, paperId: string): string {
  return `/batches/${encodeURIComponent(batchId)}/papers/${encodeURIComponent(paperId)}`
}

export function queuePath(batchId: string): string {
  return `/batches/${encodeURIComponent(batchId)}/queue`
}

export function queryFromFilters(
  filters: ReviewFilters,
  extra: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    ...extra,
    severity: filters.severity,
    kind: filters.kind,
    status: filters.status,
    mine: filters.mine ? "1" : "",
    q: filters.search,
  }
}
