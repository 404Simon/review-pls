"use client"

import { RotateCcw, Unlock } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  adminReopenItemAction,
  adminReleaseClaimAction,
} from "@/lib/review/actions"
import type { ItemKind } from "@/lib/review/types"

export function AdminItemActions({
  batchId,
  paperId,
  itemKind,
  itemRef,
  hasClaim,
  isClosed,
  onBeforeRelease,
  onReleaseFailed,
}: {
  batchId: string
  paperId: string
  itemKind: ItemKind
  itemRef: string
  hasClaim: boolean
  isClosed: boolean
  /** Stop the claimant's autosave before the admin deletes the claim. */
  onBeforeRelease: () => Promise<void>
  /** Re-enable autosave when the admin release did not happen. */
  onReleaseFailed: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState<"release" | "reopen" | null>(null)
  const [open, setOpen] = useState<"release" | "reopen" | null>(null)
  const key = { batchId, paperId, itemKind, itemRef }

  async function release() {
    setPending("release")
    try {
      // Wait for a draft write already on the wire and clear the debounce.
      // Otherwise a late autosave atomically re-claims the released item.
      await onBeforeRelease()
      const result = await adminReleaseClaimAction(key)
      if (!result.ok) {
        onReleaseFailed()
        toast.error(result.message)
        return
      }
      toast.success("Claim released by admin.")
      setOpen(null)
      router.refresh()
    } catch {
      onReleaseFailed()
      toast.error("The claim could not be released. Reload the item.")
    } finally {
      setPending(null)
    }
  }

  async function reopen() {
    setPending("reopen")
    try {
      const result = await adminReopenItemAction(key)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success("Item reopened as an admin draft.")
      setOpen(null)
      router.refresh()
    } catch {
      toast.error("The item could not be reopened. Reload the item.")
    } finally {
      setPending(null)
    }
  }

  if (!hasClaim && !isClosed) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Admin
      </span>
      {hasClaim ? (
        <AlertDialog
          open={open === "release"}
          onOpenChange={(value) => setOpen(value ? "release" : null)}
        >
          <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
            <Unlock data-icon="inline-start" />
            Release claim
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Release this claim?</AlertDialogTitle>
              <AlertDialogDescription>
                The reviewer will need to reserve the item again. The decision
                data is untouched.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending === "release"}
                onClick={() => void release()}
              >
                Release claim
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {isClosed ? (
        <AlertDialog
          open={open === "reopen"}
          onOpenChange={(value) => setOpen(value ? "reopen" : null)}
        >
          <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
            <RotateCcw data-icon="inline-start" />
            Reopen item
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reopen this closed item?</AlertDialogTitle>
              <AlertDialogDescription>
                The final decision becomes an admin-owned draft and the item
                returns to the pool. The previous payload is preserved in the
                history.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending === "reopen"}
                onClick={() => void reopen()}
              >
                Reopen item
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
