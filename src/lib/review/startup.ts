import { db } from "@/db"
import { migrateDatabase } from "@/db/migrate"
import { getContactEmail } from "@/lib/contact-email"

import { startScheduledExports } from "./export-schedule"
import { promoteAllowlistedAdmins } from "./roles"

/**
 * Node-only server startup work: apply pending migrations, promote the
 * accounts listed in `ADMIN_EMAILS`, then start the hourly export when
 * `EXPORT_DIR` is set.
 *
 * Imported lazily from `src/instrumentation.ts`, and only for the Node.js
 * runtime: this module (through `@/db`) loads better-sqlite3, which the Edge
 * instrumentation bundle cannot resolve.
 *
 * Promotion writes `reviewer_role` rows before the server serves requests; it
 * is never a request-time grant, and it never demotes, so roles granted later
 * through `/admin` survive a restart. A failed promotion must not take the app
 * down, so it is logged and the next restart retries.
 */
export function runStartupTasks(): void {
  // Required configuration: crash at startup rather than rendering a guide
  // with a missing or broken contact address.
  getContactEmail()
  migrateDatabase()
  promoteAdminsFromEnv()
  // No-op unless EXPORT_DIR is set. Exports run in the Node server process
  // only, so the standalone runtime image does not need pnpm or tsx.
  startScheduledExports(db)
}

function promoteAdminsFromEnv(): void {
  const configured = process.env.ADMIN_EMAILS?.trim()

  if (!configured) {
    console.warn(
      "ADMIN_EMAILS is unset; no admin accounts were promoted on startup."
    )
    return
  }

  try {
    const { promoted, missing } = promoteAllowlistedAdmins(db, configured)

    if (promoted.length > 0) {
      console.log(
        `Promoted ${promoted.length} allowlisted account(s) to admin: ` +
          promoted.map((user) => user.email).join(", ")
      )
    }

    if (missing.length > 0) {
      console.warn(
        "ADMIN_EMAILS lists emails without a registered account: " +
          `${missing.join(", ")}. No account was created; the next start ` +
          "promotes them once they register."
      )
    }
  } catch (error) {
    console.error(
      "Admin promotion from ADMIN_EMAILS failed; continuing without it. " +
        "Fix ADMIN_EMAILS and restart to retry.",
      error instanceof Error ? error.message : error
    )
  }
}
