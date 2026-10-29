import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"

import * as schema from "./auth-schema"

const sqlite = new Database(process.env.DATABASE_URL ?? "./local.db")

sqlite.pragma("journal_mode = WAL")

export const db = drizzle(sqlite, { schema })
