import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { appSetting } from "@/db/review-schema"
import {
  isRegistrationOpen,
  REGISTRATION_CLOSED_MESSAGE,
  registrationGate,
  setRegistrationOpen,
} from "@/lib/registration"
import { createTestDb, type TestDb } from "@/lib/review/test-support"

const originalCode = process.env.REGISTRATION_CODE

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
  process.env.REGISTRATION_CODE = "invite-code"
})

afterEach(() => {
  testDb.close()
  if (originalCode === undefined) {
    delete process.env.REGISTRATION_CODE
  } else {
    process.env.REGISTRATION_CODE = originalCode
  }
})

describe("isRegistrationOpen", () => {
  it("defaults to open without a settings row", () => {
    expect(isRegistrationOpen(testDb.db)).toBe(true)
  })

  it("follows the stored switch", () => {
    setRegistrationOpen(testDb.db, false, 100)
    expect(isRegistrationOpen(testDb.db)).toBe(false)

    setRegistrationOpen(testDb.db, true, 200)
    expect(isRegistrationOpen(testDb.db)).toBe(true)
    expect(testDb.db.select().from(appSetting).all()).toEqual([
      { key: "registration_open", value: "1", updatedAt: 200 },
    ])
  })
})

describe("registrationGate", () => {
  it("rejects every sign-up while registration is closed", () => {
    expect(registrationGate(false, "invite-code")).toEqual({
      allowed: false,
      status: 403,
      message: REGISTRATION_CLOSED_MESSAGE,
    })
  })

  it("still requires the invite code while registration is open", () => {
    expect(registrationGate(true, "wrong")).toEqual({
      allowed: false,
      status: 400,
      message: "Invalid registration code",
    })
    expect(registrationGate(true, undefined)).toMatchObject({ allowed: false })
  })

  it("accepts the invite code while registration is open", () => {
    expect(registrationGate(true, "invite-code")).toEqual({ allowed: true })
  })

  it("fails closed when no invite code is configured", () => {
    delete process.env.REGISTRATION_CODE
    expect(registrationGate(true, "invite-code")).toMatchObject({
      allowed: false,
      status: 400,
    })
  })
})
