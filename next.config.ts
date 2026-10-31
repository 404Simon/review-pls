import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  // Keeps the Playwright dev server isolated from a running `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Defense in depth for the standalone trace. Review data, local databases
  // and test tooling are bind-mounted or rebuilt at runtime and must never be
  // copied into the deployment image.
  outputFileTracingExcludes: {
    "/*": [
      "./review-data/**",
      "./data/**",
      "./exports/**",
      "./e2e/**",
      "./scripts/**",
      "./src/**",
      "./.env*",
      "./local.db*",
    ],
  },
}

export default nextConfig
