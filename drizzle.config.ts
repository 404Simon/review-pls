import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/db/auth-schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./local.db",
  },
})
