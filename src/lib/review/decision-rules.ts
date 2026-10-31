import { z } from "zod"

import {
  agentOnlyDecisionSchema,
  auditowlOnlyDecisionSchema,
  clusterDecisionSchema,
  type DecisionPayload,
  type DraftDecision,
  type ProposedLink,
  type ReviewItem,
} from "@/lib/review/types"

function ruleError(
  path: (string | number)[],
  message: string,
  input: unknown
): z.ZodError {
  return new z.ZodError([{ code: "custom", path, message, input }])
}

function proposedValue(value: string | null | undefined): string | null {
  return value ?? null
}

function matchesProposed(
  actual: string | undefined,
  proposed: string | null
): boolean {
  return proposed === null ? actual === undefined : actual === proposed
}

function proposedVerificationStatus(item: ReviewItem): string | null {
  return proposedValue(item.comparator.verification?.status)
}

function assertAcceptedAsProposed(
  item: ReviewItem,
  decision: z.infer<typeof clusterDecisionSchema>
): void {
  if (decision.acceptedAsProposed !== true) {
    return
  }
  if (
    !matchesProposed(decision.strength, proposedValue(item.comparator.strength))
  ) {
    throw ruleError(
      ["strength"],
      "acceptedAsProposed requires the comparator's proposed strength",
      decision
    )
  }
  if (
    !matchesProposed(decision.coverage, proposedValue(item.comparator.coverage))
  ) {
    throw ruleError(
      ["coverage"],
      "acceptedAsProposed requires the comparator's proposed coverage",
      decision
    )
  }
  if (
    !matchesProposed(decision.verification, proposedVerificationStatus(item))
  ) {
    throw ruleError(
      ["verification"],
      "acceptedAsProposed requires the comparator's proposed verification",
      decision
    )
  }
}

function assertNotAMatchIsClean(
  decision: z.infer<typeof clusterDecisionSchema>
): void {
  if (decision.verdict !== "not_a_match") {
    return
  }
  if (decision.strength !== undefined) {
    throw ruleError(
      ["strength"],
      "not_a_match must not carry a strength",
      decision
    )
  }
  if (decision.coverage !== undefined) {
    throw ruleError(
      ["coverage"],
      "not_a_match must not carry a coverage",
      decision
    )
  }
}

function isOppositeOnlyKind(item: ReviewItem, link: ProposedLink): boolean {
  if (item.kind === "agent_only") {
    return link.kind === "auditowl_only"
  }
  if (item.kind === "auditowl_only") {
    return link.kind === "agent_only"
  }
  return false
}

function assertValidProposedLink(
  item: ReviewItem,
  link: ProposedLink,
  batchItems: readonly ReviewItem[]
): void {
  if (!isOppositeOnlyKind(item, link)) {
    throw ruleError(
      ["proposedLink", "kind"],
      "proposedLink must point at an item of the opposite side kind",
      link
    )
  }

  const target = batchItems.find(
    (candidate) =>
      candidate.paperId === item.paperId &&
      candidate.kind === link.kind &&
      candidate.ref === link.ref
  )
  if (!target) {
    throw ruleError(
      ["proposedLink", "ref"],
      "proposedLink must reference an existing item in the same paper",
      link
    )
  }
}

/**
 * Drafts may be incomplete, but a proposed link that is already present must
 * still point at a real opposite-side item in the same paper.
 */
export function validateDraftAgainstItem(
  item: ReviewItem,
  draft: DraftDecision,
  batchItems: readonly ReviewItem[]
): void {
  if (draft.proposedLink) {
    assertValidProposedLink(item, draft.proposedLink, batchItems)
  }
}

/**
 * Item-aware decision rules that cannot be expressed by the payload schema
 * alone. `not_checked` severity is enforced earlier by
 * `validateDecisionPayload`; this function adds comparator and cross-item rules.
 */
export function validateDecisionAgainstItem(
  item: ReviewItem,
  payload: DecisionPayload,
  batchItems: readonly ReviewItem[]
): void {
  switch (item.kind) {
    case "cluster": {
      const decision = clusterDecisionSchema.parse(payload)
      assertNotAMatchIsClean(decision)
      assertAcceptedAsProposed(item, decision)
      return
    }
    case "agent_only": {
      const decision = agentOnlyDecisionSchema.parse(payload)
      if (decision.proposedLink) {
        assertValidProposedLink(item, decision.proposedLink, batchItems)
      }
      return
    }
    case "auditowl_only": {
      const decision = auditowlOnlyDecisionSchema.parse(payload)
      if (decision.proposedLink) {
        assertValidProposedLink(item, decision.proposedLink, batchItems)
      }
      return
    }
    case "related":
      return
  }
}
