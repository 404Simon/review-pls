import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth-card"
import { db } from "@/db"
import { isRegistrationOpen } from "@/lib/registration"
import { getSession } from "@/lib/session"
import {
  pageMetadata,
  SITE_DESCRIPTION,
  SITE_INVITE,
} from "@/lib/site-metadata"

import { SignUpForm } from "./sign-up-form"

export const metadata: Metadata = pageMetadata({
  title: "Create an account",
  previewTitle: SITE_INVITE,
  description: SITE_DESCRIPTION,
  path: "/sign-up",
})

export default async function SignUpPage() {
  const session = await getSession()

  if (session) {
    redirect("/dashboard")
  }

  if (!isRegistrationOpen(db)) {
    return (
      <AuthCard
        title="Registration is closed"
        description="New accounts are disabled right now."
        footer={
          <>
            <span className="text-muted-foreground">Already registered?</span>
            <Link href="/sign-in" className="underline underline-offset-4">
              Sign in
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            An administrator has closed registration. Existing accounts can
            still sign in and review.
          </p>
          <p>Ask an administrator to reopen registration if you need access.</p>
        </div>
      </AuthCard>
    )
  }

  return <SignUpForm />
}
