import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { db } from "@/db"
import { isValidRegistrationCode } from "@/lib/registration-code"

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
      if (ctx.path !== "/sign-up/email") return

      if (!isValidRegistrationCode(ctx.body?.loginCode)) {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid registration code",
        })
      }
    }),
  },
})
