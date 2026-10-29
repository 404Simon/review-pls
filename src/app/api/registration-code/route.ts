import { NextResponse } from "next/server"

import { consumeRateLimit } from "@/lib/rate-limit"
import { isValidRegistrationCode } from "@/lib/registration-code"

const RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 }

function clientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"

  return `registration-code:${ip}`
}

function readCode(body: unknown) {
  if (typeof body !== "object" || body === null || !("code" in body)) {
    return undefined
  }

  return (body as { code?: unknown }).code
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null)

  if (isValidRegistrationCode(readCode(body))) {
    return NextResponse.json({ ok: true })
  }

  const { allowed, retryAfterMs } = consumeRateLimit(
    clientKey(request),
    RATE_LIMIT
  )

  if (!allowed) {
    return NextResponse.json(
      { message: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
        },
      }
    )
  }

  return NextResponse.json(
    { message: "Invalid registration code" },
    { status: 400 }
  )
}
