import type { TourAlign, TourSide, TourStep } from "@/components/ui/tour"
import {
  TOUR_ANCHORS,
  type TourAnchor,
  type TourId,
} from "@/lib/review/tour-routes"

function anchored(
  anchor: TourAnchor,
  title: string,
  content: string,
  side: TourSide = "bottom",
  align: TourAlign = "start"
): TourStep {
  return {
    title,
    content,
    target: `[data-tour="${anchor}"]`,
    side,
    align,
  }
}

function intro(title: string, content: string): TourStep {
  return { title, content }
}

export const TOUR_STEPS: Record<TourId, TourStep[]> = {
  guide: [
    intro(
      "Start here",
      "This page is the short version of the protocol. The tour shows the parts you will keep coming back to."
    ),
    anchored(
      TOUR_ANCHORS.guideIntro,
      "The short version",
      "Why we are doing this, and what your decision changes. If you only read one section, read this one."
    ),
    anchored(
      TOUR_ANCHORS.guideJob,
      "Three shapes of work",
      "Most items are either a proposed match cluster or a finding that only one system reported.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.guideTours,
      "A tour for every page",
      "Each reviewer page has its own two-minute tour. You can start one here or from the page itself.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.guideChecklist,
      "Evidence first",
      "The order we recommend: code, check output, paper context, then decide. The comparator is a hint, not proof.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.guideProtocol,
      "The exact words",
      "The vocabulary used by the decision form and the exports. You do not need to memorise it; it is here when a label is unclear.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.guideContact,
      "Tell me when it breaks",
      "If the evidence is missing, the protocol is ambiguous or something looks wrong, write to me with the ids.",
      "top"
    ),
  ],
  dashboard: [
    intro(
      "Home base",
      "This is where you pick a batch, see the queue and reopen the item you were working on."
    ),
    anchored(
      TOUR_ANCHORS.shellNav,
      "Where things live",
      "The header holds the workspace navigation, the batch selector and your account menu."
    ),
    anchored(
      TOUR_ANCHORS.dashboardWelcome,
      "Your dashboard",
      "A quick welcome and a way back into the guide whenever you need the protocol."
    ),
    anchored(
      TOUR_ANCHORS.dashboardStats,
      "Progress",
      "How many items are open, claimed, unsure or closed across the active batch.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.dashboardFilters,
      "Narrow it down",
      "Filters for severity, type, status or your own assignments. The search box matches titles, refs and paper ids.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.dashboardPapers,
      "The papers",
      "Each row is one paper with its severity mix and completion. Open a paper to see its current items.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.dashboardResume,
      "Pick up work",
      "This button resumes your most recent claim, or opens the next unclaimed item if you have none."
    ),
  ],
  paper: [
    intro(
      "One paper at a time",
      "This page collects everything the batch knows about a single paper: its caveats, progress and review items."
    ),
    anchored(
      TOUR_ANCHORS.paperHeader,
      "The header",
      "The paper title, its AuditOwl status and the repository and PDF links live here. Check the revision before trusting a citation."
    ),
    anchored(
      TOUR_ANCHORS.paperCaveats,
      "Caveats first",
      "Read the scope notes and revision warnings before judging overlap. They explain when a match is only provisional."
    ),
    anchored(
      TOUR_ANCHORS.paperStats,
      "Paper progress",
      "Completion for this paper, split by status and severity. All items on the paper count, not just the filtered view.",
      "top"
    ),
    anchored(
      TOUR_ANCHORS.paperItems,
      "The item list",
      "Tabs separate match clusters, new findings, AuditOwl-only findings and related pairs. Open an item to review it.",
      "top"
    ),
  ],
  item: [
    intro(
      "The decision page",
      "Everything you need for one decision is on this page. The tour follows the order we recommend reading it in."
    ),
    anchored(
      TOUR_ANCHORS.itemHeader,
      "What you are judging",
      "The item kind, severity and the exact question. The paper and repository links are one click away."
    ),
    anchored(
      TOUR_ANCHORS.itemClaim,
      "Reserve and decide",
      "Reserve it if it is open; when the item is yours to edit, the decision form opens from this bar. Unsure releases the claim and keeps your note visible."
    ),
    anchored(
      TOUR_ANCHORS.itemFindings,
      "The findings",
      "Each side expands to compare the claim, the cited lines and the verification note. Code evidence and check output are attached here.",
      "bottom",
      "center"
    ),
    anchored(
      TOUR_ANCHORS.itemComparator,
      "The comparator",
      "What the comparison agent proposed: relation, strength, coverage and closest neighbours. Accept it only when the evidence agrees.",
      "bottom",
      "center"
    ),
    anchored(
      TOUR_ANCHORS.itemHistory,
      "What happened before",
      "Final decisions, unsure notes and admin reopens, newest first. A later draft never erases an earlier unsure note.",
      "top",
      "start"
    ),
  ],
}

/**
 * Drop steps whose anchor is not on the current page. Call this when a tour
 * starts rather than when the module loads, because the page may still be
 * hydrating or showing an empty state.
 */
export function prepareTourSteps(id: TourId): TourStep[] {
  return TOUR_STEPS[id].filter((step) => {
    if (typeof step.target !== "string") {
      return true
    }
    return document.querySelector(step.target) !== null
  })
}
