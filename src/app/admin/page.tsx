import {
  AlertTriangle,
  Database,
  Download,
  FileWarning,
  Gauge,
  ListChecks,
  ShieldCheck,
  Users,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  AdminReloadData,
  AdminReleaseClaim,
  AdminRoleControl,
} from "@/components/review/admin-controls"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { db } from "@/db"
import { getActiveClaims, reapStaleClaims } from "@/lib/review/claims"
import { currentTimeMs } from "@/lib/review/clock"
import {
  inspectBatchHealth,
  summarizeDecisionHealth,
  type BatchInspection,
  type DecisionHealth,
} from "@/lib/review/data-health"
import { describeDecision } from "@/lib/review/decision-format"
import {
  getBatchDecisionEvents,
  getBatchDecisionRows,
  latestClosedDecision,
} from "@/lib/review/decisions"
import { itemPath } from "@/lib/review/filters"
import {
  formatItemKind,
  formatLease,
  formatPercent,
  formatTimestamp,
} from "@/lib/review/format"
import {
  listBatches,
  ReviewDataError,
  type BatchSummary,
} from "@/lib/review/load"
import {
  getUserRole,
  listUserRoles,
  parseAdminEmails,
} from "@/lib/review/roles"
import {
  computeBatchStats,
  computePaperStats,
  computeReviewerStats,
  type ReviewStats,
  type ReviewerStats,
} from "@/lib/review/stats"
import type {
  Claim,
  DecisionEventRecord,
  DecisionRecord,
  ReviewItem,
} from "@/lib/review/types"
import { getSession } from "@/lib/session"

interface PaperAdminStats {
  paperId: string
  title: string
  stats: ReviewStats
  drafts: number
}

interface BatchAdminData {
  summary: BatchSummary
  inspection: BatchInspection | null
  error: string | null
  decisions: DecisionRecord[]
  events: DecisionEventRecord[]
  claims: Claim[]
  stats: ReviewStats | null
  drafts: number
  paperStats: PaperAdminStats[]
  reviewerStats: ReviewerStats[]
  decisionHealth: DecisionHealth | null
}

interface UnsureEntry {
  batchId: string
  item: ReviewItem
  reviewerId: string
  note: string
  at: number
  claim: Claim | null
}

function keyOf(
  batchId: string,
  paperId: string,
  kind: string,
  ref: string
): string {
  return `${batchId}\u0000${paperId}\u0000${kind}\u0000${ref}`
}

async function safeListBatches(): Promise<{
  summaries: BatchSummary[]
  error: string | null
}> {
  try {
    return { summaries: await listBatches(), error: null }
  } catch (error) {
    if (error instanceof ReviewDataError) {
      return { summaries: [], error: error.message }
    }
    throw error
  }
}

async function loadBatchAdminData(
  summary: BatchSummary,
  activeClaims: readonly Claim[],
  now: number
): Promise<BatchAdminData> {
  if (summary.error !== undefined) {
    return {
      summary,
      inspection: null,
      error: summary.error,
      decisions: [],
      events: [],
      claims: [],
      stats: null,
      drafts: 0,
      paperStats: [],
      reviewerStats: [],
      decisionHealth: null,
    }
  }

  try {
    const inspection = await inspectBatchHealth(summary.batchId)
    const [decisions, events] = await Promise.all([
      getBatchDecisionRows(db, summary.batchId),
      getBatchDecisionEvents(db, summary.batchId),
    ])
    const batchClaims = activeClaims.filter(
      (claim) => claim.batchId === summary.batchId
    )
    const base = {
      batchId: summary.batchId,
      items: inspection.loaded.items,
      decisions,
      claims: batchClaims,
      manifestSha256: inspection.loaded.batch.manifestSha256,
      // Status and leases follow the page timestamp, not when the cached
      // inspection was built.
      now,
    }
    const stats = computeBatchStats(base)
    const drafts = decisions.filter((row) => row.status === "draft").length
    const paperStats = inspection.loaded.papers
      .map((paper) => ({
        paperId: paper.manifest.id,
        title: paper.manifest.title,
        stats: computePaperStats(base, paper.manifest.id),
        drafts: decisions.filter(
          (row) => row.status === "draft" && row.paperId === paper.manifest.id
        ).length,
      }))
      .sort((a, b) => a.paperId.localeCompare(b.paperId))

    return {
      summary,
      inspection,
      error: null,
      decisions,
      events,
      claims: batchClaims,
      stats,
      drafts,
      paperStats,
      reviewerStats: computeReviewerStats(summary.batchId, decisions),
      decisionHealth: summarizeDecisionHealth(
        inspection.loaded.items,
        decisions,
        inspection.loaded.batch.manifestSha256
      ),
    }
  } catch (error) {
    return {
      summary,
      inspection: null,
      error:
        error instanceof Error ? error.message : "The batch could not be read.",
      decisions: [],
      events: [],
      claims: [],
      stats: null,
      drafts: 0,
      paperStats: [],
      reviewerStats: [],
      decisionHealth: null,
    }
  }
}

function buildUnsureQueue(
  batches: readonly BatchAdminData[],
  now: number
): UnsureEntry[] {
  const entries: UnsureEntry[] = []
  for (const batch of batches) {
    if (!batch.inspection) {
      continue
    }
    const itemsByKey = new Map<string, ReviewItem>()
    for (const item of batch.inspection.loaded.items) {
      itemsByKey.set(
        keyOf(batch.summary.batchId, item.paperId, item.kind, item.ref),
        item
      )
    }
    const decisionsByKey = new Map<string, DecisionRecord[]>()
    for (const decision of batch.decisions) {
      const key = keyOf(
        batch.summary.batchId,
        decision.paperId,
        decision.itemKind,
        decision.itemRef
      )
      const bucket = decisionsByKey.get(key)
      if (bucket) {
        bucket.push(decision)
      } else {
        decisionsByKey.set(key, [decision])
      }
    }
    const closed = new Set<string>()
    for (const [key, rows] of decisionsByKey) {
      if (latestClosedDecision(rows)) {
        closed.add(key)
      }
    }

    const latestUnsure = new Map<string, DecisionEventRecord>()
    for (const event of batch.events) {
      if (event.status !== "unsure") {
        continue
      }
      const key = keyOf(
        batch.summary.batchId,
        event.paperId,
        event.itemKind,
        event.itemRef
      )
      const current = latestUnsure.get(key)
      if (
        !current ||
        event.createdAt > current.createdAt ||
        (event.createdAt === current.createdAt && event.id > current.id)
      ) {
        latestUnsure.set(key, event)
      }
    }

    const claimsByKey = new Map<string, Claim>()
    for (const claim of batch.claims) {
      if (claim.expiresAt > now) {
        claimsByKey.set(
          keyOf(
            batch.summary.batchId,
            claim.paperId,
            claim.itemKind,
            claim.itemRef
          ),
          claim
        )
      }
    }

    for (const [key, event] of latestUnsure) {
      if (closed.has(key)) {
        continue
      }
      const item = itemsByKey.get(key)
      if (!item) {
        continue
      }
      entries.push({
        batchId: batch.summary.batchId,
        item,
        reviewerId: event.userId,
        note: describeDecision(item.kind, event.payload).note ?? "",
        at: event.createdAt,
        claim: claimsByKey.get(key) ?? null,
      })
    }
  }

  return entries.sort(
    (a, b) =>
      b.at - a.at ||
      a.batchId.localeCompare(b.batchId) ||
      a.item.paperId.localeCompare(b.item.paperId)
  )
}

export default async function AdminPage() {
  const session = await getSession()
  if (!session) {
    redirect("/sign-in")
  }
  const role = await getUserRole(session.user, { db })
  if (role !== "admin") {
    notFound()
  }

  const listed = await safeListBatches()
  const users = listUserRoles(db)
  const userNames = new Map(users.map((user) => [user.id, user.name]))
  // One server timestamp for the whole page and one claim query for every
  // mounted batch. The per-batch loaders only filter that snapshot.
  const now = currentTimeMs()
  // The admin console is the natural place to drop claim rows that are no
  // longer live (expired leases or claims on already-closed items), so the
  // table does not grow forever.
  await reapStaleClaims(db, now)
  const activeClaims = await getActiveClaims(db, now)
  const batches = await Promise.all(
    listed.summaries.map((summary) =>
      loadBatchAdminData(summary, activeClaims, now)
    )
  )

  const itemLookup = new Map<string, { batchId: string; item: ReviewItem }>()
  for (const batch of batches) {
    if (!batch.inspection) {
      continue
    }
    for (const item of batch.inspection.loaded.items) {
      itemLookup.set(
        keyOf(batch.summary.batchId, item.paperId, item.kind, item.ref),
        { batchId: batch.summary.batchId, item }
      )
    }
  }

  const unsureQueue = buildUnsureQueue(batches, now)
  const configuredEmails = [
    ...parseAdminEmails(process.env.ADMIN_EMAILS),
  ].sort()
  const userByEmail = new Map(
    users.map((user) => [user.email.trim().toLowerCase(), user])
  )
  const stale = batches.flatMap((batch) =>
    batch.decisionHealth
      ? batch.decisionHealth.stale.map((decision) => ({
          batchId: batch.summary.batchId,
          decision,
        }))
      : []
  )
  const orphaned = batches.flatMap((batch) =>
    batch.decisionHealth
      ? batch.decisionHealth.orphaned.map((decision) => ({
          batchId: batch.summary.batchId,
          decision,
        }))
      : []
  )
  const healthy = batches.filter((batch) => batch.inspection !== null)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-medium">Admin</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Data health, roles, claims, the unsure queue, statistics and
            archival exports. Every action on this page is admin-only;{" "}
            <span className="font-mono">ADMIN_EMAILS</span> remains a candidate
            allowlist and never grants a role at request time.
          </p>
        </div>
        <AdminReloadData />
      </header>

      {listed.error ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle data-icon="inline-start" />
              Review data root unavailable
            </CardTitle>
            <CardDescription>
              No mounted batch could be listed. Fix the mount, then reload.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xs break-words whitespace-pre-wrap">
              {listed.error}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database data-icon="inline-start" />
            Data health
          </CardTitle>
          <CardDescription>
            One entry per mounted batch. Evidence is resolved over every kept
            finding once and cached for five minutes; “Reload data” clears it
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No batch directory is mounted under REVIEW_DATA_ROOT.
            </p>
          ) : (
            batches.map((batch) => (
              <div
                key={batch.summary.batchId}
                className="flex flex-col gap-3 rounded-xl border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{batch.summary.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {batch.summary.batchId}
                    </span>
                    {batch.inspection ? (
                      <code className="mt-0.5 font-mono text-[0.7rem] break-all text-muted-foreground select-all">
                        manifest {batch.inspection.loaded.batch.manifestSha256}
                      </code>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">
                      {batch.inspection?.loaded.papers.length ?? 0} included
                    </Badge>
                    <Badge variant="outline">
                      {batch.inspection?.loaded.excluded.length ??
                        batch.summary.excludedCount}{" "}
                      excluded
                    </Badge>
                    <Badge variant="outline">
                      {batch.inspection?.loaded.counts.total ?? 0} items
                    </Badge>
                  </div>
                </div>

                {batch.error ? (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 font-mono text-xs break-words text-destructive">
                    {batch.error}
                  </p>
                ) : batch.inspection ? (
                  <>
                    <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <HealthMetric
                        label="Evidence resolved"
                        value={`${batch.inspection.evidence.local}/${batch.inspection.evidence.total}`}
                      />
                      <HealthMetric
                        label="Missing anchors"
                        value={batch.inspection.evidence.missing}
                        bad={batch.inspection.evidence.missing > 0}
                      />
                      <HealthMetric
                        label="URL anchors"
                        value={batch.inspection.evidence.url}
                      />
                      <HealthMetric
                        label="Quote not checkable"
                        value={batch.inspection.evidence.quotes.not_checkable}
                      />
                      <HealthMetric
                        label="Quote exact"
                        value={batch.inspection.evidence.quotes.exact}
                      />
                      <HealthMetric
                        label="Quote fuzzy"
                        value={batch.inspection.evidence.quotes.fuzzy}
                      />
                      <HealthMetric
                        label="Quote missing"
                        value={batch.inspection.evidence.quotes.missing}
                        bad={batch.inspection.evidence.quotes.missing > 0}
                      />
                      <HealthMetric
                        label="Build issues"
                        value={batch.inspection.loaded.issues.length}
                        bad={batch.inspection.loaded.issues.length > 0}
                      />
                    </div>

                    {batch.inspection.loaded.excluded.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Excluded:{" "}
                        {batch.inspection.loaded.excluded
                          .map((entry) => `${entry.paperId} (${entry.reason})`)
                          .join("; ")}
                      </p>
                    ) : null}

                    {batch.inspection.loaded.issues.length > 0 ? (
                      <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                        <summary className="cursor-pointer font-medium">
                          Build issues ({batch.inspection.loaded.issues.length})
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1">
                          {batch.inspection.loaded.issues.map(
                            (issue, index) => (
                              <li
                                key={`${issue.paperId}-${issue.code}-${index}`}
                              >
                                {issue.paperId || "batch"} {issue.code}:{" "}
                                {issue.message}
                              </li>
                            )
                          )}
                        </ul>
                      </details>
                    ) : null}

                    {batch.inspection.evidence.missingAnchors.length > 0 ? (
                      <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                        <summary className="cursor-pointer font-medium">
                          Missing files (
                          {batch.inspection.evidence.missingAnchors.length})
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1 font-mono">
                          {batch.inspection.evidence.missingAnchors.map(
                            (anchor) => (
                              <li
                                key={`${anchor.paperId}-${anchor.side}-${anchor.id}`}
                              >
                                {anchor.paperId} {anchor.side} {anchor.id}:{" "}
                                {anchor.file}
                              </li>
                            )
                          )}
                        </ul>
                      </details>
                    ) : null}

                    {batch.inspection.evidence.sourceAnomalies.length > 0 ? (
                      <details className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                        <summary className="cursor-pointer font-medium">
                          Source quote anomalies (
                          {batch.inspection.evidence.sourceAnomalies.length})
                        </summary>
                        <ul className="mt-2 flex flex-col gap-1 font-mono">
                          {batch.inspection.evidence.sourceAnomalies.map(
                            (anchor) => (
                              <li
                                key={`${anchor.paperId}-${anchor.side}-${anchor.id}`}
                              >
                                {anchor.paperId} {anchor.side} {anchor.id}:{" "}
                                {anchor.file}
                                {anchor.lineStart === null
                                  ? ""
                                  : `:${anchor.lineStart}-${anchor.lineEnd ?? anchor.lineStart}`}
                              </li>
                            )
                          )}
                        </ul>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileWarning data-icon="inline-start" />
                  Stale decisions
                </CardTitle>
                <CardDescription>
                  Latest closed decisions whose item hash or manifest no longer
                  matches the mount.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stale.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No stale closed decisions.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs">
                    {stale.map((entry) => (
                      <li key={`${entry.batchId}-${entry.decision.id}`}>
                        <span className="font-mono">{entry.batchId}</span>{" "}
                        {entry.decision.paperId}{" "}
                        {formatItemKind(entry.decision.itemKind)}{" "}
                        {entry.decision.itemRef} by{" "}
                        {userNames.get(entry.decision.userId) ??
                          entry.decision.userId}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle data-icon="inline-start" />
                  Orphaned decisions
                </CardTitle>
                <CardDescription>
                  Rows whose item is no longer part of the mounted batch.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {orphaned.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No orphaned decision rows.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-xs">
                    {orphaned.map((entry) => (
                      <li key={`${entry.batchId}-${entry.decision.id}`}>
                        <span className="font-mono">{entry.batchId}</span>{" "}
                        {entry.decision.paperId} {entry.decision.itemKind}{" "}
                        {entry.decision.itemRef} ({entry.decision.status}) by{" "}
                        {userNames.get(entry.decision.userId) ??
                          entry.decision.userId}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge data-icon="inline-start" />
            Batch statistics
          </CardTitle>
          <CardDescription>
            Closed and unsure use the same derived status as the queue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead>Unsure</TableHead>
                <TableHead>Drafts</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead>H / M / L</TableHead>
                <TableHead>C / A / O / R</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.summary.batchId}>
                  <TableCell className="font-mono text-xs">
                    {batch.summary.batchId}
                  </TableCell>
                  <TableCell>{batch.stats?.total ?? "—"}</TableCell>
                  <TableCell>{batch.stats?.closed ?? "—"}</TableCell>
                  <TableCell>{batch.stats?.unsure ?? "—"}</TableCell>
                  <TableCell>{batch.drafts}</TableCell>
                  <TableCell>
                    {batch.stats ? formatPercent(batch.stats.completion) : "—"}
                  </TableCell>
                  <TableCell>
                    {batch.stats
                      ? `${batch.stats.bySeverity.high} / ${batch.stats.bySeverity.medium} / ${batch.stats.bySeverity.low}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {batch.stats
                      ? `${batch.stats.byKind.cluster.total} / ${batch.stats.byKind.agent_only.total} / ${batch.stats.byKind.auditowl_only.total} / ${batch.stats.byKind.related.total}`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks data-icon="inline-start" />
            Paper statistics
          </CardTitle>
          <CardDescription>
            Per-paper item counts, severity and type mix.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Paper</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead>Unsure</TableHead>
                <TableHead>Drafts</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead>H / M / L</TableHead>
                <TableHead>C / A / O / R</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.flatMap((batch) =>
                batch.paperStats.map((paper) => (
                  <TableRow key={`${batch.summary.batchId}-${paper.paperId}`}>
                    <TableCell className="font-mono text-xs">
                      {batch.summary.batchId}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{paper.paperId}</span>{" "}
                      <span className="text-muted-foreground">
                        {paper.title}
                      </span>
                    </TableCell>
                    <TableCell>{paper.stats.total}</TableCell>
                    <TableCell>{paper.stats.closed}</TableCell>
                    <TableCell>{paper.stats.unsure}</TableCell>
                    <TableCell>{paper.drafts}</TableCell>
                    <TableCell>
                      {formatPercent(paper.stats.completion)}
                    </TableCell>
                    <TableCell>
                      {paper.stats.bySeverity.high} /{" "}
                      {paper.stats.bySeverity.medium} /{" "}
                      {paper.stats.bySeverity.low}
                    </TableCell>
                    <TableCell>
                      {paper.stats.byKind.cluster.total} /{" "}
                      {paper.stats.byKind.agent_only.total} /{" "}
                      {paper.stats.byKind.auditowl_only.total} /{" "}
                      {paper.stats.byKind.related.total}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users data-icon="inline-start" />
            Reviewers
          </CardTitle>
          <CardDescription>
            Decision rows per reviewer. Unsure rows are not counted as closed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead>Unsure</TableHead>
                <TableHead>Drafts</TableHead>
                <TableHead>Total rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.flatMap((batch) =>
                batch.reviewerStats.map((reviewer) => (
                  <TableRow key={`${batch.summary.batchId}-${reviewer.userId}`}>
                    <TableCell className="font-mono text-xs">
                      {batch.summary.batchId}
                    </TableCell>
                    <TableCell>
                      {userNames.get(reviewer.userId) ?? reviewer.userId}
                    </TableCell>
                    <TableCell>{reviewer.closed}</TableCell>
                    <TableCell>{reviewer.unsure}</TableCell>
                    <TableCell>{reviewer.drafts}</TableCell>
                    <TableCell>{reviewer.total}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck data-icon="inline-start" />
            Roles and admin bootstrap
          </CardTitle>
          <CardDescription>
            Promote or demote registered accounts. To bootstrap the first admin,
            run the sync command yourself after the account registered.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <p className="font-medium">Explicit admin bootstrap</p>
            <p className="mt-1 text-muted-foreground">
              Inspect candidates with{" "}
              <code className="font-mono">pnpm review:admin:sync --list</code>,
              then promote one confirmed account with{" "}
              <code className="font-mono">
                pnpm review:admin:sync --user-id &lt;id&gt;
              </code>
              . A matching ADMIN_EMAILS entry alone never grants admin.
            </p>
            <p className="mt-2 text-muted-foreground">
              Configured candidates:{" "}
              {configuredEmails.length === 0
                ? "none (ADMIN_EMAILS is unset)"
                : configuredEmails
                    .map((email) => {
                      const user = userByEmail.get(email)
                      return user
                        ? `${email} (registered as ${user.role})`
                        : `${email} (not registered)`
                    })
                    .join(", ")}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <span className="font-medium">{user.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {user.id}
                    </span>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={user.role === "admin" ? "default" : "outline"}
                    >
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {configuredEmails.includes(
                      user.email.trim().toLowerCase()
                    ) ? (
                      <Badge variant="secondary">ADMIN_EMAILS</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <AdminRoleControl
                      userId={user.id}
                      role={user.role}
                      isSelf={user.id === session.user.id}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks data-icon="inline-start" />
            Active claims
          </CardTitle>
          <CardDescription>
            Live leases across every mounted batch. Claims on closed items and
            expired leases are not shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeClaims.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active claims right now.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeClaims.map((claim) => {
                  const found = itemLookup.get(
                    keyOf(
                      claim.batchId,
                      claim.paperId,
                      claim.itemKind,
                      claim.itemRef
                    )
                  )
                  return (
                    <TableRow key={claim.id}>
                      <TableCell className="font-mono text-xs">
                        {claim.batchId}
                      </TableCell>
                      <TableCell>
                        {found ? (
                          <>
                            <Link
                              href={itemPath(found.batchId, found.item.id)}
                              className="hover:underline"
                            >
                              {found.item.title}
                            </Link>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {claim.paperId} {claim.itemKind} {claim.itemRef}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-xs">
                            {claim.paperId} {claim.itemKind} {claim.itemRef}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {userNames.get(claim.userId) ?? claim.userId}
                      </TableCell>
                      <TableCell>
                        {formatTimestamp(claim.expiresAt)} (
                        {formatLease(claim.expiresAt, now)})
                      </TableCell>
                      <TableCell>
                        <AdminReleaseClaim
                          batchId={claim.batchId}
                          paperId={claim.paperId}
                          itemKind={claim.itemKind}
                          itemRef={claim.itemRef}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle data-icon="inline-start" />
            Unsure queue
          </CardTitle>
          <CardDescription>
            Items with an unsure event and no current closed decision. A release
            button appears if a reviewer resumed the item and holds a claim.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unsureQueue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items are waiting on an unsure note.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unsureQueue.map((entry) => (
                  <TableRow
                    key={`${entry.batchId}-${entry.item.id}-${entry.at}`}
                  >
                    <TableCell className="font-mono text-xs">
                      {entry.batchId}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={itemPath(entry.batchId, entry.item.id)}
                        className="hover:underline"
                      >
                        {entry.item.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {userNames.get(entry.reviewerId) ?? entry.reviewerId}
                    </TableCell>
                    <TableCell className="max-w-72 truncate" title={entry.note}>
                      {entry.note || "—"}
                    </TableCell>
                    <TableCell>{formatTimestamp(entry.at)}</TableCell>
                    <TableCell>
                      {entry.claim ? (
                        <AdminReleaseClaim
                          batchId={entry.batchId}
                          paperId={entry.item.paperId}
                          itemKind={entry.item.kind}
                          itemRef={entry.item.ref}
                        />
                      ) : (
                        <Link
                          href={itemPath(entry.batchId, entry.item.id)}
                          className={buttonVariants({
                            variant: "ghost",
                            size: "sm",
                          })}
                        >
                          Open item
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download data-icon="inline-start" />
            Exports
          </CardTitle>
          <CardDescription>
            Downloads are admin-only. The full dataset keeps drafts, claims and
            the append-only event history; decisions-only excludes drafts and
            includes the durable unsure history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {healthy.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No healthy batch is available to export.
            </p>
          ) : (
            healthy.map((batch) => {
              const batchId = batch.summary.batchId
              return (
                <div
                  key={batchId}
                  className="flex flex-col gap-2 rounded-lg border p-3"
                >
                  <span className="text-sm font-medium">
                    {batch.summary.label}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {batchId}
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/api/admin/export/${encodeURIComponent(batchId)}?type=dataset`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <Download data-icon="inline-start" />
                      Dataset JSON
                    </Link>
                    <Link
                      href={`/api/admin/export/${encodeURIComponent(batchId)}?type=decisions`}
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <Download data-icon="inline-start" />
                      Decisions JSON
                    </Link>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Run on the host with the host paths that back the container
                    volumes (the runtime image has no pnpm/tsx):
                  </p>
                  <code className="overflow-x-auto rounded-md bg-muted px-2 py-1 text-xs">
                    pnpm review:export --batch {batchId} --type both --out
                    ./exports --root ./review-data --database ./data/review.db
                  </code>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function HealthMetric({
  label,
  value,
  bad = false,
}: {
  label: string
  value: number | string
  bad?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-2 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          bad
            ? "font-heading text-lg font-medium text-destructive"
            : "font-heading text-lg font-medium"
        }
      >
        {value}
      </span>
    </div>
  )
}
