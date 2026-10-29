import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { db } from "@/db"

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

      const expectedCode = process.env.REGISTRATION_CODE
      const submittedCode = ctx.body?.loginCode

      if (
        !expectedCode ||
        typeof submittedCode !== "string" ||
        submittedCode !== expectedCode
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid registration code",
        })
      }
    }),
  },
})
