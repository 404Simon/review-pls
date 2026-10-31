import { inArray } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import { user } from "@/db/auth-schema"
import type {
  Claim,
  DecisionEventRecord,
  DecisionRecord,
} from "@/lib/review/types"

/** Pure helper shared by UI reads and exports. */
export function collectReviewerIds(
  decisions: readonly DecisionRecord[],
  claims: readonly Claim[],
  events: readonly DecisionEventRecord[] = []
): string[] {
  return [
    ...new Set([
      ...decisions.map((decision) => decision.userId),
      ...claims.map((claim) => claim.userId),
      ...events.map((event) => event.userId),
    ]),
  ]
}

/**
 * Display names for reviewer-facing views. Emails deliberately stay out of
 * this helper; only admin exports may include them.
 */
export function getReviewerNames(
  db: AppDatabase,
  userIds: readonly string[]
): Record<string, string> {
  const ids = [...new Set(userIds.filter((id) => id !== ""))]
  if (ids.length === 0) {
    return {}
  }
  const rows = db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids))
    .all()
  return Object.fromEntries(rows.map((row) => [row.id, row.name]))
}

/** Admin exports may include email; reviewer-facing views must not use this. */
export interface ReviewerIdentity {
  id: string
  name: string
  email: string
}

export function getReviewerIdentities(
  db: AppDatabase,
  userIds: readonly string[]
): ReviewerIdentity[] {
  const ids = [...new Set(userIds.filter((id) => id !== ""))]
  if (ids.length === 0) {
    return []
  }
  return db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(inArray(user.id, ids))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id))
}
