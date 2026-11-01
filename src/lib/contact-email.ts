import { z } from "zod"

const contactEmailSchema = z.email()

/**
 * Where reviewers are told to ask for help. A deployment without this is a
 * configuration error, not a silently hidden contact link.
 */
export function getContactEmail(): string {
  const result = contactEmailSchema.safeParse(process.env.CONTACT_EMAIL?.trim())

  if (!result.success) {
    throw new Error("CONTACT_EMAIL must be set to a valid email address.")
  }

  return result.data
}
