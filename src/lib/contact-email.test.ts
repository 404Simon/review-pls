import { afterEach, describe, expect, it } from "vitest"

import { getContactEmail } from "@/lib/contact-email"

const original = process.env.CONTACT_EMAIL

afterEach(() => {
  if (original === undefined) {
    delete process.env.CONTACT_EMAIL
  } else {
    process.env.CONTACT_EMAIL = original
  }
})

describe("getContactEmail", () => {
  it("returns the configured address and trims whitespace", () => {
    process.env.CONTACT_EMAIL = "  help@example.org  "
    expect(getContactEmail()).toBe("help@example.org")
  })

  it("rejects a missing address", () => {
    delete process.env.CONTACT_EMAIL
    expect(() => getContactEmail()).toThrow(
      "CONTACT_EMAIL must be set to a valid email address."
    )
  })

  it("rejects an invalid address", () => {
    process.env.CONTACT_EMAIL = "not-an-email"
    expect(() => getContactEmail()).toThrow(
      "CONTACT_EMAIL must be set to a valid email address."
    )
  })
})
