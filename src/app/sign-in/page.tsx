import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { getSession } from "@/lib/session"
import {
  pageMetadata,
  SITE_DESCRIPTION,
  SITE_INVITE,
} from "@/lib/site-metadata"

import { SignInForm } from "./sign-in-form"

export const metadata: Metadata = pageMetadata({
  title: "Sign in",
  previewTitle: SITE_INVITE,
  description: SITE_DESCRIPTION,
  path: "/sign-in",
})

export default async function SignInPage() {
  const session = await getSession()

  if (session) {
    redirect("/dashboard")
  }

  return <SignInForm />
}
