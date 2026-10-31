"use client"

import {
  AlertTriangle,
  CheckSquare,
  FileText,
  ScrollText,
  ShieldCheck,
  Terminal,
} from "lucide-react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CheckView } from "@/components/review/check-view"
import { CodeView } from "@/components/review/code-view"
import {
  MissingPaperPdf,
  PaperPdfViewer,
  PaperView,
} from "@/components/review/paper-view"
import { ReportView } from "@/components/review/report-view"
import type { EvidenceBundle } from "@/lib/review/evidence"
import { formatSide } from "@/lib/review/format"

function healthVariant(value: number, total: number) {
  if (total === 0) {
    return "outline" as const
  }
  return value === total ? ("secondary" as const) : ("destructive" as const)
}

function FindingHeading({
  side,
  idLocal,
  title,
}: {
  side: EvidenceBundle["sides"][number]["side"]
  idLocal: string
  title: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {formatSide(side)} · {idLocal}
      </p>
      <h3 className="font-heading text-sm font-medium">{title}</h3>
    </div>
  )
}

export function EvidencePanel({ bundle }: { bundle: EvidenceBundle }) {
  const { health } = bundle
  const checkCount = bundle.sides.reduce(
    (total, side) =>
      total +
      side.findings.reduce((sum, finding) => sum + finding.checks.length, 0),
    0
  )
  const hasChecks = checkCount > 0
  const paperEvidence = bundle.sides
    .flatMap((side) => side.findings)
    .map((finding) => finding.paper)
    .find((paper) => paper.pdfUrl !== null)
  const [pdfPage, setPdfPage] = useState(paperEvidence?.pages[0] ?? 1)
  const sharePdf = paperEvidence?.pdfUrl
    ? { url: paperEvidence.pdfUrl, page: pdfPage, onShowPage: setPdfPage }
    : null

  return (
    <Tabs defaultValue="code" className="gap-4">
      <div className="flex flex-col gap-3">
        <TabsList className="w-full">
          <TabsTrigger value="code">
            <Terminal data-icon="inline-start" />
            Code
          </TabsTrigger>
          <TabsTrigger value="checks">
            <CheckSquare data-icon="inline-start" />
            Checks
            <Badge variant="outline">{checkCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="paper">
            <FileText data-icon="inline-start" />
            Paper
          </TabsTrigger>
          <TabsTrigger value="reports">
            <ScrollText data-icon="inline-start" />
            Reports
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap gap-2">
          <Badge variant={healthVariant(health.codeResolved, health.codeTotal)}>
            code {health.codeResolved}/{health.codeTotal}
          </Badge>
          <Badge
            variant={
              health.quoteMissing > 0
                ? "destructive"
                : health.quoteFuzzy > 0
                  ? "outline"
                  : "secondary"
            }
          >
            quotes {health.quoteExact} exact · {health.quoteFuzzy} fuzzy ·{" "}
            {health.quoteMissing} missing
          </Badge>
          <Badge
            variant={healthVariant(health.checksResolved, health.checksTotal)}
          >
            checks {health.checksResolved}/{health.checksTotal}
          </Badge>
          <Badge
            variant={healthVariant(
              health.reportsAvailable,
              health.reportsTotal
            )}
          >
            reports {health.reportsAvailable}/{health.reportsTotal}
          </Badge>
          <Badge variant="outline">
            <ShieldCheck data-icon="inline-start" />
            {health.paperRefs} paper ref{health.paperRefs === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      <TabsContent value="code" className="flex flex-col gap-6">
        {bundle.sides.map((side) => (
          <section key={side.side} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-sm font-medium">
                {formatSide(side.side)}
              </h2>
              <Badge variant="outline">
                {side.totalFindings} finding
                {side.totalFindings === 1 ? "" : "s"}
              </Badge>
              {side.truncated ? (
                <Badge variant="outline">capped at 10</Badge>
              ) : null}
            </div>
            {side.findings.length === 0 ? (
              <Alert>
                <AlertTriangle />
                <AlertTitle>No findings on this side</AlertTitle>
                <AlertDescription>
                  This item has no {formatSide(side.side)} finding.
                </AlertDescription>
              </Alert>
            ) : (
              side.findings.map((finding) => (
                <div key={finding.idLocal} className="flex flex-col gap-2">
                  <FindingHeading
                    side={side.side}
                    idLocal={finding.idLocal}
                    title={finding.title}
                  />
                  <CodeView evidence={finding.code} />
                </div>
              ))
            )}
          </section>
        ))}
      </TabsContent>

      <TabsContent value="checks" className="flex flex-col gap-6">
        {!hasChecks ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>No check artifacts</AlertTitle>
            <AlertDescription>
              None of the findings on this item name a check script or a checked
              path.
            </AlertDescription>
          </Alert>
        ) : (
          bundle.sides.map((side) => (
            <section key={side.side} className="flex flex-col gap-3">
              <h2 className="font-heading text-sm font-medium">
                {formatSide(side.side)}
              </h2>
              {side.findings.map((finding) => (
                <div key={finding.idLocal} className="flex flex-col gap-2">
                  <FindingHeading
                    side={side.side}
                    idLocal={finding.idLocal}
                    title={finding.title}
                  />
                  <CheckView checks={finding.checks} />
                </div>
              ))}
            </section>
          ))
        )}
      </TabsContent>

      <TabsContent value="paper" className="flex flex-col gap-6">
        {sharePdf ? (
          <PaperPdfViewer url={sharePdf.url} page={sharePdf.page} />
        ) : (
          <MissingPaperPdf />
        )}
        {bundle.sides.map((side) => (
          <section key={side.side} className="flex flex-col gap-3">
            <h2 className="font-heading text-sm font-medium">
              {formatSide(side.side)}
            </h2>
            {side.findings.map((finding) => (
              <div key={finding.idLocal} className="flex flex-col gap-2">
                <FindingHeading
                  side={side.side}
                  idLocal={finding.idLocal}
                  title={finding.title}
                />
                <PaperView
                  evidence={finding.paper}
                  batchId={bundle.batchId}
                  paperId={bundle.paperId}
                  activePage={pdfPage}
                  onShowPage={sharePdf ? setPdfPage : null}
                />
              </div>
            ))}
          </section>
        ))}
      </TabsContent>

      <TabsContent value="reports" className="flex flex-col gap-6">
        {bundle.sides.map((side) => (
          <section key={side.side} className="flex flex-col gap-3">
            <h2 className="font-heading text-sm font-medium">
              {formatSide(side.side)}
            </h2>
            {side.findings.map((finding) => (
              <div key={finding.idLocal} className="flex flex-col gap-2">
                <FindingHeading
                  side={side.side}
                  idLocal={finding.idLocal}
                  title={finding.title}
                />
                <ReportView report={finding.report} />
              </div>
            ))}
          </section>
        ))}
      </TabsContent>
    </Tabs>
  )
}
