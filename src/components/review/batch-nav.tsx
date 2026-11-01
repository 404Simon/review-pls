"use client"

import { useSearchParams } from "next/navigation"

import { WorkspaceNav } from "@/components/review/workspace-nav"
import { batchNavItems } from "@/lib/review/batch-nav"

/**
 * The dashboard layout cannot read search params, so the shell derives the
 * active batch from `?batch=` in the client. That keeps the header links
 * pointing at the batch the dashboard is showing.
 */
export function BatchNav({
  activeBatchId,
  defaultBatchId,
  isAdmin,
}: {
  activeBatchId: string | null
  /** First healthy batch, used when no valid batch is requested. */
  defaultBatchId: string | null
  isAdmin: boolean
}) {
  const searchParams = useSearchParams()
  const fromQuery = searchParams.get("batch")
  // Keep an unknown ?batch= in the header instead of silently presenting the
  // first healthy batch.
  const candidate = activeBatchId ?? fromQuery ?? defaultBatchId ?? null

  return <WorkspaceNav items={batchNavItems(candidate, { isAdmin })} />
}
