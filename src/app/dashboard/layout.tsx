import { redirect } from "next/navigation"

import { SignOutButton } from "@/components/sign-out-button"
import { getSession } from "@/lib/session"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await getSession()

  if (!session) {
    redirect("/sign-in")
  }

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              review-pls
            </p>
            <p className="truncate text-sm font-medium">{session.user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        {children}
      </main>
    </div>
  )
}
