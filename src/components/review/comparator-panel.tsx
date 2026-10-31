import { Bot, FileCode2, Quote } from "lucide-react"

import { SeverityBadge } from "@/components/review/severity-badge"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { formatLineRange, formatSide } from "@/lib/review/format"
import type {
  ComparatorInfo,
  ReviewFinding,
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

function FindingSummary({ finding }: { finding: ReviewFinding }) {
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{formatSide(finding.side)}</Badge>
          <SeverityBadge severity={finding.severity} />
          <Badge variant="outline">{finding.status}</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {finding.idLocal}
          </span>
        </div>
        <CardTitle>{finding.title}</CardTitle>
        <CardDescription className="flex flex-wrap gap-2">
          {finding.category ? <span>{finding.category}</span> : null}
          {finding.topic ? <span>· {finding.topic}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {finding.quote ? (
          <blockquote className="flex gap-2 rounded-md border-l-2 border-border bg-muted/40 p-3">
            <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs whitespace-pre-wrap">
              {finding.quote}
            </span>
          </blockquote>
        ) : null}

        <dl className="flex flex-col gap-2">
          <DetailField label="Claim" value={finding.claim} />
          <DetailField label="Concern" value={finding.concern} />
          <DetailField label="Resolution" value={finding.resolution} />
        </dl>

        <Separator />

        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              File
            </dt>
            <dd className="flex items-start gap-1 font-mono text-xs break-all">
              <FileCode2 className="mt-0.5 size-3.5 shrink-0" />
              {finding.file}
            </dd>
          </div>
          <DetailField
            label="Lines"
            value={formatLineRange(finding.lineStart, finding.lineEnd)}
          />
          <DetailField label="Paper reference" value={finding.paperRef} />
          <DetailField label="Check script" value={finding.checkScript} />
        </dl>

        <VerificationDetails verification={finding.verification} />
      </CardContent>
    </Card>
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

export function ComparatorPanel({ item }: { item: ReviewItem }) {
  const sides =
    item.findings.auditowl.length > 0 && item.findings.agent.length > 0
      ? (["auditowl", "agent"] as const)
      : item.findings.auditowl.length > 0
        ? (["auditowl"] as const)
        : (["agent"] as const)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot data-icon="inline-start" />
            LLM comparator
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

      <section
        className={
          sides.length === 2 ? "grid gap-4 md:grid-cols-2" : "grid gap-4"
        }
      >
        {sides.map((side) => (
          <div key={side} className="flex min-w-0 flex-col gap-3">
            <h2 className="font-heading text-sm font-medium">
              {formatSide(side)} finding
            </h2>
            {item.findings[side].length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No finding on this side.
              </p>
            ) : (
              item.findings[side].map((finding) => (
                <FindingSummary key={finding.idLocal} finding={finding} />
              ))
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
