import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { db } from "@/db"
import { isValidRegistrationCode } from "@/lib/registration-code"

const profileFieldLimits = {
  name: 100,
  association: 120,
  title: 120,
} as const

function validateProfileUpdate(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return
  }

  const fields = body as Record<string, unknown>

  for (const [field, limit] of Object.entries(profileFieldLimits)) {
    const value = fields[field]
    if (value === undefined) {
      continue
    }

    if (typeof value !== "string") {
      throw new APIError("BAD_REQUEST", { message: `${field} must be text` })
    }

    const trimmed = value.trim()
    if (field === "name" && !trimmed) {
      throw new APIError("BAD_REQUEST", { message: "Name is required" })
    }

    if (trimmed.length > limit) {
      throw new APIError("BAD_REQUEST", {
        message: `${field} must be at most ${limit} characters`,
      })
    }
  }
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
  }),

  emailAndPassword: {
    enabled: true,
  },

  user: {
    additionalFields: {
      association: {
        type: "string",
        required: false,
        defaultValue: "none",
      },
      title: {
        type: "string",
        required: false,
        defaultValue: "none",
      },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/update-user") {
        validateProfileUpdate(ctx.body)
        return
      }

      if (ctx.path !== "/sign-up/email") return

      if (!isValidRegistrationCode(ctx.body?.loginCode)) {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid registration code",
        })
      }
    }),
  },
})
