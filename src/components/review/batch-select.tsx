"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { batchSwitchHref } from "@/lib/review/batch-nav"

export interface BatchOption {
  batchId: string
  label: string
}

export function BatchSelect({
  batches,
  activeBatchId,
}: {
  batches: readonly BatchOption[]
  activeBatchId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const fromQuery = searchParams.get("batch")
  // An unknown ?batch= must not silently present another mounted batch as the
  // current one. Leave the selector empty until the reviewer picks a batch.
  const selected =
    activeBatchId ??
    (fromQuery
      ? batches.some((batch) => batch.batchId === fromQuery)
        ? fromQuery
        : null
      : (batches[0]?.batchId ?? null))

  if (batches.length === 0) {
    return null
  }

  return (
    <Select
      items={batches.map((batch) => ({
        value: batch.batchId,
        label: batch.label,
      }))}
      value={selected}
      onValueChange={(value) => {
        if (typeof value !== "string" || value === "") {
          return
        }
        router.push(batchSwitchHref(pathname, value))
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Select batch"
        className="max-w-56 min-w-36 bg-background"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {batches.map((batch) => (
          <SelectItem key={batch.batchId} value={batch.batchId}>
            {batch.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
