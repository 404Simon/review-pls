import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/db"
import { appSetting } from "@/db/review-schema"
import { isValidRegistrationCode } from "@/lib/registration-code"

/** Key in `app_setting`; an absent row means registration is open. */
export const REGISTRATION_OPEN_KEY = "registration_open"

export const REGISTRATION_CLOSED_MESSAGE =
  "Registration is currently closed. Ask an administrator for access."

/**
 * Whether new accounts may be created. Defaults to open so existing
 * deployments keep working without a settings row.
 */
export function isRegistrationOpen(db: AppDatabase): boolean {
  const row = db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, REGISTRATION_OPEN_KEY))
    .get()
  return row?.value !== "0"
}

export function setRegistrationOpen(
  db: AppDatabase,
  open: boolean,
  now: number = Date.now()
): void {
  const value = open ? "1" : "0"
  db.insert(appSetting)
    .values({ key: REGISTRATION_OPEN_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: appSetting.key,
      set: { value, updatedAt: now },
    })
    .run()
}

export type RegistrationGate =
  { allowed: true } | { allowed: false; status: 400 | 403; message: string }

/**
 * Single decision used by the Better Auth sign-up hook. The admin switch is
 * checked before the invite code so a closed deployment rejects every new
 * account, even with a valid code.
 */
export function registrationGate(
  open: boolean,
  submittedCode: unknown
): RegistrationGate {
  if (!open) {
    return {
      allowed: false,
      status: 403,
      message: REGISTRATION_CLOSED_MESSAGE,
    }
  }
  if (!isValidRegistrationCode(submittedCode)) {
    return {
      allowed: false,
      status: 400,
      message: "Invalid registration code",
    }
  }
  return { allowed: true }
}
