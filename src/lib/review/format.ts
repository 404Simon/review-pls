import type { EvidenceSide, ItemKind } from "@/lib/review/types"

const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  cluster: "Match cluster",
  agent_only: "Agent-only finding",
  auditowl_only: "AuditOwl-only finding",
  related: "Related pair",
}

const SIDE_LABELS: Readonly<Record<EvidenceSide, string>> = {
  agent: "Review agent",
  auditowl: "AuditOwl",
}

export function formatItemKind(kind: ItemKind): string {
  return ITEM_KIND_LABELS[kind]
}

export function formatSide(side: EvidenceSide): string {
  return SIDE_LABELS[side]
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return "unknown size"
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatLineRange(
  start: number | null,
  end: number | null
): string {
  if (start === null) {
    return "no line number"
  }
  if (end === null || end === start) {
    return `line ${start}`
  }
  return `lines ${start}–${end}`
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
})

/** UTC keeps server and client renders identical. */
export function formatTimestamp(milliseconds: number): string {
  return TIMESTAMP_FORMAT.format(new Date(milliseconds))
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Human lease countdown, intentionally rounded down. */
export function formatLease(expiresAt: number, now: number): string {
  const remaining = expiresAt - now
  if (remaining <= 0) {
    return "expired"
  }
  const minutes = Math.floor(remaining / 60_000)
  if (minutes < 1) {
    return "less than a minute"
  }
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) {
    return `${hours} h`
  }
  return `${hours} h ${rest} min`
}
