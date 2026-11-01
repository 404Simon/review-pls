"use client"

import {
  DoorClosed,
  DoorOpen,
  RefreshCw,
  ShieldCheck,
  ShieldMinus,
  Snowflake,
  Sun,
  Unlock,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  adminReloadReviewDataAction,
  adminReleaseClaimAction,
  adminSetFrozenAction,
  adminSetRegistrationAction,
  adminSetRoleAction,
} from "@/lib/review/actions"
import { formatCount } from "@/lib/review/format"
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

export function AdminFreezeControl({
  userId,
  frozen,
  isSelf,
  isAdmin,
}: {
  userId: string
  frozen: boolean
  isSelf: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const nextFrozen = !frozen
  const blocked = isSelf || (!frozen && isAdmin)

  async function toggleFrozen() {
    setPending(true)
    try {
      const result = await adminSetFrozenAction({
        userId,
        frozen: nextFrozen,
      })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      if (nextFrozen) {
        toast.success(
          result.data.releasedClaims > 0
            ? `Account frozen. ${formatCount(result.data.releasedClaims, "claim")} released.`
            : "Account frozen."
        )
      } else {
        toast.success("Account unfrozen.")
      }
      router.refresh()
    } catch {
      toast.error("The account status could not be changed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || blocked}
      title={
        isSelf
          ? "You cannot freeze your own account."
          : !frozen && isAdmin
            ? "Demote the admin before freezing the account."
            : undefined
      }
      onClick={() => void toggleFrozen()}
    >
      {pending ? (
        <Spinner data-icon="inline-start" />
      ) : nextFrozen ? (
        <Snowflake data-icon="inline-start" />
      ) : (
        <Sun data-icon="inline-start" />
      )}
      {nextFrozen ? "Freeze" : "Unfreeze"}
    </Button>
  )
}

export function AdminRegistrationControl({ open }: { open: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function toggleRegistration() {
    setPending(true)
    try {
      const result = await adminSetRegistrationAction({ open: !open })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(
        result.data.open
          ? "Registration is open again."
          : "Registration closed. New sign-ups are blocked."
      )
      router.refresh()
    } catch {
      toast.error("Registration could not be changed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Badge variant={open ? "secondary" : "destructive"}>
            {open ? "Open" : "Closed"}
          </Badge>
          New account sign-ups
        </span>
        <span className="text-xs text-muted-foreground">
          {open
            ? "Anyone with the registration code can create an account."
            : "No new accounts can be created. Existing accounts can still sign in and review."}
        </span>
        <span className="text-xs text-muted-foreground">
          The invite code from{" "}
          <span className="font-mono">REGISTRATION_CODE</span> is still required
          while registration is open.
        </span>
      </div>
      <Button
        variant={open ? "outline" : "default"}
        size="sm"
        disabled={pending}
        onClick={() => void toggleRegistration()}
      >
        {pending ? (
          <Spinner data-icon="inline-start" />
        ) : open ? (
          <DoorClosed data-icon="inline-start" />
        ) : (
          <DoorOpen data-icon="inline-start" />
        )}
        {open ? "Close registration" : "Open registration"}
      </Button>
    </div>
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
