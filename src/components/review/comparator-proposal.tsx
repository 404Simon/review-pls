import { Bot } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  ComparatorInfo,
  ReviewItem,
  Verification,
} from "@/lib/review/types"

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

function VerificationDetails({
  verification,
}: {
  verification: Verification | null
}) {
  if (!verification) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      <DetailField label="Verification" value={verification.status} />
      <DetailField
        label="Verification note"
        value={verification.note ?? null}
      />
      {verification.checked && verification.checked.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Checked paths
          </span>
          <ul className="flex flex-col gap-1">
            {verification.checked.map((checked) => (
              <li key={checked} className="font-mono text-xs break-all">
                {checked}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
    { label: "Notes", value: comparator.note },
    { label: "Comparator anchor", value: comparator.anchor },
    { label: "Closest AuditOwl", value: comparator.closestAuditowl.join(", ") },
    { label: "Closest agent", value: comparator.closestAgent.join(", ") },
  ]
}

export function ComparatorProposal({ item }: { item: ReviewItem }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot data-icon="inline-start" />
          Comparator proposal
        </CardTitle>
        <CardDescription>
          Proposed labels, verification and checked paths from the automated
          comparator. This is not a human decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          {comparatorFields(item.comparator).map((field) => (
            <DetailField
              key={field.label}
              label={field.label}
              value={field.value}
            />
          ))}
        </dl>
        <VerificationDetails verification={item.comparator.verification} />
      </CardContent>
    </Card>
  )
}
