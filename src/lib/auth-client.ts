import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

import type { auth } from "@/lib/auth"

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
})

type SignUpWithRegistrationCodeInput = {
  name: string
  email: string
  password: string
  loginCode: string
  association?: string
  title?: string
}

type AuthErrorResponse = {
  message?: string
}

export async function signUpWithRegistrationCode(
  input: SignUpWithRegistrationCodeInput
) {
  const response = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  const result = (await response
    .json()
    .catch(() => null)) as AuthErrorResponse | null

  if (!response.ok) {
    throw new Error(result?.message ?? "Registration failed")
  }
}
