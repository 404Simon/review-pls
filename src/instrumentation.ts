export async function register() {
  // Instrumentation also runs for the Edge runtime and while `next build`
  // collects page data; migrations only belong in the Node.js server runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.NEXT_PHASE === "phase-production-build") return

  const { migrateDatabase } = await import("./db/migrate")
  migrateDatabase()
}
