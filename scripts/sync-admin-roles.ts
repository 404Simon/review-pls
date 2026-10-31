import "dotenv/config"

import { pathToFileURL } from "node:url"

import type { AppDatabase } from "@/db"
import {
  AdminBootstrapError,
  bootstrapAdminRoles,
  type AdminCandidate,
  type AdminRoleSyncResult,
} from "@/lib/review/roles"

export interface SyncOutput {
  log: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export interface SyncOptions {
  argv: readonly string[]
  adminEmails: string | undefined
  db: AppDatabase
  output?: Partial<SyncOutput>
}

interface ParsedArgs {
  help: boolean
  list: boolean
  userId: string | null
}

const USAGE = `Usage: pnpm review:admin:sync [--list | --user-id <id>]

Bootstrap admin roles from the ADMIN_EMAILS allowlist.

  --list            Print registered candidates and exit without writing.
  --user-id <id>    Promote exactly this registered user. Its email must be
                    listed in ADMIN_EMAILS.
  --help, -h        Show this help.

ADMIN_EMAILS is only a candidate allowlist. It never grants admin at request
time and the sync never promotes automatically. Because the invite code is
shared, an attacker could pre-register an allowlisted address, so an operator
must confirm the real admin's user id after that person has registered.

The command exits non-zero when a configured email has no registered account,
so a typo or an unregistered admin is visible instead of silently ignored.`

class SyncUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SyncUsageError"
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let help = false
  let list = false
  let userId: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }
    if (arg === "--list") {
      list = true
      continue
    }
    if (arg === "--user-id") {
      if (userId !== null) {
        throw new SyncUsageError("--user-id may only be given once.")
      }
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) {
        throw new SyncUsageError("--user-id requires a user id.")
      }
      userId = value
      index += 1
      continue
    }
    throw new SyncUsageError(`Unknown argument: ${arg}`)
  }

  if (list && userId !== null) {
    throw new SyncUsageError("--list cannot be combined with --user-id.")
  }

  return { help, list, userId }
}

function formatCandidate(candidate: AdminCandidate): string {
  const verified = candidate.emailVerified ? "verified" : "unverified"
  const role = candidate.alreadyAdmin ? "admin" : "reviewer"
  return (
    `  ${candidate.email}  ${candidate.userId}  ` +
    `${verified}  registered ${new Date(candidate.createdAt).toISOString()}  ` +
    `role=${role}`
  )
}

function printCandidates(
  result: AdminRoleSyncResult,
  output: SyncOutput
): void {
  if (result.candidates.length === 0) {
    output.log("No registered users match ADMIN_EMAILS yet.")
  } else {
    output.log("Registered candidates from ADMIN_EMAILS:")
    for (const candidate of result.candidates) {
      output.log(formatCandidate(candidate))
    }
  }

  if (result.missing.length > 0) {
    output.warn("")
    output.warn(
      "These configured emails have no registered account. " +
        "They were not created or promoted:"
    )
    for (const email of result.missing) {
      output.warn(`  ${email}`)
    }
  }
}

function printPromoted(result: AdminRoleSyncResult, output: SyncOutput): void {
  if (result.promoted.length === 0) {
    output.log("No user needed promotion.")
    return
  }
  output.log(`Promoted ${result.promoted.length} user(s) to admin:`)
  for (const promoted of result.promoted) {
    output.log(`  ${promoted.email} (${promoted.userId})`)
  }
}

/**
 * Run the sync command. Returns the process exit code; `main` maps it to
 * `process.exitCode`. Kept separate from module startup so tests can drive it
 * against an isolated database without spawning a process.
 */
export async function runAdminRoleSync(options: SyncOptions): Promise<number> {
  const output: SyncOutput = {
    log: options.output?.log ?? console.log,
    warn: options.output?.warn ?? console.warn,
    error: options.output?.error ?? console.error,
  }

  let parsed: ParsedArgs
  try {
    parsed = parseArgs(options.argv)
  } catch (error) {
    if (error instanceof SyncUsageError) {
      output.error(`review:admin:sync: ${error.message}`)
      output.error("")
      output.error(USAGE)
      return 1
    }
    throw error
  }

  if (parsed.help) {
    output.log(USAGE)
    return 0
  }

  if (!options.adminEmails?.trim()) {
    output.error(
      "ADMIN_EMAILS is not set. Set a comma-separated allowlist of " +
        "already-registered admin emails."
    )
    return 1
  }

  try {
    const result = await bootstrapAdminRoles(
      options.db,
      options.adminEmails,
      parsed.userId === null ? {} : { confirmUserId: parsed.userId }
    )

    if (parsed.list) {
      printCandidates(result, output)
    } else if (parsed.userId === null) {
      printCandidates(result, output)
      output.log("")
      output.log(USAGE)
      output.error(
        "No change was made. Pass --user-id <id> to promote a confirmed candidate."
      )
      return 1
    } else {
      printPromoted(result, output)
      if (result.missing.length > 0) {
        printCandidates(result, output)
      }
    }

    if (result.missing.length > 0) {
      output.error(
        "review:admin:sync: ADMIN_EMAILS contains emails without an account. " +
          "Register those accounts or fix the allowlist, then run the sync again."
      )
      return 1
    }

    return 0
  } catch (error) {
    if (error instanceof AdminBootstrapError) {
      output.error(`review:admin:sync: ${error.message}`)
      try {
        const candidates = await bootstrapAdminRoles(
          options.db,
          options.adminEmails
        )
        printCandidates(candidates, output)
      } catch {
        // The candidate listing is best-effort; the original error is enough.
      }
      return 1
    }
    throw error
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE)
    return
  }

  // Loaded lazily so `--help` never opens or creates a database.
  const { db } = await import("@/db")
  process.exitCode = await runAdminRoleSync({
    argv,
    adminEmails: process.env.ADMIN_EMAILS,
    db,
  })
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  return import.meta.url === pathToFileURL(entry).href
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? `review:admin:sync: ${error.message}` : error
    )
    process.exitCode = 1
  })
}
