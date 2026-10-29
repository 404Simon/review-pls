import { createHash, timingSafeEqual } from "node:crypto"

function digest(value: string) {
  return createHash("sha256").update(value).digest()
}

/**
 * Check a submitted invite code against REGISTRATION_CODE.
 *
 * Both values are hashed first so the comparison is constant-time and does not
 * leak the expected code's length. Fails closed when REGISTRATION_CODE is unset.
 */
export function isValidRegistrationCode(submitted: unknown) {
  const expected = process.env.REGISTRATION_CODE

  if (!expected || typeof submitted !== "string" || submitted.length === 0) {
    return false
  }

  return timingSafeEqual(digest(submitted), digest(expected))
}
