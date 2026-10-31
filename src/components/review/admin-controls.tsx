"use client"

import { RefreshCw, ShieldCheck, ShieldMinus, Unlock } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  adminReloadReviewDataAction,
  adminReleaseClaimAction,
  adminSetRoleAction,
} from "@/lib/review/actions"
import type { ItemKind } from "@/lib/review/types"
import type { UserRole } from "@/lib/review/roles"

export function AdminReloadData() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function reload() {
    setPending(true)
    try {
      const result = await adminReloadReviewDataAction()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success("Review data cache cleared.")
      router.refresh()
    } catch {
      toast.error("The review data could not be reloaded.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void reload()}
      disabled={pending}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RefreshCw data-icon="inline-start" />
      )}
      Reload data
    </Button>
  )
}

export function AdminRoleControl({
  userId,
  role,
  isSelf,
}: {
  userId: string
  role: UserRole
  isSelf: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const nextRole: UserRole = role === "admin" ? "reviewer" : "admin"
  const label = nextRole === "admin" ? "Promote" : "Demote"

  async function changeRole() {
    setPending(true)
    try {
      const result = await adminSetRoleAction({ userId, role: nextRole })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        nextRole === "admin" ? "User promoted to admin." : "User demoted."
      )
      router.refresh()
    } catch {
      toast.error("The role could not be changed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant={nextRole === "admin" ? "default" : "outline"}
      size="sm"
      disabled={pending || isSelf}
      title={
        isSelf
          ? "Change your own role from the CLI or another admin."
          : undefined
      }
      onClick={() => void changeRole()}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : nextRole === "admin" ? (
        <ShieldCheck data-icon="inline-start" />
      ) : (
        <ShieldMinus data-icon="inline-start" />
      )}
      {label}
    </Button>
  )
}

export function AdminReleaseClaim({
  batchId,
  paperId,
  itemKind,
  itemRef,
}: {
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function release() {
    setPending(true)
    try {
      const result = await adminReleaseClaimAction({
        batchId,
        paperId,
        itemKind,
        itemRef,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success("Claim released by admin.")
      router.refresh()
    } catch {
      toast.error("The claim could not be released.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void release()}
      disabled={pending}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Unlock data-icon="inline-start" />
      )}
      Release
    </Button>
  )
}
