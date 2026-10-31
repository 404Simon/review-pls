import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { user } from "./auth-schema"

/**
 * Review tables.
 *
 * Timestamps are plain `integer` epoch milliseconds instead of Drizzle's
 * `timestamp_ms` mode on purpose: lease checks, expiry reaping and "latest
 * decision" ordering are expressed directly in SQL (`expires_at <= ?`,
 * `ORDER BY updated_at DESC`) and never need a JS `Date` round-trip.
 *
 * Review data (findings, overlaps, papers, code) is never copied here. These
 * tables only hold reviewer roles, leases and human decisions.
 */

export const reviewerRole = sqliteTable("reviewer_role", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["reviewer", "admin"] })
    .notNull()
    .default("reviewer"),
  createdAt: integer("created_at").notNull(),
})

export const itemClaim = sqliteTable(
  "item_claim",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    paperId: text("paper_id").notNull(),
    itemKind: text("item_kind", {
      enum: ["cluster", "agent_only", "auditowl_only", "related"],
    }).notNull(),
    itemRef: text("item_ref").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    claimedAt: integer("claimed_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("item_claim_item_unique").on(
      table.batchId,
      table.paperId,
      table.itemKind,
      table.itemRef
    ),
    index("item_claim_user_expires_idx").on(table.userId, table.expiresAt),
    index("item_claim_expires_idx").on(table.expiresAt),
  ]
)

export const reviewDecision = sqliteTable(
  "review_decision",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    paperId: text("paper_id").notNull(),
    itemKind: text("item_kind", {
      enum: ["cluster", "agent_only", "auditowl_only", "related"],
    }).notNull(),
    itemRef: text("item_ref").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["draft", "closed", "unsure"] }).notNull(),
    payload: text("payload").notNull(),
    itemHash: text("item_hash").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("review_decision_item_user_unique").on(
      table.batchId,
      table.paperId,
      table.itemKind,
      table.itemRef,
      table.userId
    ),
    index("review_decision_item_idx").on(
      table.batchId,
      table.paperId,
      table.itemKind,
      table.itemRef
    ),
    index("review_decision_batch_status_idx").on(table.batchId, table.status),
  ]
)

/**
 * Append-only history for every final/unsure save and admin reopen. Draft
 * autosaves are deliberately excluded: they are current state, not decisions.
 */
export const reviewDecisionEvent = sqliteTable(
  "review_decision_event",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    paperId: text("paper_id").notNull(),
    itemKind: text("item_kind", {
      enum: ["cluster", "agent_only", "auditowl_only", "related"],
    }).notNull(),
    itemRef: text("item_ref").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["closed", "unsure", "reopened"],
    }).notNull(),
    payload: text("payload").notNull(),
    itemHash: text("item_hash").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("review_decision_event_item_idx").on(
      table.batchId,
      table.paperId,
      table.itemKind,
      table.itemRef
    ),
    index("review_decision_event_user_idx").on(table.userId, table.createdAt),
    index("review_decision_event_batch_status_idx").on(
      table.batchId,
      table.status
    ),
  ]
)
