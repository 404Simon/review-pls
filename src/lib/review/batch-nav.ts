export interface BatchNavItem {
  href: string
  label: string
  activePrefixes: readonly string[]
}

export interface BatchNavOptions {
  isAdmin?: boolean
}

/** Header links for the dashboard or a specific batch. */
export function batchNavItems(
  candidate: string | null,
  options: BatchNavOptions = {}
): BatchNavItem[] {
  const papersHref = candidate
    ? `/dashboard?batch=${encodeURIComponent(candidate)}`
    : "/dashboard"

  const items: BatchNavItem[] = [
    {
      href: papersHref,
      label: "Papers",
      activePrefixes: ["/dashboard"],
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
 * batch-specific, so switching batches always returns to the dashboard for the
 * new batch.
 */
export function batchSwitchHref(batchId: string): string {
  return `/dashboard?batch=${encodeURIComponent(batchId)}`
}
