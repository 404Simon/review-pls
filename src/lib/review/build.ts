import { itemHash } from "@/lib/review/hash"
import {
  compareReviewItems,
  itemId,
  relatedRef,
  severityMax,
} from "@/lib/review/ids"
import type {
  BuildResult,
  BuildReviewInput,
  ComparatorInfo,
  ExcludedPaper,
  Finding,
  FindingStatus,
  FindingVerdict,
  ItemKind,
  ItemKindCounts,
  OverlapMatch,
  OverlapOnlyFinding,
  PaperInput,
  PaperReview,
  RelatedPair,
  ReviewCounts,
  ReviewFinding,
  ReviewItem,
  Severity,
  SeverityCounts,
  ValidationIssue,
} from "@/lib/review/types"

export const KEPT_VERDICTS: ReadonlySet<FindingVerdict> = new Set([
  "keep",
  "lowered",
  "missing",
])

export function findingKey(finding: Finding): string {
  return finding.id_local ?? finding.id
}

export function isKept(finding: Finding): boolean {
  return KEPT_VERDICTS.has(finding.verdict ?? "keep")
}

function emptyComparator(): ComparatorInfo {
  return {
    relation: null,
    coverage: null,
    strength: null,
    severityAgreement: null,
    statusAgreement: null,
    verification: null,
    anchor: null,
    agentAdds: null,
    auditowlAdds: null,
    note: null,
    missReason: null,
    proposedAssessment: null,
    proposedNovelty: null,
    closestAuditowl: [],
    closestAgent: [],
    relatedReason: null,
  }
}

function toReviewFinding(
  finding: Finding,
  side: "auditowl" | "agent"
): ReviewFinding {
  return {
    id: finding.id,
    idLocal: findingKey(finding),
    side,
    category: finding.category ?? null,
    topic: finding.topic ?? null,
    title: finding.title,
    severity: finding.severity,
    status: (finding.status ?? "finding") as FindingStatus,
    file: finding.file,
    quote: finding.quote ?? null,
    claim: finding.claim ?? null,
    concern: finding.concern ?? null,
    resolution: finding.resolution ?? null,
    lineStart: finding.line_start ?? null,
    lineEnd: finding.line_end ?? null,
    paperRef: finding.paper_ref ?? null,
    checkScript: finding.check_script ?? null,
    auditMdLine: finding.audit_md_line ?? null,
    verdict: finding.verdict ?? "keep",
    reason: finding.reason ?? null,
    changed: finding.changed ?? null,
    confidence: finding.confidence ?? null,
    verification: finding.verification ?? null,
    crossRefs: finding.cross_refs ?? [],
  }
}

function comparatorFromMatch(match: OverlapMatch): ComparatorInfo {
  return {
    ...emptyComparator(),
    relation: match.relation,
    coverage: match.coverage,
    strength: match.strength,
    severityAgreement: match.severity.agreement ?? null,
    statusAgreement: match.status.agreement ?? null,
    verification: match.verification ?? null,
    anchor: match.anchor ?? null,
    agentAdds: match.agent_adds ?? null,
    auditowlAdds: match.auditowl_adds ?? null,
  }
}

function comparatorFromOnly(entry: OverlapOnlyFinding): ComparatorInfo {
  return {
    ...emptyComparator(),
    verification: entry.verification ?? null,
    note: entry.notes ?? null,
    missReason: entry.miss_reason ?? null,
    proposedAssessment: entry.assessment ?? null,
    proposedNovelty: entry.novelty ?? null,
    closestAuditowl: entry.closest_auditowl ?? [],
    closestAgent: entry.closest_agent ?? [],
  }
}

function comparatorFromRelated(pair: RelatedPair): ComparatorInfo {
  return {
    ...emptyComparator(),
    relatedReason: pair.reason,
  }
}

function findingFingerprint(finding: ReviewFinding): unknown {
  return {
    id: finding.id,
    idLocal: finding.idLocal,
    side: finding.side,
    category: finding.category,
    topic: finding.topic,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    file: finding.file,
    quote: finding.quote,
    claim: finding.claim,
    concern: finding.concern,
    resolution: finding.resolution,
    lineStart: finding.lineStart,
    lineEnd: finding.lineEnd,
    paperRef: finding.paperRef,
    checkScript: finding.checkScript,
    auditMdLine: finding.auditMdLine,
    verdict: finding.verdict,
    reason: finding.reason,
    changed: finding.changed,
    confidence: finding.confidence,
    verification: finding.verification,
    crossRefs: finding.crossRefs,
  }
}

type ItemWithoutHash = Omit<ReviewItem, "itemHash">

function itemSource(item: ItemWithoutHash): unknown {
  const sortFindings = (findings: ReviewFinding[]): unknown[] =>
    findings
      .slice()
      .sort((a, b) =>
        a.idLocal < b.idLocal ? -1 : a.idLocal > b.idLocal ? 1 : 0
      )
      .map((finding) => findingFingerprint(finding))

  return {
    kind: item.kind,
    paperId: item.paperId,
    ref: item.ref,
    severity: item.severity,
    title: item.title,
    summary: item.summary,
    auditowlIds: item.auditowlIds,
    agentIds: item.agentIds,
    comparator: item.comparator,
    findings: {
      auditowl: sortFindings(item.findings.auditowl),
      agent: sortFindings(item.findings.agent),
    },
  }
}

function finalizeItem(item: ItemWithoutHash): ReviewItem {
  return { ...item, itemHash: itemHash(itemSource(item)) }
}

function emptySeverityCounts(): SeverityCounts {
  return { high: 0, medium: 0, low: 0 }
}

function emptyKindCounts(): ItemKindCounts {
  return { high: 0, medium: 0, low: 0, total: 0 }
}

function emptyReviewCounts(): ReviewCounts {
  return {
    total: 0,
    clusters: 0,
    agentOnly: 0,
    auditowlOnly: 0,
    related: 0,
    bySeverity: emptySeverityCounts(),
    byKind: {
      cluster: emptyKindCounts(),
      agent_only: emptyKindCounts(),
      auditowl_only: emptyKindCounts(),
      related: emptyKindCounts(),
    },
  }
}

function kindCountKey(
  kind: ItemKind
): "clusters" | "agentOnly" | "auditowlOnly" | "related" {
  switch (kind) {
    case "cluster":
      return "clusters"
    case "agent_only":
      return "agentOnly"
    case "auditowl_only":
      return "auditowlOnly"
    case "related":
      return "related"
  }
}

function countItems(items: readonly ReviewItem[]): ReviewCounts {
  const counts = emptyReviewCounts()
  for (const item of items) {
    counts.total += 1
    counts.bySeverity[item.severity] += 1
    counts.byKind[item.kind][item.severity] += 1
    counts.byKind[item.kind].total += 1
    const key = kindCountKey(item.kind)
    counts[key] += 1
  }
  return counts
}

function itemSeverity(
  declared: readonly Severity[],
  fallback: readonly Severity[]
): Severity {
  if (declared.length > 0) {
    return severityMax(declared)
  }
  if (fallback.length > 0) {
    return severityMax(fallback)
  }
  return "low"
}

function indexFindings(
  findings: readonly Finding[],
  side: "auditowl" | "agent",
  issues: ValidationIssue[]
): Map<string, Finding> {
  const index = new Map<string, Finding>()
  for (const finding of findings) {
    const key = findingKey(finding)
    if (index.has(key)) {
      issues.push({
        paperId: "",
        code: "duplicate_finding_id",
        message: `${side} findings contain duplicate id ${JSON.stringify(key)}`,
      })
      continue
    }
    index.set(key, finding)
  }
  return index
}

interface ReferenceTracker {
  primary: Map<string, number>
  index: Map<string, Finding>
  side: "auditowl" | "agent"
}

function recordPrimaryReference(
  tracker: ReferenceTracker,
  id: string,
  where: string,
  issues: ValidationIssue[]
): Finding | null {
  const finding = tracker.index.get(id)
  if (!finding) {
    issues.push({
      paperId: "",
      code: "missing_finding",
      message: `${where}: ${tracker.side} finding ${JSON.stringify(id)} does not exist`,
    })
    return null
  }
  if (!isKept(finding)) {
    issues.push({
      paperId: "",
      code: "unkept_finding",
      message: `${where}: ${tracker.side} finding ${JSON.stringify(id)} is not kept`,
    })
    return null
  }
  tracker.primary.set(id, (tracker.primary.get(id) ?? 0) + 1)
  return finding
}

function checkRelatedReference(
  tracker: ReferenceTracker,
  id: string,
  where: string,
  issues: ValidationIssue[]
): Finding | null {
  const finding = tracker.index.get(id)
  if (!finding) {
    issues.push({
      paperId: "",
      code: "missing_finding",
      message: `${where}: ${tracker.side} finding ${JSON.stringify(id)} does not exist`,
    })
    return null
  }
  if (!isKept(finding)) {
    issues.push({
      paperId: "",
      code: "unkept_finding",
      message: `${where}: ${tracker.side} finding ${JSON.stringify(id)} is not kept`,
    })
    return null
  }
  return finding
}

function validateCoverage(
  tracker: ReferenceTracker,
  issues: ValidationIssue[]
): void {
  for (const [id, finding] of tracker.index) {
    if (!isKept(finding)) {
      continue
    }
    const count = tracker.primary.get(id) ?? 0
    if (count === 0) {
      issues.push({
        paperId: "",
        code: "unreferenced_finding",
        message: `${tracker.side} finding ${JSON.stringify(id)} is kept but appears in no cluster or *_only list`,
      })
    } else if (count > 1) {
      issues.push({
        paperId: "",
        code: "duplicate_finding",
        message: `${tracker.side} finding ${JSON.stringify(id)} appears ${count} times in clusters and *_only lists`,
      })
    }
  }
}

function paperIssues(
  paperId: string,
  issues: ValidationIssue[]
): ValidationIssue[] {
  return issues.map((issue) => ({ ...issue, paperId }))
}

function buildPaper(input: PaperInput, seenItemIds: Set<string>): PaperReview {
  const paperId = input.manifest.id
  const issues: ValidationIssue[] = []
  const items: ReviewItem[] = []

  const agentTracker: ReferenceTracker = {
    primary: new Map(),
    index: indexFindings(input.agentFindings, "agent", issues),
    side: "agent",
  }
  const auditowlTracker: ReferenceTracker = {
    primary: new Map(),
    index: indexFindings(input.auditowlFindings, "auditowl", issues),
    side: "auditowl",
  }

  const pushItem = (item: ReviewItem): void => {
    if (seenItemIds.has(item.id)) {
      issues.push({
        paperId,
        code: "duplicate_item",
        message: `item id ${JSON.stringify(item.id)} is used more than once`,
      })
      return
    }
    seenItemIds.add(item.id)
    items.push(item)
  }

  for (const match of input.overlap.matches) {
    const where = `matches ${match.match_id}`
    const auditowlFindings = match.auditowl
      .map((id) => recordPrimaryReference(auditowlTracker, id, where, issues))
      .filter((finding): finding is Finding => finding !== null)
      .map((finding) => toReviewFinding(finding, "auditowl"))
    const agentFindings = match.agent
      .map((id) => recordPrimaryReference(agentTracker, id, where, issues))
      .filter((finding): finding is Finding => finding !== null)
      .map((finding) => toReviewFinding(finding, "agent"))

    const declared = [...match.severity.auditowl, ...match.severity.agent]
    const fallback = [...auditowlFindings, ...agentFindings].map(
      (finding) => finding.severity
    )

    pushItem(
      finalizeItem({
        kind: "cluster",
        paperId,
        ref: match.match_id,
        id: itemId("cluster", paperId, match.match_id),
        severity: itemSeverity(declared, fallback),
        title: match.shared_defect,
        summary: null,
        auditowlIds: match.auditowl,
        agentIds: match.agent,
        findings: { auditowl: auditowlFindings, agent: agentFindings },
        comparator: comparatorFromMatch(match),
      })
    )
  }

  const agentOnlyIds = new Set<string>()
  for (const entry of input.overlap.agent_only) {
    agentOnlyIds.add(entry.id)
    const where = `agent_only ${entry.id}`
    const finding = recordPrimaryReference(
      agentTracker,
      entry.id,
      where,
      issues
    )
    pushItem(
      finalizeItem({
        kind: "agent_only",
        paperId,
        ref: entry.id,
        id: itemId("agent_only", paperId, entry.id),
        severity: entry.severity,
        title: entry.title,
        summary: entry.notes ?? null,
        auditowlIds: [],
        agentIds: [entry.id],
        findings: {
          auditowl: [],
          agent: finding ? [toReviewFinding(finding, "agent")] : [],
        },
        comparator: comparatorFromOnly(entry),
      })
    )
  }

  const auditowlOnlyIds = new Set<string>()
  for (const entry of input.overlap.auditowl_only) {
    auditowlOnlyIds.add(entry.id)
    const where = `auditowl_only ${entry.id}`
    const finding = recordPrimaryReference(
      auditowlTracker,
      entry.id,
      where,
      issues
    )
    pushItem(
      finalizeItem({
        kind: "auditowl_only",
        paperId,
        ref: entry.id,
        id: itemId("auditowl_only", paperId, entry.id),
        severity: entry.severity,
        title: entry.title,
        summary: entry.notes ?? null,
        auditowlIds: [entry.id],
        agentIds: [],
        findings: {
          auditowl: finding ? [toReviewFinding(finding, "auditowl")] : [],
          agent: [],
        },
        comparator: comparatorFromOnly(entry),
      })
    )
  }

  for (const pair of input.overlap.related_not_matched) {
    const where = "related_not_matched"
    if (pair.auditowl.length === 0 || pair.agent.length === 0) {
      issues.push({
        paperId,
        code: "invalid_related_pair",
        message: `${where}: a related pair needs findings on both sides`,
      })
      continue
    }
    for (const id of pair.auditowl) {
      if (!auditowlOnlyIds.has(id)) {
        issues.push({
          paperId,
          code: "related_not_in_only",
          message: `${where}: auditowl finding ${JSON.stringify(id)} is not in auditowl_only`,
        })
      }
    }
    for (const id of pair.agent) {
      if (!agentOnlyIds.has(id)) {
        issues.push({
          paperId,
          code: "related_not_in_only",
          message: `${where}: agent finding ${JSON.stringify(id)} is not in agent_only`,
        })
      }
    }

    const auditowlFindings = pair.auditowl
      .map((id) => checkRelatedReference(auditowlTracker, id, where, issues))
      .filter((finding): finding is Finding => finding !== null)
      .map((finding) => toReviewFinding(finding, "auditowl"))
    const agentFindings = pair.agent
      .map((id) => checkRelatedReference(agentTracker, id, where, issues))
      .filter((finding): finding is Finding => finding !== null)
      .map((finding) => toReviewFinding(finding, "agent"))

    const ref = relatedRef(pair.auditowl, pair.agent)
    pushItem(
      finalizeItem({
        kind: "related",
        paperId,
        ref,
        id: itemId("related", paperId, ref),
        severity: itemSeverity(
          [],
          [...auditowlFindings, ...agentFindings].map(
            (finding) => finding.severity
          )
        ),
        title: `Related pair: ${pair.auditowl.join(", ")} / ${pair.agent.join(", ")}`,
        summary: pair.reason,
        auditowlIds: pair.auditowl,
        agentIds: pair.agent,
        findings: { auditowl: auditowlFindings, agent: agentFindings },
        comparator: comparatorFromRelated(pair),
      })
    )
  }

  validateCoverage(agentTracker, issues)
  validateCoverage(auditowlTracker, issues)

  items.sort(compareReviewItems)

  return {
    manifest: input.manifest,
    items,
    counts: countItems(items),
    issues: paperIssues(paperId, issues),
  }
}

export function buildReviewData(input: BuildReviewInput): BuildResult {
  const seenItemIds = new Set<string>()
  const papers: PaperReview[] = []
  const allItems: ReviewItem[] = []
  const issues: ValidationIssue[] = []

  for (const paper of input.papers) {
    const review = buildPaper(paper, seenItemIds)
    papers.push(review)
    allItems.push(...review.items)
    issues.push(...review.issues)
  }

  allItems.sort(compareReviewItems)

  const excluded: ExcludedPaper[] = [...(input.excluded ?? [])]

  return {
    papers,
    items: allItems,
    counts: countItems(allItems),
    issues,
    excluded,
  }
}
