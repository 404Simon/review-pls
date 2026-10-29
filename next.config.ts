import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Keeps the Playwright dev server isolated from a running `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
}

export default nextConfig
