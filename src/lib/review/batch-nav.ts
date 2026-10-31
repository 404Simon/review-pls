import { queuePath } from "@/lib/review/filters"

export interface BatchNavItem {
  href: string
  label: string
  activePrefixes: readonly string[]
  /** A requested batch that is not mounted keeps its place but has no link. */
  disabled?: boolean
}

export interface BatchNavOptions {
  /** False when a dashboard `?batch=` names a directory that is not mounted. */
  mounted?: boolean
  isAdmin?: boolean
}

/** Header links for the dashboard or a specific batch. */
export function batchNavItems(
  candidate: string | null,
  options: BatchNavOptions = {}
): BatchNavItem[] {
  const mounted = options.mounted ?? true
  const papersHref = candidate
    ? `/dashboard?batch=${encodeURIComponent(candidate)}`
    : "/dashboard"
  const queueHref = candidate ? queuePath(candidate) : "/dashboard"

  const items: BatchNavItem[] = [
    {
      href: papersHref,
      label: "Papers",
      activePrefixes: ["/dashboard"],
    },
    {
      href: queueHref,
      label: "Queue",
      activePrefixes: queueHref.startsWith("/batches/")
        ? [queueHref]
        : ["/batches"],
      disabled: candidate !== null && !mounted,
    },
    { href: "/guide", label: "Guide", activePrefixes: ["/guide"] },
  ]

  if (options.isAdmin) {
    items.push({
      href: "/admin",
      label: "Admin",
      activePrefixes: ["/admin"],
    })
  }

  return items
}

/**
 * Where the batch selector sends the reviewer. Item and paper URLs are
 * batch-specific, so switching batches falls back to the new batch's queue;
 * dashboard links keep the dashboard and pass the batch in the query.
 */
export function batchSwitchHref(pathname: string, batchId: string): string {
  const onBatchRoute = /^\/batches\/[^/]+(?:\/|$)/.test(pathname)
  return onBatchRoute
    ? queuePath(batchId)
    : `/dashboard?batch=${encodeURIComponent(batchId)}`
}
