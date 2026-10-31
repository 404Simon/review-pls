import { readFileSync } from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const migration = readFileSync(
  path.join(process.cwd(), "drizzle", "0004_backfill_decision_events.sql"),
  "utf8"
)

interface DecisionSeed {
  id: string
  status: "draft" | "closed" | "unsure"
  updatedAt: number
}

let sqlite: Database.Database

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE review_decision (
      id text PRIMARY KEY NOT NULL,
      batch_id text NOT NULL,
      paper_id text NOT NULL,
      item_kind text NOT NULL,
      item_ref text NOT NULL,
      user_id text NOT NULL,
      status text NOT NULL,
      payload text NOT NULL,
      item_hash text NOT NULL,
      manifest_sha256 text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE review_decision_event (
      id text PRIMARY KEY NOT NULL,
      batch_id text NOT NULL,
      paper_id text NOT NULL,
      item_kind text NOT NULL,
      item_ref text NOT NULL,
      user_id text NOT NULL,
      status text NOT NULL,
      payload text NOT NULL,
      item_hash text NOT NULL,
      manifest_sha256 text NOT NULL,
      created_at integer NOT NULL
    );
  `)
}

function insertDecision(db: Database.Database, seed: DecisionSeed) {
  db.prepare(
    `INSERT INTO review_decision
      (id, batch_id, paper_id, item_kind, item_ref, user_id, status, payload,
       item_hash, manifest_sha256, created_at, updated_at)
     VALUES (?, 'batch', 'p1', 'cluster', 'M01', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    seed.id,
    `user-${seed.id}`,
    seed.status,
    JSON.stringify({ verdict: "same_defect", note: seed.id }),
    "a".repeat(64),
    "b".repeat(64),
    seed.updatedAt - 1,
    seed.updatedAt
  )
}

beforeEach(() => {
  sqlite = new Database(":memory:")
  createSchema(sqlite)
})

afterEach(() => {
  sqlite.close()
})

describe("0004 backfill migration", () => {
  it("backfills closed and unsure rows once and skips drafts", () => {
    insertDecision(sqlite, { id: "closed", status: "closed", updatedAt: 10 })
    insertDecision(sqlite, { id: "unsure", status: "unsure", updatedAt: 20 })
    insertDecision(sqlite, { id: "draft", status: "draft", updatedAt: 30 })

    sqlite.exec(migration)

    const events = sqlite
      .prepare(
        "SELECT id, status, payload, created_at FROM review_decision_event ORDER BY created_at"
      )
      .all()
    expect(events).toEqual([
      {
        id: "backfill-closed",
        status: "closed",
        payload: JSON.stringify({ verdict: "same_defect", note: "closed" }),
        created_at: 10,
      },
      {
        id: "backfill-unsure",
        status: "unsure",
        payload: JSON.stringify({ verdict: "same_defect", note: "unsure" }),
        created_at: 20,
      },
    ])

    // Re-running the data migration on an already backfilled database is a
    // no-op rather than a duplicate event.
    sqlite.exec(migration)
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM review_decision_event")
        .get()
    ).toEqual({ count: 2 })
  })

  it("does not duplicate a decision that already has its event", () => {
    insertDecision(sqlite, { id: "closed", status: "closed", updatedAt: 10 })
    sqlite
      .prepare(
        `INSERT INTO review_decision_event
          (id, batch_id, paper_id, item_kind, item_ref, user_id, status,
           payload, item_hash, manifest_sha256, created_at)
         VALUES ('event', 'batch', 'p1', 'cluster', 'M01', 'user-closed',
                 'closed', '{}', ?, ?, 10)`
      )
      .run("a".repeat(64), "b".repeat(64))

    sqlite.exec(migration)

    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM review_decision_event")
        .get()
    ).toEqual({ count: 1 })
  })
})
