"use client"

import { ArrowUpRight, Lock, Unlock } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { itemStatusLine } from "@/components/review/item-card"
import { SeverityBadge } from "@/components/review/severity-badge"
import { StatusBadge } from "@/components/review/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { claimItemAction } from "@/lib/review/actions"
import type { ItemReviewState } from "@/lib/review/decisions"
import { formatItemKind } from "@/lib/review/format"
import type { ReviewItem } from "@/lib/review/types"

export interface QueueRow {
  item: ReviewItem
  state: ItemReviewState
  paperTitle: string
  href: string
}

export function QueueTable({
  batchId,
  rows,
  reviewerNames,
  currentUserId,
  readOnly,
}: {
  batchId: string
  rows: readonly QueueRow[]
  reviewerNames: Record<string, string>
  currentUserId: string
  readOnly: boolean
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function reserve(row: QueueRow) {
    setPendingId(row.item.id)
    try {
      const result = await claimItemAction({
        batchId,
        paperId: row.item.paperId,
        itemKind: row.item.kind,
        itemRef: row.item.ref,
      })
      if (!result.ok) {
        toast.error(result.message)
        router.refresh()
        return
      }
      toast.success(`Reserved “${row.item.title}”`)
      router.refresh()
    } catch {
      toast.error("The reservation could not be completed. Reload the queue.")
      router.refresh()
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Severity</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Paper</TableHead>
          <TableHead className="min-w-72">Item</TableHead>
          <TableHead className="min-w-56">Status / claim</TableHead>
          <TableHead className="w-28">Reserve</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Open</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const mine = row.state.claim?.userId === currentUserId
          const canReserve =
            !readOnly &&
            row.state.status !== "closed" &&
            row.state.claim === null
          return (
            <TableRow key={row.item.id}>
              <TableCell>
                <SeverityBadge severity={row.item.severity} />
              </TableCell>
              <TableCell>
                <Badge variant="outline">{formatItemKind(row.item.kind)}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex max-w-48 flex-col">
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.item.paperId}
                  </span>
                  <span className="truncate text-xs" title={row.paperTitle}>
                    {row.paperTitle}
                  </span>
                </div>
              </TableCell>
              <TableCell className="max-w-2xl whitespace-normal">
                <Link
                  href={row.href}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.item.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{row.item.ref}</span>
                  {row.item.summary ? (
                    <span className="line-clamp-1 max-w-xl">
                      {row.item.summary}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="max-w-64 text-xs whitespace-normal text-muted-foreground">
                <div className="flex flex-col gap-1">
                  <StatusBadge status={row.state.status} />
                  <span className="line-clamp-2">
                    {itemStatusLine(row.item, row.state, reviewerNames)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                {canReserve ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingId === row.item.id}
                    aria-label={`Reserve ${row.item.title}`}
                    onClick={() => void reserve(row)}
                  >
                    {pendingId === row.item.id ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Lock data-icon="inline-start" />
                    )}
                    Reserve
                  </Button>
                ) : mine ? (
                  <Badge variant="secondary">
                    <Unlock data-icon="inline-start" />
                    Yours
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {readOnly ? "Read only" : "View only"}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Link
                  href={row.href}
                  aria-label={`Open ${row.item.title}`}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
