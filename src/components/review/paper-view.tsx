import { FileText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PaperEvidence } from "@/lib/review/evidence"

export function hasPaperEvidence(evidence: PaperEvidence): boolean {
  return evidence.contexts.length > 0
}

/**
 * The paper side of the evidence trail: exact excerpts from the extracted paper
 * text where the finding's quote appears. A bare page reference is already in
 * the finding card, and the PDF itself lives in the page header.
 */
export function PaperView({ evidence }: { evidence: PaperEvidence }) {
  if (!hasPaperEvidence(evidence)) {
    return null
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <FileText data-icon="inline-start" />
          Paper context
          {evidence.paperRef ? (
            <span className="font-normal">{evidence.paperRef}</span>
          ) : null}
          {evidence.pages.map((page) => (
            <Badge key={page} variant="outline">
              p. {page}
            </Badge>
          ))}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {evidence.contexts.map((context) => (
          <blockquote
            key={`${context.page}-${context.offset}`}
            className="flex flex-col gap-2 rounded-md border-l-2 border-border bg-muted/40 p-3 text-xs leading-relaxed"
          >
            <span className="whitespace-pre-wrap">
              <span className="text-muted-foreground">{context.before}</span>
              <mark className="rounded bg-accent px-0.5 text-accent-foreground">
                {context.match}
              </mark>
              <span className="text-muted-foreground">{context.after}</span>
            </span>
            <Badge variant="outline" className="w-fit">
              p. {context.page}
            </Badge>
          </blockquote>
        ))}
      </CardContent>
    </Card>
  )
}
