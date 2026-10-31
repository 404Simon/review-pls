import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as authSchema from "./auth-schema"
import * as reviewSchema from "./review-schema"

const schema = { ...authSchema, ...reviewSchema }

const sqlite = new Database(process.env.DATABASE_URL ?? "./local.db")

sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

export type AppDatabase = BetterSQLite3Database<typeof schema>

export const db: AppDatabase = drizzle(sqlite, { schema })
