import { describe, expect, it } from "vitest"

import { ZodError } from "zod"

import { validateDecisionAgainstItem } from "@/lib/review/decision-rules"
import { createFixtureItems, getFixtureItem } from "@/lib/review/test-support"
import {
  MAX_DECISION_NOTE_LENGTH,
  parseDecisionPayload,
  type ClusterDecision,
} from "@/lib/review/types"

const items = createFixtureItems()
const cluster = getFixtureItem(items, "cluster", "M01")
const agentMedium = getFixtureItem(items, "agent_only", "a2")
const agentLow = getFixtureItem(items, "agent_only", "a3")
const auditowlOnly = getFixtureItem(items, "auditowl_only", "o2")

function clusterDecision(value: unknown): ClusterDecision {
  return parseDecisionPayload("cluster", value)
}

describe("cluster rules", () => {
  it("rejects not_a_match with strength or coverage", () => {
    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "not_a_match",
          note: "Different defect",
          strength: "exact",
        }),
        items
      )
    ).toThrow(ZodError)
    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "not_a_match",
          note: "Different defect",
          coverage: "partial",
        }),
        items
      )
    ).toThrow(ZodError)
  })

  it("rejects not_a_match marked acceptedAsProposed", () => {
    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "not_a_match",
          note: "Different defect",
          acceptedAsProposed: true,
        }),
        items
      )
    ).toThrow(ZodError)
  })

  it("rejects acceptedAsProposed for an unsure verdict", () => {
    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "unsure",
          note: "Needs another look",
          acceptedAsProposed: true,
        }),
        items
      )
    ).toThrow(ZodError)
  })

  it("checks the verification label against the comparator", () => {
    const verifiedCluster = {
      ...cluster,
      comparator: {
        ...cluster.comparator,
        verification: { status: "confirmed" },
      },
    }

    expect(() =>
      validateDecisionAgainstItem(
        verifiedCluster,
        clusterDecision({
          verdict: "same_defect",
          note: "",
          acceptedAsProposed: true,
          strength: "exact",
          coverage: "equivalent",
          verification: "confirmed",
        }),
        items
      )
    ).not.toThrow()

    expect(() =>
      validateDecisionAgainstItem(
        verifiedCluster,
        clusterDecision({
          verdict: "same_defect",
          note: "",
          acceptedAsProposed: true,
          strength: "exact",
          coverage: "equivalent",
          verification: "refuted",
        }),
        items
      )
    ).toThrow(ZodError)

    expect(() =>
      validateDecisionAgainstItem(
        verifiedCluster,
        clusterDecision({
          verdict: "same_defect",
          note: "",
          acceptedAsProposed: true,
          strength: "exact",
          coverage: "equivalent",
        }),
        items
      )
    ).toThrow(ZodError)
  })

  it("accepts acceptedAsProposed only when every proposed label matches", () => {
    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "same_defect",
          note: "",
          acceptedAsProposed: true,
          strength: "exact",
          coverage: "equivalent",
        }),
        items
      )
    ).not.toThrow()

    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "same_defect",
          note: "",
          acceptedAsProposed: true,
          strength: "weak",
          coverage: "equivalent",
        }),
        items
      )
    ).toThrow(ZodError)

    expect(() =>
      validateDecisionAgainstItem(
        cluster,
        clusterDecision({
          verdict: "same_defect",
          note: "",
          acceptedAsProposed: true,
          strength: "exact",
          coverage: "agent_broader",
        }),
        items
      )
    ).toThrow(ZodError)
  })
})

describe("proposedLink rules", () => {
  it("accepts a link to an existing item of the opposite kind in the same paper", () => {
    expect(() =>
      validateDecisionAgainstItem(
        agentMedium,
        parseDecisionPayload("agent_only", {
          verdict: "confirmed_valid",
          note: "",
          proposedLink: { kind: "auditowl_only", ref: auditowlOnly.ref },
        }),
        items
      )
    ).not.toThrow()

    expect(() =>
      validateDecisionAgainstItem(
        auditowlOnly,
        parseDecisionPayload("auditowl_only", {
          verdict: "agent_missed",
          assessment: "confirmed_valid",
          note: "",
          proposedLink: { kind: "agent_only", ref: agentLow.ref },
        }),
        items
      )
    ).not.toThrow()
  })

  it("rejects the same side kind", () => {
    expect(() =>
      validateDecisionAgainstItem(
        agentMedium,
        parseDecisionPayload("agent_only", {
          verdict: "confirmed_valid",
          note: "",
          proposedLink: { kind: "agent_only", ref: agentLow.ref },
        }),
        items
      )
    ).toThrow(ZodError)
  })

  it("rejects a missing item and an item from another paper", () => {
    expect(() =>
      validateDecisionAgainstItem(
        agentMedium,
        parseDecisionPayload("agent_only", {
          verdict: "confirmed_valid",
          note: "",
          proposedLink: { kind: "auditowl_only", ref: "missing" },
        }),
        items
      )
    ).toThrow(ZodError)

    const otherPaper = createFixtureItems(["p2"])
    expect(() =>
      validateDecisionAgainstItem(
        agentMedium,
        parseDecisionPayload("agent_only", {
          verdict: "confirmed_valid",
          note: "",
          proposedLink: { kind: "auditowl_only", ref: auditowlOnly.ref },
        }),
        otherPaper
      )
    ).toThrow(ZodError)
  })

  it("caps reviewer notes at the server boundary", () => {
    expect(() =>
      parseDecisionPayload("agent_only", {
        verdict: "confirmed_valid",
        note: "x".repeat(MAX_DECISION_NOTE_LENGTH + 1),
      })
    ).toThrow(ZodError)
    expect(
      parseDecisionPayload("agent_only", {
        verdict: "confirmed_valid",
        note: "x".repeat(MAX_DECISION_NOTE_LENGTH),
      }).note
    ).toHaveLength(MAX_DECISION_NOTE_LENGTH)
  })
})
