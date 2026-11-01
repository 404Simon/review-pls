import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as authSchema from "./auth-schema"
import * as reviewSchema from "./review-schema"

export const schema = { ...authSchema, ...reviewSchema }

export type AppDatabase = BetterSQLite3Database<typeof schema>

function connect(): AppDatabase {
  const sqlite = new Database(process.env.DATABASE_URL ?? "./local.db")

  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  return drizzle(sqlite, { schema })
}

let instance: AppDatabase | undefined

/**
 * Open the database on first use instead of at import time.
 *
 * `next build` imports every route module to collect its configuration, in
 * several parallel workers. Opening the same SQLite file in each worker raced
 * on the exclusive lock that enables WAL and failed the build with
 * SQLITE_BUSY. Deferring the connection also keeps a local build from creating
 * or touching `./local.db`.
 */
function getDatabase(): AppDatabase {
  instance ??= connect()
  return instance
}

/**
 * Drizzle client. Importing this module never opens the database; the first
 * property access connects. Methods are bound to the real client so `this`
 * stays correct (`db.select`, `db.transaction`, ...).
 */
export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, property) {
    const database = getDatabase()
    const value = Reflect.get(database, property, database)
    return typeof value === "function" ? value.bind(database) : value
  },
})
