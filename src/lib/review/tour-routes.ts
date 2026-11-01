/**
 * Every guided tour, its anchor names and the routes it belongs to. This module
 * stays free of React, JSX and Node APIs so both the guides and the unit tests
 * can import it anywhere.
 */
export const TOUR_QUERY_PARAM = "tour"

export const TOUR_IDS = ["guide", "dashboard", "paper", "item"] as const

export type TourId = (typeof TOUR_IDS)[number]

export interface TourMetadata {
  label: string
  description: string
}

export const TOURS: Record<TourId, TourMetadata> = {
  guide: {
    label: "Guide",
    description: "This pages Tour.",
  },
  dashboard: {
    label: "Dashboard",
    description: "Overview of the papers. Start here.",
  },
  paper: {
    label: "Paper",
    description: "Overview of the Paper and its Findings.",
  },
  item: {
    label: "Review item",
    description: "How to reserve a finding and decide if its valid.",
  },
}

/**
 * Single source of truth for `data-tour` values. Components and tour steps
 * both read from here, so a renamed anchor cannot silently desynchronise.
 */
export const TOUR_ANCHORS = {
  shellNav: "shell-nav",
  dashboardWelcome: "dashboard-welcome",
  dashboardStats: "dashboard-stats",
  dashboardFilters: "dashboard-filters",
  dashboardPapers: "dashboard-papers",
  dashboardResume: "dashboard-resume",
  paperHeader: "paper-header",
  paperCaveats: "paper-caveats",
  paperStats: "paper-stats",
  paperItems: "paper-items",
  itemHeader: "item-header",
  itemClaim: "item-claim",
  itemFindings: "item-findings",
  itemComparator: "item-comparator",
  itemHistory: "item-history",
  guideIntro: "guide-intro",
  guideJob: "guide-job",
  guideTours: "guide-tours",
  guideChecklist: "guide-checklist",
  guideProtocol: "guide-protocol",
  guideContact: "guide-contact",
} as const

export type TourAnchor = (typeof TOUR_ANCHORS)[keyof typeof TOUR_ANCHORS]

/**
 * Anchor near the end of the page content. Wait for it before preparing the
 * steps: on a cross-page start the header may render before the page body, and
 * filtering too early would drop most of the tour.
 */
export const TOUR_READY_ANCHORS: Record<TourId, TourAnchor> = {
  guide: TOUR_ANCHORS.guideContact,
  dashboard: TOUR_ANCHORS.dashboardPapers,
  paper: TOUR_ANCHORS.paperItems,
  item: TOUR_ANCHORS.itemHistory,
}

const PATH_TOURS: ReadonlyArray<readonly [TourId, RegExp]> = [
  ["guide", /^\/guide\/?$/],
  ["dashboard", /^\/dashboard\/?$/],
  ["item", /^\/batches\/[^/]+\/items\/[^/]+\/?$/],
  ["paper", /^\/batches\/[^/]+\/papers\/[^/]+\/?$/],
]

export function parseTourId(value: string | null | undefined): TourId | null {
  if (!value) {
    return null
  }
  return TOUR_IDS.find((id) => id === value) ?? null
}

export function tourIdForPath(pathname: string): TourId | null {
  for (const [id, pattern] of PATH_TOURS) {
    if (pattern.test(pathname)) {
      return id
    }
  }
  return null
}

export function isTourPath(pathname: string): boolean {
  return tourIdForPath(pathname) !== null
}

/** Static tour destinations. Paper and item need real ids. */
export function tourHref(id: TourId): string | null {
  switch (id) {
    case "guide":
    case "dashboard":
      return `/${id}`
    case "paper":
    case "item":
      return null
  }
}

/** Add `?tour=` to a path without dropping an existing query or hash. */
export function withTourParam(href: string, id: TourId): string {
  const hashIndex = href.indexOf("#")
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex)
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const queryIndex = withoutHash.indexOf("?")
  const path =
    queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex)
  const query = queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1)
  const params = new URLSearchParams(query)
  params.set(TOUR_QUERY_PARAM, id)
  return `${path}?${params.toString()}${hash}`
}

/**
 * Remove only the transient tour key. Other query parameters keep their order
 * and value, and the result keeps the leading `?` when something remains.
 */
export function stripTourParam(search: string): string {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  )
  params.delete(TOUR_QUERY_PARAM)
  const query = params.toString()
  return query === "" ? "" : `?${query}`
}
