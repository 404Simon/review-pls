import { describe, expect, it } from "vitest"

import {
  describeDecision,
  formatDecisionEventStatus,
  formatDecisionStatus,
} from "@/lib/review/decision-format"

describe("describeDecision", () => {
  it("formats a cluster decision with adjusted labels", () => {
    expect(
      describeDecision("cluster", {
        verdict: "same_defect",
        strength: "strong",
        coverage: "agent_broader",
        verification: "partly_confirmed",
        note: "  same anchor  ",
      })
    ).toEqual({
      verdict: "Same defect",
      details: [
        "Strength: strong",
        "Coverage: agent broader",
        "Verification: partly confirmed",
      ],
      note: "same anchor",
    })
  })

  it("marks accepted-as-proposed and omits an empty note", () => {
    expect(
      describeDecision("cluster", {
        verdict: "same_defect",
        acceptedAsProposed: true,
        note: "   ",
      })
    ).toEqual({
      verdict: "Same defect",
      details: ["Labels accepted as proposed"],
      note: null,
    })
  })

  it("formats agent-only, AuditOwl-only and related payloads", () => {
    expect(
      describeDecision("agent_only", {
        verdict: "confirmed_valid",
        severity: "high",
        novelty: "genuine_addition",
        note: "verified",
      })
    ).toMatchObject({
      verdict: "Confirmed valid",
      details: ["Corrected severity: high", "Novelty: genuine addition"],
    })

    expect(
      describeDecision("auditowl_only", {
        verdict: "agent_missed",
        assessment: "confirmed_valid",
        note: "the agent skipped the table",
      })
    ).toEqual({
      verdict: "Agent missed it",
      details: ["Assessment: confirmed valid"],
      note: "the agent skipped the table",
    })

    expect(
      describeDecision("related", {
        verdict: "same_defect",
        note: "same loader",
      })
    ).toEqual({
      verdict: "Same defect (missed match)",
      details: [],
      note: "same loader",
    })
  })

  it("shows unreadable payloads instead of throwing", () => {
    expect(describeDecision("cluster", { verdict: "nonsense" })).toEqual({
      verdict: "Unreadable decision",
      details: [],
      note: null,
    })
  })
})

describe("status labels", () => {
  it("formats decision and event statuses", () => {
    expect(formatDecisionStatus("draft")).toBe("Draft")
    expect(formatDecisionStatus("unsure")).toBe("Unsure")
    expect(formatDecisionEventStatus("closed")).toBe("Closed")
    expect(formatDecisionEventStatus("reopened")).toBe("Reopened")
  })
})
