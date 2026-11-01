export async function register() {
  // `register` also runs for the Edge runtime and while `next build` collects
  // page data. Migrations and admin promotion load better-sqlite3, so they are
  // only imported into the Node.js server runtime. The positive `NEXT_RUNTIME`
  // check is what lets the Edge bundle drop this import entirely.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { runStartupTasks } = await import("./lib/review/startup")
    runStartupTasks()
  }
}
