import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import { reviewerFreeze } from "@/db/review-schema"

export interface AccountFreeze {
  userId: string
  frozenAt: number
  /** The admin who froze the account, or null after that account was deleted. */
  frozenBy: string | null
}

function toAccountFreeze(
  row: typeof reviewerFreeze.$inferSelect
): AccountFreeze {
  return {
    userId: row.userId,
    frozenAt: row.frozenAt,
    frozenBy: row.frozenBy,
  }
}

export function getAccountFreeze(
  db: AppDatabase,
  userId: string
): AccountFreeze | null {
  const row = db
    .select()
    .from(reviewerFreeze)
    .where(eq(reviewerFreeze.userId, userId))
    .get()
  return row ? toAccountFreeze(row) : null
}

export function isUserFrozen(db: AppDatabase, userId: string): boolean {
  return getAccountFreeze(db, userId) !== null
}

/** Freeze rows keyed by user id, for admin listings. */
export function listAccountFreezes(
  db: AppDatabase
): Map<string, AccountFreeze> {
  return new Map(
    db
      .select()
      .from(reviewerFreeze)
      .all()
      .map((row) => [row.userId, toAccountFreeze(row)])
  )
}

type FreezeWriter = Pick<AppDatabase, "insert" | "delete">

/** Upsert the freeze row. Callers must delete the account's claims. */
export function freezeAccount(
  db: FreezeWriter,
  userId: string,
  frozenBy: string | null,
  now: number
): void {
  db.insert(reviewerFreeze)
    .values({ userId, frozenAt: now, frozenBy })
    .onConflictDoUpdate({
      target: reviewerFreeze.userId,
      set: { frozenAt: now, frozenBy },
    })
    .run()
}

/** Returns whether a freeze row was removed. */
export function unfreezeAccount(db: FreezeWriter, userId: string): boolean {
  return (
    db.delete(reviewerFreeze).where(eq(reviewerFreeze.userId, userId)).run()
      .changes > 0
  )
}
