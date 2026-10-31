import type { ItemKind, ReviewItem, Severity } from "@/lib/review/types"

export const ITEM_KINDS: readonly ItemKind[] = [
  "cluster",
  "agent_only",
  "auditowl_only",
  "related",
]

export const KIND_ORDER: Readonly<Record<ItemKind, number>> = {
  cluster: 0,
  agent_only: 1,
  auditowl_only: 2,
  related: 3,
}

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  low: 1,
  medium: 2,
  high: 3,
}

export function severityMax(severities: readonly Severity[]): Severity {
  if (severities.length === 0) {
    throw new Error("severityMax requires at least one severity")
  }
  let max = severities[0]
  for (const severity of severities.slice(1)) {
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[max]) {
      max = severity
    }
  }
  return max
}

export function relatedRef(
  auditowlIds: readonly string[],
  agentIds: readonly string[]
): string {
  if (auditowlIds.length === 0 || agentIds.length === 0) {
    throw new Error("relatedRef requires findings on both sides")
  }
  return `${auditowlIds.join("+")}--${agentIds.join("+")}`
}

export interface ParsedRelatedRef {
  auditowl: string[]
  agent: string[]
}

export function parseRelatedRef(ref: string): ParsedRelatedRef {
  const separator = ref.indexOf("--")
  if (separator < 0) {
    throw new Error(`Not a related ref: ${ref}`)
  }
  const auditowl = ref.slice(0, separator).split("+").filter(Boolean)
  const agent = ref
    .slice(separator + 2)
    .split("+")
    .filter(Boolean)
  if (auditowl.length === 0 || agent.length === 0) {
    throw new Error(`Not a related ref: ${ref}`)
  }
  return { auditowl, agent }
}

export function itemId(kind: ItemKind, paperId: string, ref: string): string {
  return `${kind}:${paperId}:${encodeURIComponent(ref)}`
}

export interface ParsedItemId {
  kind: ItemKind
  paperId: string
  ref: string
}

/** Parse a value that is already decoded (for example from a loaded item). */
export function parseItemId(id: string): ParsedItemId {
  const first = id.indexOf(":")
  const second = id.indexOf(":", first + 1)
  if (first < 0 || second < 0) {
    throw new Error(`Not an item id: ${id}`)
  }
  const kind = id.slice(0, first)
  if (!ITEM_KINDS.includes(kind as ItemKind)) {
    throw new Error(`Unknown item kind: ${kind}`)
  }
  return {
    kind: kind as ItemKind,
    paperId: id.slice(first + 1, second),
    ref: id.slice(second + 1),
  }
}

/**
 * Parse a dynamic route param. Next escapes path delimiters in params (for
 * example `cluster%3A1001%3AM01`), so the boundary decodes exactly once before
 * `parseItemId` sees the value. Decoding here, and never inside
 * `parseItemId`, keeps a literal `%20` in a ref from being decoded twice.
 */
export function parseItemIdParam(param: string): ParsedItemId {
  let decoded = param
  try {
    decoded = decodeURIComponent(param)
  } catch {
    // A malformed escape is treated as a literal id.
  }
  return parseItemId(decoded)
}

export function comparePaperIds(a: string, b: string): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

export function compareReviewItems(a: ReviewItem, b: ReviewItem): number {
  const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  if (severityDelta !== 0) {
    return severityDelta
  }
  const paperDelta = comparePaperIds(a.paperId, b.paperId)
  if (paperDelta !== 0) {
    return paperDelta
  }
  const kindDelta = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (kindDelta !== 0) {
    return kindDelta
  }
  if (a.ref === b.ref) {
    return 0
  }
  return a.ref < b.ref ? -1 : 1
}
