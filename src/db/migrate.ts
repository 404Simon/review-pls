import path from "node:path"

import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import { db } from "./index"

/**
 * Applies pending Drizzle migrations. The migrator records applied migrations
 * in `__drizzle_migrations`, so this is a no-op once the database is current.
 */
export function migrateDatabase() {
  const migrationsFolder = path.join(process.cwd(), "drizzle")

  try {
    migrate(db, { migrationsFolder })
    console.log("Database migrations are up to date.")
  } catch (error) {
    console.error(
      `Could not apply database migrations from ${migrationsFolder}. ` +
        "Check that DATABASE_URL points at a writable directory."
    )
    throw error
  }
}
