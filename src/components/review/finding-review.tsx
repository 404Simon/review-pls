"use client"

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { CheckView } from "@/components/review/check-view"
import { CodeView } from "@/components/review/code-view"
import { EvidenceSection } from "@/components/review/evidence-section"
import { hasPaperEvidence, PaperView } from "@/components/review/paper-view"
import { SeverityBadge } from "@/components/review/severity-badge"
import type { FindingEvidence } from "@/lib/review/evidence"
import { formatLineRange, formatSide } from "@/lib/review/format"
import type { ReviewFinding } from "@/lib/review/types"

function FindingDescription({
  finding,
  showPaperRef,
}: {
  finding: ReviewFinding
  showPaperRef: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {finding.claim ? (
        <p className="text-sm leading-relaxed">{finding.claim}</p>
      ) : null}
      {finding.concern ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Why it matters: </span>
          {finding.concern}
        </p>
      ) : null}
      {finding.resolution ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Suggested fix: </span>
          {finding.resolution}
        </p>
      ) : null}
      {showPaperRef && finding.paperRef ? (
        <p className="text-xs text-muted-foreground">
          Paper {finding.paperRef}
        </p>
      ) : null}
    </div>
  )
}

function codeSummary(evidence: FindingEvidence): string {
  if (evidence.code.kind === "missing") {
    return evidence.code.note ?? "The cited path was not found in the snapshot."
  }
  if (evidence.code.kind === "url") {
    return evidence.code.raw
  }
  const file = evidence.code.relativePath ?? evidence.code.raw
  return `${file} · ${formatLineRange(evidence.code.lineStart, evidence.code.lineEnd)}`
}

function checkSummary(evidence: FindingEvidence): string {
  const labels = [
    ...evidence.checks.filter((check) => check.role !== "script"),
    ...evidence.checks.filter((check) => check.role === "script"),
  ].map((check) => check.label)
  if (labels.length === 0) {
    return "No check artifact recorded"
  }
  return labels.length === 1
    ? labels[0]
    : `${labels[0]} + ${labels.length - 1} more`
}

function paperSummary(evidence: FindingEvidence): string {
  return evidence.paper.paperRef ?? "Paper reference"
}

function FindingEvidenceBody({ evidence }: { evidence: FindingEvidence }) {
  const citesOutput = evidence.code.kind === "check"
  const citesPaper = evidence.code.kind === "paper"
  const hasPaper = hasPaperEvidence(evidence.paper)

  return (
    <div className="flex flex-col gap-3">
      {citesOutput ? (
        <p className="text-xs text-muted-foreground">
          This finding cites an output artifact directly; the quoted row is
          highlighted under check evidence.
        </p>
      ) : citesPaper ? (
        <p className="text-xs text-muted-foreground">
          {hasPaper
            ? "This finding cites the paper directly; the matching extracted-text excerpt is shown under paper context."
            : "This finding cites the paper directly; no matching excerpt was found in the extracted text."}
        </p>
      ) : (
        <EvidenceSection
          title="Code cited"
          summary={codeSummary(evidence)}
          defaultOpen
        >
          <CodeView evidence={evidence.code} />
        </EvidenceSection>
      )}

      <EvidenceSection
        title="Check evidence"
        summary={checkSummary(evidence)}
        defaultOpen={citesOutput}
      >
        <CheckView checks={evidence.checks} />
      </EvidenceSection>

      {hasPaper ? (
        <EvidenceSection
          title="Paper context"
          summary={paperSummary(evidence)}
          defaultOpen={citesPaper}
        >
          <PaperView evidence={evidence.paper} />
        </EvidenceSection>
      ) : null}
    </div>
  )
}

export function FindingReview({
  value,
  finding,
  evidence,
}: {
  value: string
  finding: ReviewFinding
  evidence: FindingEvidence | null
}) {
  const hasPaper = evidence ? hasPaperEvidence(evidence.paper) : false

  return (
    <AccordionItem value={value}>
      <AccordionTrigger
        aria-label={`${formatSide(finding.side)} finding: ${finding.title}`}
        className="items-start gap-3 py-4 hover:no-underline"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatSide(finding.side)}</Badge>
            <SeverityBadge severity={finding.severity} />
            {finding.status === "question" ? (
              <Badge variant="secondary">Question</Badge>
            ) : null}
          </div>

          <span className="line-clamp-2 font-heading text-sm font-medium text-balance">
            {finding.title}
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent className="pb-4 [&_p:not(:last-child)]:mb-0">
        <div className="flex flex-col gap-4 border-t pt-4">
          <FindingDescription finding={finding} showPaperRef={!hasPaper} />
          {evidence ? (
            <FindingEvidenceBody evidence={evidence} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Evidence for this finding was not inspected on this page.
            </p>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
