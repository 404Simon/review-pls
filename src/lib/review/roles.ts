import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import { user } from "@/db/auth-schema"
import { reviewerRole } from "@/db/review-schema"

export type UserRole = "reviewer" | "admin"

export interface RoleUser {
  id: string
  email?: string | null
}

export interface RoleOptions {
  db?: AppDatabase
  now?: number
}

export type AuthorizationCode = "UNAUTHENTICATED" | "FORBIDDEN"

export class AuthorizationError extends Error {
  readonly code: AuthorizationCode

  constructor(code: AuthorizationCode, message: string) {
    super(message)
    this.name = "AuthorizationError"
    this.code = code
  }
}

/**
 * `ADMIN_EMAILS` is a comma-separated bootstrap allowlist used by
 * `bootstrapAdminRoles`, never by runtime authorization. Comparison is trimmed
 * and case-insensitive; empty entries are ignored.
 */
export function parseAdminEmails(
  value: string | null | undefined
): Set<string> {
  if (!value) {
    return new Set()
  }
  return new Set(
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0)
  )
}

async function resolveDb(db: AppDatabase | undefined): Promise<AppDatabase> {
  if (db) {
    return db
  }
  // Kept lazy so importing the role helpers in tests and pure code does not
  // open the application database just to read a role.
  const appModule = await import("@/db")
  return appModule.db
}

/** Runtime roles come only from `reviewer_role`; env allowlists never grant. */
export async function getUserRole(
  userRecord: RoleUser,
  options?: RoleOptions
): Promise<UserRole> {
  const db = await resolveDb(options?.db)
  const row = db
    .select()
    .from(reviewerRole)
    .where(eq(reviewerRole.userId, userRecord.id))
    .get()

  return row?.role ?? "reviewer"
}

export interface AuthorizedUser {
  user: RoleUser
  role: UserRole
}

/** Any authenticated user may review. */
export async function requireReviewer(
  userRecord: RoleUser | null | undefined,
  options?: RoleOptions
): Promise<AuthorizedUser> {
  if (!userRecord) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "You must be signed in to review."
    )
  }
  return {
    user: userRecord,
    role: await getUserRole(userRecord, options),
  }
}

export async function requireAdmin(
  userRecord: RoleUser | null | undefined,
  options?: RoleOptions
): Promise<AuthorizedUser> {
  const authorized = await requireReviewer(userRecord, options)
  if (authorized.role !== "admin") {
    throw new AuthorizationError(
      "FORBIDDEN",
      "Only admins can perform this action."
    )
  }
  return authorized
}

type RoleWriter = Pick<AppDatabase, "insert">

export type RoleTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0]

function writeUserRole(
  db: RoleWriter,
  userId: string,
  role: UserRole,
  now: number
): void {
  db.insert(reviewerRole)
    .values({ userId, role, createdAt: now })
    .onConflictDoUpdate({ target: reviewerRole.userId, set: { role } })
    .run()
}

/**
 * Transaction-aware role write. Callers that must keep a read (for example the
 * last-admin guard) atomic with the update use this inside `db.transaction`.
 */
export function setUserRoleInTransaction(
  tx: RoleTransaction,
  userId: string,
  role: UserRole,
  now: number = Date.now()
): void {
  writeUserRole(tx, userId, role, now)
}

export async function setUserRole(
  userId: string,
  role: UserRole,
  options?: RoleOptions
): Promise<void> {
  const db = await resolveDb(options?.db)
  const now = options?.now ?? Date.now()
  writeUserRole(db, userId, role, now)
}

export interface UserRoleRow {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: UserRole
  createdAt: number
}

/**
 * Every registered user with their current role. Admin-only management data;
 * callers must have passed `requireAdmin` before rendering it.
 */
export function listUserRoles(db: AppDatabase): UserRoleRow[] {
  const roles = new Map(
    db
      .select({ userId: reviewerRole.userId, role: reviewerRole.role })
      .from(reviewerRole)
      .all()
      .map((row) => [row.userId, row.role])
  )
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerified,
      role: roles.get(row.id) ?? "reviewer",
      createdAt: row.createdAt.getTime(),
    }))
    .sort((a, b) => a.email.localeCompare(b.email) || a.id.localeCompare(b.id))
}

export interface AdminCandidate {
  userId: string
  email: string
  emailVerified: boolean
  createdAt: number
  alreadyAdmin: boolean
}

export interface PromotedAdmin {
  userId: string
  email: string
}

export interface AdminRoleSyncResult {
  /** Registered users whose email matches the `ADMIN_EMAILS` allowlist. */
  candidates: AdminCandidate[]
  /** Existing users that were newly promoted to admin by this run. */
  promoted: PromotedAdmin[]
  /** Configured emails that do not belong to any registered user yet. */
  missing: string[]
}

export type AdminBootstrapErrorCode = "unknown_user" | "email_not_allowlisted"

export class AdminBootstrapError extends Error {
  readonly code: AdminBootstrapErrorCode

  constructor(code: AdminBootstrapErrorCode, message: string) {
    super(message)
    this.name = "AdminBootstrapError"
    this.code = code
  }
}

export interface BootstrapAdminOptions {
  /**
   * Promote exactly this registered user. It must exist and its email must be
   * in `ADMIN_EMAILS`. Omit it to only list candidates; the function then
   * writes nothing.
   */
  confirmUserId?: string
  now?: number
}

function keyOfCandidate(row: { email: string; id: string }): string {
  return row.email.trim().toLowerCase()
}

/**
 * List registered users that match the `ADMIN_EMAILS` bootstrap allowlist and,
 * only when an operator explicitly confirms a user id, promote that one user.
 *
 * `ADMIN_EMAILS` alone never grants admin and the sync never promotes a user
 * automatically. That is deliberate: the invite code is shared, so an attacker
 * could pre-register an allowlisted address. An operator must inspect the
 * candidates and confirm the account id of the real admin after that person
 * has registered.
 *
 * Missing configured emails are reported and never created. Promotion runs in
 * one transaction so a failure cannot leave a partial sync behind.
 */
export async function bootstrapAdminRoles(
  db: AppDatabase,
  adminEmails: string | null | undefined,
  options: BootstrapAdminOptions = {}
): Promise<AdminRoleSyncResult> {
  const configured = [...parseAdminEmails(adminEmails)]
  if (configured.length === 0) {
    return { candidates: [], promoted: [], missing: [] }
  }

  const configuredSet = new Set(configured)
  const users = db
    .select({
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .all()
  const roles = new Map(
    db
      .select({ userId: reviewerRole.userId, role: reviewerRole.role })
      .from(reviewerRole)
      .all()
      .map((row) => [row.userId, row.role])
  )

  const candidates: AdminCandidate[] = []
  const matchedEmails = new Set<string>()

  for (const row of users) {
    const email = keyOfCandidate(row)
    if (!configuredSet.has(email)) {
      continue
    }
    matchedEmails.add(email)
    candidates.push({
      userId: row.id,
      email: row.email,
      emailVerified: row.emailVerified,
      createdAt: row.createdAt.getTime(),
      alreadyAdmin: roles.get(row.id) === "admin",
    })
  }
  candidates.sort(
    (a, b) => a.email.localeCompare(b.email) || a.userId.localeCompare(b.userId)
  )

  const missing = configured.filter((email) => !matchedEmails.has(email))

  const { confirmUserId } = options
  if (confirmUserId === undefined) {
    return { candidates, promoted: [], missing }
  }

  const now = options.now ?? Date.now()
  const promoted = db.transaction((tx) => {
    const confirmed = tx
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, confirmUserId))
      .get()

    if (!confirmed) {
      throw new AdminBootstrapError(
        "unknown_user",
        `Unknown user id "${confirmUserId}". Register the admin account first.`
      )
    }

    const confirmedEmail = keyOfCandidate(confirmed)
    if (!configuredSet.has(confirmedEmail)) {
      throw new AdminBootstrapError(
        "email_not_allowlisted",
        `User "${confirmed.email}" (${confirmed.id}) is not in ADMIN_EMAILS. Refusing to promote.`
      )
    }

    const currentRole = tx
      .select({ role: reviewerRole.role })
      .from(reviewerRole)
      .where(eq(reviewerRole.userId, confirmed.id))
      .get()
    if (currentRole?.role === "admin") {
      return []
    }

    writeUserRole(tx, confirmed.id, "admin", now)
    return [{ userId: confirmed.id, email: confirmed.email }]
  })

  return { candidates, promoted, missing }
}
