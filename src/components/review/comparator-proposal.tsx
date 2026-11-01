import { Bot, ShieldCheck } from "lucide-react"

import { CheckView } from "@/components/review/check-view"
import { EvidenceSection } from "@/components/review/evidence-section"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  CheckEvidence,
  EvidenceBundle,
  VerificationEvidence,
} from "@/lib/review/evidence"
import { formatCount } from "@/lib/review/format"
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
 * Verification artifacts already rendered as a finding's own output check are
 * not repeated here.
 */
function extraVerificationOutputs(
  bundle: EvidenceBundle,
  verification: VerificationEvidence
): CheckEvidence[] {
  const findingOutputs = new Set(
    bundle.sides.flatMap((side) =>
      side.findings.flatMap((finding) =>
        finding.checks
          .filter((check) => check.role === "output")
          .map((check) => check.label)
      )
    )
  )
  return verification.artifacts.filter(
    (artifact) => !findingOutputs.has(artifact.label)
  )
}

/**
 * Everything the automated comparison produced for the item: the proposed
 * labels and the verification status, note, checked paths and output
 * artifacts. One card, because the verification is part of the same
 * comparator report rather than separate reviewer evidence.
 */
export function ComparatorProposal({
  item,
  bundle,
}: {
  item: ReviewItem
  bundle: EvidenceBundle
}) {
  const fields = comparatorFields(item.comparator)
  const verification = bundle.verification
  const showVerification =
    verification !== null &&
    Boolean(
      verification.status ||
      verification.note ||
      verification.checked.length > 0
    )
  if (fields.length === 0 && !showVerification) {
    return null
  }

  const outputs = verification
    ? extraVerificationOutputs(bundle, verification)
    : []

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Bot data-icon="inline-start" />
          Automated comparator
          {verification?.status ? (
            <Badge>{verification.status.replaceAll("_", " ")}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Proposed labels and verification from the automated comparison. This
          is not a reviewer decision.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fields.length > 0 ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <DetailField
                key={field.label}
                label={field.label}
                value={field.value}
              />
            ))}
          </dl>
        ) : null}
        {verification && showVerification ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck data-icon="inline-start" />
              Verification
            </h3>
            {verification.note ? (
              <p className="text-sm whitespace-pre-wrap text-foreground">
                {verification.note}
              </p>
            ) : null}
            {outputs.length > 0 ? (
              <EvidenceSection
                title="Verified outputs"
                summary={formatCount(outputs.length, "artifact")}
              >
                <CheckView checks={outputs} />
              </EvidenceSection>
            ) : null}
            {verification.checked.length > 0 ? (
              <EvidenceSection
                title="Checked paths"
                summary={formatCount(verification.checked.length, "path")}
              >
                <ul className="grid gap-1 sm:grid-cols-2">
                  {verification.checked.map((checked) => (
                    <li key={checked} className="font-mono text-xs break-all">
                      {checked}
                    </li>
                  ))}
                </ul>
              </EvidenceSection>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
