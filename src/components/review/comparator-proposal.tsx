import { Bot } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ComparatorInfo, ReviewItem } from "@/lib/review/types"

function DetailField({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
        {trimmed}
      </dd>
    </div>
  )
}

function comparatorFields(comparator: ComparatorInfo) {
  return [
    { label: "Relation", value: comparator.relation },
    { label: "Coverage", value: comparator.coverage },
    { label: "Strength", value: comparator.strength },
    { label: "Severity agreement", value: comparator.severityAgreement },
    { label: "Status agreement", value: comparator.statusAgreement },
    { label: "Proposed assessment", value: comparator.proposedAssessment },
    { label: "Proposed novelty", value: comparator.proposedNovelty },
    { label: "Miss reason", value: comparator.missReason },
    { label: "Related reason", value: comparator.relatedReason },
    { label: "Agent adds", value: comparator.agentAdds },
    { label: "AuditOwl adds", value: comparator.auditowlAdds },
    { label: "Closest AuditOwl", value: comparator.closestAuditowl.join(", ") },
    { label: "Closest agent", value: comparator.closestAgent.join(", ") },
    { label: "Comparator note", value: comparator.note },
  ].filter((field) => field.value?.trim())
}

/**
 * Compact summary of the automated comparison. Verification status, note and
 * checked paths live in the evidence panel instead, so they are not repeated.
 */
export function ComparatorProposal({ item }: { item: ReviewItem }) {
  const fields = comparatorFields(item.comparator)
  if (fields.length === 0) {
    return null
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot data-icon="inline-start" />
          Automated comparator
        </CardTitle>
        <CardDescription>
          Proposed labels from the automated comparison. This is not a reviewer
          decision.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <DetailField
              key={field.label}
              label={field.label}
              value={field.value}
            />
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
