import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  FileText,
  GitCompare,
  Keyboard,
  Lock,
  Scale,
  ShieldCheck,
  StickyNote,
  Tags,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SeverityBadge } from "@/components/review/severity-badge"
import { StatusBadge } from "@/components/review/status-badge"
import { SHORTCUTS } from "@/lib/review/shortcuts"

function Definition({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-border pl-3">
      <dt className="font-heading text-sm font-medium">{term}</dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  )
}

export default function GuidePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          <BookOpen data-icon="inline-start" />
          Protocol guide
        </Badge>
        <h1 className="font-heading text-2xl font-medium text-balance sm:text-3xl">
          How to review overlap and new findings
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The workspace asks two questions. First, is the finding-level overlap
          between AuditOwl and the review agent correct? Second, are the
          findings we have on top of AuditOwl actual findings? Every page keeps
          the evidence one click away so you can answer from the source, not
          from the comparator.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale data-icon="inline-start" />
              Definitions
            </CardTitle>
            <CardDescription>
              The vocabulary used by the decision form and exports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-4">
              <Definition term="Review unit">
                One item is one review decision. A match cluster is a single
                item even when it contains several findings on either side. An
                agent-only finding, an AuditOwl-only finding and a
                related-not-matched pair are each one item too.
              </Definition>
              <Definition term="Claim and lease">
                The first reviewer to reserve an item holds a two-hour idle
                lease. The lease extends while the item page is open and when a
                draft is saved. An expired lease returns the item to the pool.
                Only the active claimant can save a decision.
              </Definition>
              <Definition term="Unsure">
                Unsure is not a final classification. It records a note,
                releases the claim and puts the item back in the open pool. The
                next reviewer sees your note. The item is not counted as closed.
              </Definition>
              <Definition term="Read-only and reopening">
                A closed item is read-only for reviewers. You can still read the
                final decision, its note and the full history. An admin can
                release a live claim or reopen a closed item; reopening turns
                the final decision into an admin-owned draft and returns the
                item to the pool.
              </Definition>
              <Definition term="Severity">
                Severity is a triage signal, not the verdict.{" "}
                <SeverityBadge severity="high" /> is a destructive-tinted
                blocker, <SeverityBadge severity="medium" /> is warning-tinted
                and <SeverityBadge severity="low" /> is informational. A cluster
                takes the maximum severity of both sides. Related pairs take the
                maximum of the two findings.
              </Definition>
              <Definition term="Match, strength and coverage">
                A match is a pair or cluster that describes the same defect.{" "}
                <strong>Strength</strong> says how tightly the wording and
                evidence align: <code>exact</code>, <code>strong</code> or{" "}
                <code>weak</code>. <strong>Coverage</strong> says whether the
                two sides cover an equivalent scope or one is broader:{" "}
                <code>equivalent</code>, <code>agent_broader</code>,{" "}
                <code>auditowl_broader</code> or <code>partial</code>. Accept
                the proposed labels when they are right; adjust them when they
                are not.
              </Definition>
              <Definition term="Assessment">
                Assessment is your independent verdict on the underlying
                finding: <code>confirmed_valid</code>, <code>partly_valid</code>
                , <code>invalid</code> or <code>not_checked</code>. On
                AuditOwl-only items it answers “is the original finding valid?”,
                separately from why the agent missed it.
              </Definition>
              <Definition term="Novelty">
                Novelty describes how an agent-only finding relates to AuditOwl:{" "}
                <code>genuine_addition</code>, <code>variant_of_auditowl</code>,{" "}
                <code>out_of_scope</code> or <code>invalid</code>. It is
                optional, because the evidence may not settle it.
              </Definition>
              <Definition term="Miss reason">
                A miss reason classifies the gap on an AuditOwl-only item: the
                agent missed the finding, the two audits used different scopes,
                the repository revision differed, or the original finding is
                invalid. <code>unclear</code> is a final cannot-decide
                classification; <code>unsure</code> returns the item to the
                pool.
              </Definition>
              <Definition term="Proposed link">
                On an agent-only or AuditOwl-only item you may record that this
                is the same defect as a specific item on the opposite side. It
                is exported for adjudication; it never edits the other item. The
                comparator&apos;s closest suggestions appear first.
              </Definition>
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck data-icon="inline-start" />
                What to do for each item
              </CardTitle>
              <CardDescription>
                A short, evidence-first checklist.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3 text-sm">
                {[
                  "Reserve the item. Read the title and the comparator’s proposed labels, but do not treat them as the answer.",
                  "Open the evidence panel and check the cited lines. Confirm the quote badge and the line range.",
                  "Check the checks tab for the script output. If an artifact is missing, say so in the note.",
                  "Use the paper tab when the claim is about what the paper reports. Check the page reference.",
                  "Skim both audit reports for the surrounding argument, especially on miss reasons.",
                  "Choose a verdict. Adjust proposed labels only when the evidence supports a different strength, coverage or verification.",
                  "Write a short note with the line, output or page that decided it. Save and close, or mark unsure if the evidence is genuinely incomplete.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Keyboard data-icon="inline-start" />
                Keyboard shortcuts
              </CardTitle>
              <CardDescription>
                Ignored while typing in a field.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {SHORTCUTS.map((shortcut) => (
                  <div key={shortcut.keys} className="contents">
                    <dt>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {shortcut.keys}
                      </kbd>
                    </dt>
                    <dd className="text-muted-foreground">{shortcut.action}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code2 data-icon="inline-start" />
              Verify the code
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The code tab resolves the cited path inside the paper’s repository
            snapshot, shows 40 lines of context and highlights the cited range.
            Use “Open full file”, “Open repo tree” and “Search this repo” when
            the anchor is missing. An absence claim needs the tree and search
            more than the viewer.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText data-icon="inline-start" />
              Verify the paper
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The paper tab opens the PDF at the cited page and shows the
            finding’s quote above it. The text search covers the extracted text
            and tells you when only a prefix was searched. A page reference is a
            pointer, not proof; read the surrounding paragraph.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitCompare data-icon="inline-start" />
              Compare the sides
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Clusters and related pairs show both findings side by side. Check
            the claim, the cited file and the verification note on each side.
            Agreement in wording is not enough when the line ranges or the
            underlying defect differ.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck data-icon="inline-start" />
            Status at a glance
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <StatusBadge status="open" /> no active claim, no final decision
          </span>
          <span className="flex items-center gap-2">
            <StatusBadge status="claimed" /> a live two-hour claim
          </span>
          <span className="flex items-center gap-2">
            <StatusBadge status="unsure" /> the latest attempt is unsure
          </span>
          <span className="flex items-center gap-2">
            <StatusBadge status="closed" /> a final decision exists
          </span>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Lock data-icon="inline-start" /> Claims are first come, first served.
        </span>
        <span className="flex items-center gap-1.5">
          <StickyNote data-icon="inline-start" /> Unsure notes stay visible.
        </span>
        <span className="flex items-center gap-1.5">
          <Tags data-icon="inline-start" /> Labels are validated on the server.
        </span>
        <span className="flex items-center gap-1.5">
          <CheckCircle2 data-icon="inline-start" /> Closed means a human
          decision exists.
        </span>
      </div>
    </div>
  )
}
