"use client"

import { useSearchParams } from "next/navigation"

import { WorkspaceNav } from "@/components/review/workspace-nav"
import { batchNavItems } from "@/lib/review/batch-nav"

/**
 * The dashboard layout cannot read search params, so the shell derives the
 * active batch from `?batch=` in the client. That keeps the header links and
 * the batch selector pointing at the batch the dashboard is showing.
 */
export function BatchNav({
  activeBatchId,
  batchIds,
  defaultBatchId,
  isAdmin,
}: {
  activeBatchId: string | null
  /** Every mounted batch, including corrupt ones, so a requested id is kept. */
  batchIds: readonly string[]
  /** First healthy batch, used when no valid batch is requested. */
  defaultBatchId: string | null
  isAdmin: boolean
}) {
  const searchParams = useSearchParams()
  const fromQuery = searchParams.get("batch")
  // Keep an unknown ?batch= in the header instead of silently presenting the
  // first healthy batch. Its Queue link is disabled because that route is 404.
  const candidate =
    activeBatchId ?? fromQuery ?? defaultBatchId ?? batchIds[0] ?? null
  const mounted = candidate === null || batchIds.includes(candidate)

  return <WorkspaceNav items={batchNavItems(candidate, { mounted, isAdmin })} />
}
