import { describe, expect, it } from "vitest"

import {
  decisionSchemasByKind,
  parseDecisionPayload,
  validateDecisionPayload,
} from "@/lib/review/types"

describe("decision notes", () => {
  it("requires a note for not_a_match and unsure clusters", () => {
    expect(
      decisionSchemasByKind.cluster.safeParse({
        verdict: "not_a_match",
        note: "",
      }).success
    ).toBe(false)
    expect(
      decisionSchemasByKind.cluster.safeParse({
        verdict: "unsure",
        note: "   ",
      }).success
    ).toBe(false)
    expect(
      decisionSchemasByKind.cluster.safeParse({
        verdict: "same_defect",
        note: "",
      }).success
    ).toBe(true)
  })

  it("requires a note for unsure and not_checked agent-only decisions", () => {
    for (const verdict of ["unsure", "not_checked"] as const) {
      expect(
        decisionSchemasByKind.agent_only.safeParse({ verdict, note: "" })
          .success
      ).toBe(false)
    }
  })

  it("requires a note for unsure AuditOwl-only and related decisions", () => {
    expect(
      decisionSchemasByKind.auditowl_only.safeParse({
        verdict: "unsure",
        assessment: "confirmed_valid",
        note: "",
      }).success
    ).toBe(false)
    expect(
      decisionSchemasByKind.related.safeParse({
        verdict: "unsure",
        note: "",
      }).success
    ).toBe(false)
  })
})

describe("kind-specific decision parsing", () => {
  it("selects the schema by item kind", () => {
    expect(
      parseDecisionPayload("cluster", {
        verdict: "same_defect",
        note: "",
      })
    ).toEqual({ verdict: "same_defect", note: "" })
  })

  it("does not parse unsure as the wrong kind", () => {
    expect(() =>
      parseDecisionPayload("cluster", {
        verdict: "unsure",
        assessment: "confirmed_valid",
        note: "x",
      })
    ).toThrow()
  })

  it("allows proposedLink only on agent-only and AuditOwl-only items", () => {
    expect(
      decisionSchemasByKind.cluster.safeParse({
        verdict: "same_defect",
        note: "",
        proposedLink: { kind: "agent_only", ref: "a1" },
      }).success
    ).toBe(false)
    expect(
      decisionSchemasByKind.related.safeParse({
        verdict: "same_defect",
        note: "",
        proposedLink: { kind: "agent_only", ref: "a1" },
      }).success
    ).toBe(false)
    expect(
      decisionSchemasByKind.agent_only.safeParse({
        verdict: "confirmed_valid",
        note: "",
        proposedLink: { kind: "auditowl_only", ref: "o1" },
      }).success
    ).toBe(true)
    expect(
      decisionSchemasByKind.auditowl_only.safeParse({
        verdict: "agent_missed",
        assessment: "confirmed_valid",
        note: "",
        proposedLink: { kind: "agent_only", ref: "a1" },
      }).success
    ).toBe(true)
  })
})

describe("agent-only not_checked severity", () => {
  it("is rejected above low severity", () => {
    expect(() =>
      validateDecisionPayload(
        "agent_only",
        { verdict: "not_checked", note: "could not run" },
        "medium"
      )
    ).toThrow()
  })

  it("is accepted for low severity", () => {
    expect(
      validateDecisionPayload(
        "agent_only",
        { verdict: "not_checked", note: "could not run" },
        "low"
      )
    ).toEqual({ verdict: "not_checked", note: "could not run" })
  })
})
