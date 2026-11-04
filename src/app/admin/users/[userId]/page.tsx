import { ArrowLeft, ShieldCheck, Snowflake, UserRound } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { UserDecisionLogPanel } from "@/components/review/user-decision-log-panel"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { db } from "@/db"
import { getUserRole, listUserRoles } from "@/lib/review/roles"
import { getSession } from "@/lib/session"
import { pageMetadata } from "@/lib/site-metadata"

interface PageProps {
  params: Promise<{ userId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: Pick<PageProps, "params">): Promise<Metadata> {
  const { userId } = await params
  const session = await getSession()

  if (!session) {
    return pageMetadata({ title: "User decisions", path: "/admin" })
  }

  const role = await getUserRole(session.user, { db })
  if (role !== "admin") {
    return pageMetadata({ title: "User decisions", path: "/admin" })
  }

  const user = listUserRoles(db).find((candidate) => candidate.id === userId)
  return pageMetadata({
    title: user ? `Decisions by ${user.name}` : "User decisions",
    description:
      "Admin view of one reviewer's drafts, closed decisions and unsure history.",
    path: `/admin/users/${encodeURIComponent(userId)}`,
  })
}

export default async function AdminUserDecisionsPage({
  params,
  searchParams,
}: PageProps) {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  const role = await getUserRole(session.user, { db })
  if (role !== "admin") {
    notFound()
  }

  const { userId } = await params
  const user = listUserRoles(db).find((candidate) => candidate.id === userId)
  if (!user) {
    notFound()
  }

  const rawParams = await searchParams
  const basePath = `/admin/users/${encodeURIComponent(user.id)}`

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href="/admin"
            className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft data-icon="inline-start" />
            Back to admin
          </Link>
          <h1 className="font-heading text-2xl font-medium text-balance">
            {user.name}
          </h1>
          <p className="max-w-3xl text-sm break-all text-muted-foreground">
            {user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={user.role === "admin" ? "default" : "outline"}>
            <ShieldCheck data-icon="inline-start" />
            {user.role}
          </Badge>
          {user.frozenAt ? (
            <Badge variant="destructive">
              <Snowflake data-icon="inline-start" />
              Frozen
            </Badge>
          ) : (
            <Badge variant="outline">
              <UserRound data-icon="inline-start" />
              Active
            </Badge>
          )}
        </div>
      </header>

      <UserDecisionLogPanel
        userId={user.id}
        basePath={basePath}
        searchParams={rawParams}
        emptyTitle={`${user.name} has no decisions in this batch`}
        emptyDescription="No draft, closed decision or unsure marker has been saved by this reviewer in the selected batch."
      />

      <div>
        <Link
          href="/admin"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to admin
        </Link>
      </div>
    </div>
  )
}
