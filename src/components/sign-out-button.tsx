"use client"

import { LogOut } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    setError(null)
    setPending(true)

    try {
      const { error: signOutError } = await authClient.signOut()

      if (signOutError) {
        setError(signOutError.message ?? "Sign out failed")
        return
      }

      router.replace("/sign-in")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign out failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSignOut}
        disabled={pending}
      >
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <LogOut data-icon="inline-start" />
        )}
        Sign out
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
