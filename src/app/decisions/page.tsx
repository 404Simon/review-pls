import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { UserDecisionLogPanel } from "@/components/review/user-decision-log-panel"
import { getSession } from "@/lib/session"
import { pageMetadata } from "@/lib/site-metadata"

export const metadata: Metadata = pageMetadata({
  title: "My decisions",
  description:
    "Every draft, closed decision and unsure marker you saved in the selected batch.",
  path: "/decisions",
})

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DecisionsPage({ searchParams }: PageProps) {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium text-balance">
          Your decisions
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every draft, closed decision and unsure marker you saved, newest
          first.
        </p>
      </header>

      <UserDecisionLogPanel
        userId={session.user.id}
        basePath="/decisions"
        searchParams={await searchParams}
        emptyDescription="No draft, closed decision or unsure marker is saved for this batch yet. Open an item from the dashboard to make one."
      />
    </div>
  )
}
