import { FileCode2, FileSearch, Quote } from "lucide-react"

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
import type { ReviewFinding, ReviewItem } from "@/lib/review/types"

function FindingDetail({ finding }: { finding: ReviewFinding }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{formatSide(finding.side)}</Badge>
        <SeverityBadge severity={finding.severity} />
        <span className="font-mono text-xs text-muted-foreground">
          {finding.idLocal}
        </span>
        {finding.status === "question" ? (
          <Badge variant="secondary">Question</Badge>
        ) : null}
      </div>

      <h3 className="font-heading text-base font-medium text-balance">
        {finding.title}
      </h3>

      {finding.quote ? (
        <blockquote className="flex gap-2 rounded-md border-l-2 border-border bg-muted/40 p-3">
          <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-mono text-xs whitespace-pre-wrap">
            {finding.quote}
          </span>
        </blockquote>
      ) : null}

      <div className="flex flex-col gap-2">
        {finding.claim ? (
          <p className="text-sm leading-relaxed">{finding.claim}</p>
        ) : null}
        {finding.concern ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Concern: </span>
            {finding.concern}
          </p>
        ) : null}
        {finding.resolution ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Resolution: </span>
            {finding.resolution}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <FileCode2 data-icon="inline-start" />
          <span className="font-mono break-all">{finding.file}</span>
          <span>· {formatLineRange(finding.lineStart, finding.lineEnd)}</span>
        </span>
        {finding.paperRef ? <span>Paper {finding.paperRef}</span> : null}
        {finding.checkScript ? (
          <span className="font-mono break-all">
            Check {finding.checkScript}
          </span>
        ) : null}
      </div>
    </section>
  )
}

/** The actual findings, shown before the decision and the evidence viewer. */
export function FindingOverview({ item }: { item: ReviewItem }) {
  const findings = [...item.findings.auditowl, ...item.findings.agent]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSearch data-icon="inline-start" />
          Finding
        </CardTitle>
        {item.summary ? (
          <CardDescription>{item.summary}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No finding text was recorded for this item.
          </p>
        ) : (
          findings.map((finding, index) => (
            <div key={finding.id} className="flex flex-col gap-5">
              {index > 0 ? <Separator /> : null}
              <FindingDetail finding={finding} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
