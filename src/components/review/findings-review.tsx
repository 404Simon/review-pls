"use client"

import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { useState } from "react"

import { Accordion } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { FindingReview } from "@/components/review/finding-review"
import type { EvidenceBundle, FindingEvidence } from "@/lib/review/evidence"
import { formatCount } from "@/lib/review/format"
import type { ReviewFinding, ReviewItem } from "@/lib/review/types"

function findingKey(finding: Pick<ReviewFinding, "side" | "id">): string {
  return `${finding.side}:${finding.id}`
}

function defaultOpenIds(
  item: ReviewItem,
  findings: readonly ReviewFinding[]
): string[] {
  if (findings.length === 0) {
    return []
  }
  if (item.kind === "related") {
    return findings.map(findingKey)
  }
  if (item.kind === "cluster") {
    const umbrella =
      findings.find((finding) => finding.side === "auditowl") ?? findings[0]
    return [findingKey(umbrella)]
  }
  return findings.map(findingKey)
}

function groupTitle(
  item: ReviewItem,
  findings: readonly ReviewFinding[]
): string {
  if (findings.length === 0) {
    return "No findings"
  }
  if (item.kind === "cluster") {
    return formatCount(findings.length, "Grouped Finding")
  }
  if (item.kind === "related") {
    return formatCount(findings.length, "Related Finding")
  }
  return "The finding"
}

function groupSummary(
  item: ReviewItem,
  findings: readonly ReviewFinding[]
): string | null {
  if (item.kind === "related") {
    return item.summary
  }
  if (item.kind !== "cluster" || findings.length === 0) {
    return null
  }
  const auditowl = findings.filter(
    (finding) => finding.side === "auditowl"
  ).length
  const agent = findings.length - auditowl
  const parts: string[] = []
  if (auditowl > 0) {
    parts.push(`${auditowl} AuditOwl`)
  }
  if (agent > 0) {
    parts.push(`${agent} Review agent${agent === 1 ? "" : "s"}`)
  }
  return parts.join(" · ")
}

/**
 * The item's findings and evidence live together: the group heading counts all
 * findings (clusters can have many), and each finding expands to its own
 * description, code, checks and paper context.
 */
export function FindingsReview({
  item,
  bundle,
}: {
  item: ReviewItem
  bundle: EvidenceBundle
}) {
  const findings = [...item.findings.auditowl, ...item.findings.agent]
  const evidenceById = new Map<string, FindingEvidence>(
    bundle.sides.flatMap((side) =>
      side.findings.map((finding) => [findingKey(finding), finding])
    )
  )
  const allIds = findings.map(findingKey)
  const [openIds, setOpenIds] = useState<string[]>(() =>
    defaultOpenIds(item, findings)
  )
  const grouped = item.kind === "cluster" || item.kind === "related"
  const summary = groupSummary(item, findings)
  const truncated = bundle.sides.some((side) => side.truncated)

  return (
    <section
      id="evidence"
      tabIndex={-1}
      className="flex scroll-mt-24 flex-col gap-4 outline-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-medium">
            {groupTitle(item, findings)}
          </h2>
          {summary ? (
            <p className="text-sm text-muted-foreground">{summary}</p>
          ) : null}
          {grouped && findings.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              Expand a finding to see its claim, code, checks and paper context.
            </p>
          ) : null}
          {truncated ? (
            <p className="text-xs text-muted-foreground">
              Some findings were not inspected because of the per-side limit.
            </p>
          ) : null}
        </div>
        {grouped && findings.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setOpenIds(allIds)}
            >
              <ChevronsUpDown data-icon="inline-start" />
              Open all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setOpenIds([])}
            >
              <ChevronsDownUp data-icon="inline-start" />
              Collapse all
            </Button>
          </div>
        ) : null}
      </div>

      {findings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No finding text was recorded for this item.
        </p>
      ) : (
        <Accordion
          multiple
          value={openIds}
          onValueChange={(value) => setOpenIds(value as string[])}
          className="rounded-xl border bg-card px-4"
        >
          {findings.map((finding) => {
            const value = findingKey(finding)
            return (
              <FindingReview
                key={value}
                value={value}
                finding={finding}
                evidence={evidenceById.get(value) ?? null}
              />
            )
          })}
        </Accordion>
      )}
    </section>
  )
}
