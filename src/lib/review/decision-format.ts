import {
  agentOnlyDecisionSchema,
  auditowlOnlyDecisionSchema,
  clusterDecisionSchema,
  draftDecisionSchema,
  relatedDecisionSchema,
  type DecisionStatus,
  type ItemKind,
} from "@/lib/review/types"

export interface DecisionSummary {
  verdict: string
  details: string[]
  note: string | null
}

const CLUSTER_LABELS = {
  same_defect: "Same defect",
  not_a_match: "Not a match",
  unsure: "Unsure",
} as const

const AGENT_LABELS = {
  confirmed_valid: "Confirmed valid",
  partly_valid: "Partly valid",
  invalid: "Invalid",
  not_checked: "Not checked",
  unsure: "Unsure",
} as const

const AUDITOWL_LABELS = {
  agent_missed: "Agent missed it",
  scope_difference: "Scope difference",
  revision_difference: "Revision difference",
  invalid_original_finding: "Invalid original finding",
  unclear: "Unclear",
  unsure: "Unsure",
} as const

const RELATED_LABELS = {
  agree_not_matched: "Agree: not matched",
  same_defect: "Same defect (missed match)",
  unsure: "Unsure",
} as const

export const DECISION_STATUS_LABELS: Readonly<Record<DecisionStatus, string>> =
  {
    draft: "Draft",
    closed: "Closed",
    unsure: "Unsure",
  }

function humanize(value: string): string {
  return value.replace(/_/g, " ")
}

export function formatDecisionStatus(status: DecisionStatus): string {
  return DECISION_STATUS_LABELS[status]
}

export function formatDecisionEventStatus(
  status: DecisionStatus | "reopened"
): string {
  return status === "reopened" ? "Reopened" : formatDecisionStatus(status)
}

/**
 * Turn a stored payload into display text. Malformed payloads are shown as
 * unreadable instead of crashing a page.
 */
export function describeDecision(
  kind: ItemKind,
  payload: unknown
): DecisionSummary {
  switch (kind) {
    case "cluster": {
      const parsed = clusterDecisionSchema.safeParse(payload)
      if (!parsed.success) {
        return draftSummary(payload)
      }
      const decision = parsed.data
      const details: string[] = []
      if (decision.acceptedAsProposed) {
        details.push("Labels accepted as proposed")
      } else {
        if (decision.strength) {
          details.push(`Strength: ${humanize(decision.strength)}`)
        }
        if (decision.coverage) {
          details.push(`Coverage: ${humanize(decision.coverage)}`)
        }
        if (decision.verification) {
          details.push(`Verification: ${humanize(decision.verification)}`)
        }
      }
      return {
        verdict: CLUSTER_LABELS[decision.verdict],
        details,
        note: emptyToNull(decision.note),
      }
    }
    case "agent_only": {
      const parsed = agentOnlyDecisionSchema.safeParse(payload)
      if (!parsed.success) {
        return draftSummary(payload)
      }
      const decision = parsed.data
      const details: string[] = []
      if (decision.severity) {
        details.push(`Corrected severity: ${decision.severity}`)
      }
      if (decision.novelty) {
        details.push(`Novelty: ${humanize(decision.novelty)}`)
      }
      if (decision.proposedLink) {
        details.push(
          `Links to ${humanize(decision.proposedLink.kind)} ${decision.proposedLink.ref}`
        )
      }
      return {
        verdict: AGENT_LABELS[decision.verdict],
        details,
        note: emptyToNull(decision.note),
      }
    }
    case "auditowl_only": {
      const parsed = auditowlOnlyDecisionSchema.safeParse(payload)
      if (!parsed.success) {
        return draftSummary(payload)
      }
      const decision = parsed.data
      const details = [`Assessment: ${humanize(decision.assessment)}`]
      if (decision.proposedLink) {
        details.push(
          `Links to ${humanize(decision.proposedLink.kind)} ${decision.proposedLink.ref}`
        )
      }
      return {
        verdict: AUDITOWL_LABELS[decision.verdict],
        details,
        note: emptyToNull(decision.note),
      }
    }
    case "related": {
      const parsed = relatedDecisionSchema.safeParse(payload)
      if (!parsed.success) {
        return draftSummary(payload)
      }
      return {
        verdict: RELATED_LABELS[parsed.data.verdict],
        details: [],
        note: emptyToNull(parsed.data.note),
      }
    }
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function draftSummary(payload: unknown): DecisionSummary {
  const parsed = draftDecisionSchema.safeParse(payload)
  if (parsed.success) {
    return {
      verdict: humanize(parsed.data.verdict),
      details: [],
      note: emptyToNull(parsed.data.note),
    }
  }
  return invalidSummary()
}

function invalidSummary(): DecisionSummary {
  return {
    verdict: "Unreadable decision",
    details: [],
    note: null,
  }
}
