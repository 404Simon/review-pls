import { redirect } from "next/navigation"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSession } from "@/lib/session"

function formatDetail(value: string | null | undefined) {
  const trimmed = value?.trim()

  return trimmed && trimmed !== "none" ? trimmed : "Not set"
}

export default async function DashboardPage() {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  const { user } = session
  const firstName = user.name.trim().split(/\s+/)[0] || user.email

  const details = [
    { label: "Name", value: user.name },
    { label: "Email", value: user.email },
    { label: "Association", value: user.association },
    { label: "Title", value: user.title },
  ]

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your review-pls account at a glance.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            The details you gave when you registered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            {details.map((detail) => (
              <div key={detail.label} className="flex flex-col gap-1">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {detail.label}
                </dt>
                <dd className="truncate text-sm">
                  {formatDetail(detail.value)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  )
}
