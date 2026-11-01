import {
  CheckCircle2,
  ClipboardCheck,
  Compass,
  FileSearch,
  FileText,
  GitCompare,
  Keyboard,
  LayoutDashboard,
  Lock,
  Mail,
  Scale,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Tags,
  type LucideIcon,
} from "lucide-react"

import { SeverityBadge } from "@/components/review/severity-badge"
import { StatusBadge } from "@/components/review/status-badge"
import { TourStartButton } from "@/components/review/tour-start-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getContactEmail } from "@/lib/contact-email"
import { loadGuideExample, type GuideExample } from "@/lib/review/guide-example"
import { SHORTCUTS } from "@/lib/review/shortcuts"
import {
  TOUR_ANCHORS,
  TOUR_IDS,
  TOURS,
  type TourId,
} from "@/lib/review/tour-routes"

const TOUR_ICONS: Record<TourId, LucideIcon> = {
  guide: Compass,
  dashboard: LayoutDashboard,
  paper: FileText,
  item: ClipboardCheck,
}

const CHECKLIST = [
  "Reserve the item. The claim is yours for two idle hours; it extends while the page is open and whenever a draft is saved.",
  "Read the automated verification note. It usually says what was checked and what came back.",
  "Take a look at the evidence. Beware that for obvious findings it might not be necessary.",
  "Use the paper context excerpt when the finding depends on what the paper reports. A page reference is a pointer, not proof.",
  "Compare both sides for a cluster or a related pair. Matching wording is not enough when the line ranges or the defects differ.",
  "Decide and optionally add a concrete note naming the line, output or page that settled it. Save and close, or mark unsure if the evidence is genuinely incomplete.",
] as const

function exampleHref(
  id: TourId,
  example: GuideExample | null
): string | undefined {
  if (!example) {
    return undefined
  }
  switch (id) {
    case "paper":
      return example.paperHref
    case "item":
      return example.itemHref
    case "guide":
    case "dashboard":
      return undefined
  }
}

function exampleTitle(
  id: TourId,
  example: GuideExample | null
): string | undefined {
  if (!example) {
    return undefined
  }
  switch (id) {
    case "paper":
      return example.paperTitle
    case "item":
      return example.itemTitle
    case "guide":
    case "dashboard":
      return undefined
  }
}

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

export default async function GuidePage() {
  const contactEmail = getContactEmail()
  const example = await loadGuideExample()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
      <header
        data-tour={TOUR_ANCHORS.guideIntro}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-2xl flex-col gap-2">
            <h1 className="font-heading text-2xl font-medium text-balance sm:text-3xl">
              Thank you for checking our agent
            </h1>
            <p className="text-sm text-muted-foreground">
              This page explains what we are comparing, why your
              decision matters and how the workspace is organised.
            </p>
          </div>
          <TourStartButton tour="guide" />
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium">
          What are we doing here?
        </h2>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            The authors of{" "}
            <a
              href="https://openreview.net/forum?id=xjCJY8Xxcm"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-foreground underline underline-offset-4"
            >
              this paper
            </a>{" "}
            ran agentic reviews over 100 NeurIPS papers, looking for
            reproducibility problems and general software bugs. Its finding
            was uncomfortable: many of their claims, e.g. a headline number, cannot be traced back to the code that produces them.
          </p>
          <p>
            We are repeating that exercise on ISMB papers, with an open-weight
            model (DeepSeek V4.1 Flash 1017) on an HPC cluster and our own
            improved runtime/harness (original authors just used Claude Code).
          </p>
          <p>
            The question of this study is whether our agent matches AuditOwl&apos;s
            findings. To find out, we ran our agent on a fraction of the NeurIPS
            papers and then had a comparison agent read our findings and
            AuditOwl&apos;s side by side. It grouped the two sets into match
            clusters (findings that describe the same flaw) and one-sided
            findings that only one system reported. That grouping is a proposal.
            You are the one who decides whether it is right.
          </p>
          <p>
            So we ask you to confirm or deny cluster matches and judge one-sided
            findings against the paper, the code and the validation output.
            “Unsure” is a valid result: it releases the item, keeps your note
            visible and puts it back in the pool for someone with fresh eyes.
          </p>
          <p>
            Thank you for spending your attention on this. Reading this much
            model output is genuinely soul-crushing, trust me, I know. If
            something is broken or the protocol is unclear, write to me:{" "}
            <a
              href={`mailto:${contactEmail}`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {contactEmail}
            </a>{" "}
            or send me a Signal message.
          </p>
          <p>
            Simon
          </p>
        </div>
      </section>

      <section
        data-tour={TOUR_ANCHORS.guideJob}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-medium">
            Your job, in two shapes
          </h2>
          <p className="text-sm text-muted-foreground">
            Almost every item is one of these. Related pairs are the exception,
            and they are still one decision.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitCompare data-icon="inline-start" />
                Match clusters
              </CardTitle>
              <CardDescription>
                Two findings, or two groups of findings, that may describe the
                same defect.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Read both sides and choose same defect or not a match. When it is
              a match, confirm or adjust the proposed strength and coverage. The
              verification note is evidence, not a verdict.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSearch data-icon="inline-start" />
                One-sided findings
              </CardTitle>
              <CardDescription>
                Only one system reported this one.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              For an agent-only finding, decide whether it is valid and whether
              it adds something real. For an AuditOwl-only finding, decide why
              the agent missed it and whether the original finding holds up.
              Judge it from the paper, the code and the check output.
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags data-icon="inline-start" />
              Related pairs
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            A related pair is two findings that looked similar but were kept
            apart instead of being merged. Your question is whether that
            separation was right. Like every other item, one pair is one
            decision.
          </CardContent>
        </Card>
      </section>

      <section
        data-tour={TOUR_ANCHORS.guideTours}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-medium">
            Tours (two minutes each, no quiz)
          </h2>
          <p className="text-sm text-muted-foreground">
            Four short tours, one per page. They point at things; they do not
            change anything.
          </p>
        </div>
        {example ? null : (
          <Alert>
            <Compass />
            <AlertTitle>No example paper is mounted</AlertTitle>
            <AlertDescription>
              The paper and item tours need one real paper with reviewable
              items. The other tours work now, and the example tours appear as
              soon as a batch is available.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {TOUR_IDS.map((id) => {
            const Icon = TOUR_ICONS[id]
            const title = exampleTitle(id, example)
            return (
              <Card key={id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon data-icon="inline-start" />
                    {TOURS[id].label}
                  </CardTitle>
                  <CardDescription>{TOURS[id].description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {title ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      Opens {title}
                    </p>
                  ) : null}
                  <TourStartButton tour={id} href={exampleHref(id, example)} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section
        data-tour={TOUR_ANCHORS.guideChecklist}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-medium">Evidence first</h2>
          <p className="text-sm text-muted-foreground">
            The order we recommend. It works for clusters, one-sided findings
            and related pairs.
          </p>
        </div>
        <Card>
          <CardContent className="pt-4">
            <ol className="flex flex-col gap-3 text-sm">
              {CHECKLIST.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <section
        data-tour={TOUR_ANCHORS.guideProtocol}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-medium">
            Protocol, precisely
          </h2>
          <p className="text-sm text-muted-foreground">
            The vocabulary used by the decision form, the history and the
            exports. You do not need to memorise it; it is here when a label is
            unclear.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale data-icon="inline-start" />
              Definitions
            </CardTitle>
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
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck data-icon="inline-start" />
              Status at a glance
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Keyboard data-icon="inline-start" />
              Keyboard shortcuts
            </CardTitle>
            <CardDescription>Ignored while typing in a field.</CardDescription>
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
  )
}
