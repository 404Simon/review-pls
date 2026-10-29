"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { AuthCard } from "@/components/auth-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { signUpWithRegistrationCode } from "@/lib/auth-client"

export function SignUpForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    const formData = new FormData(event.currentTarget)
    const association = String(formData.get("association") ?? "").trim()
    const title = String(formData.get("title") ?? "").trim()

    try {
      await signUpWithRegistrationCode({
        name: String(formData.get("name") ?? "").trim(),
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
        loginCode: String(formData.get("loginCode") ?? ""),
        association: association || undefined,
        title: title || undefined,
      })

      router.push("/dashboard")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Create an account"
      description="Enter your details and the registration code."
      footer={
        <>
          <span className="text-muted-foreground">Already registered?</span>
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Registration failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="association">Association</FieldLabel>
            <Input
              id="association"
              name="association"
              placeholder="e.g. Chair of Software Engineering"
              aria-describedby="association-description"
            />
            <FieldDescription id="association-description">
              Optional. Leave blank for none.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="title">Title</FieldLabel>
            <Input
              id="title"
              name="title"
              list="title-options"
              placeholder="e.g. M.Sc."
              aria-describedby="title-description"
            />
            <datalist id="title-options">
              <option value="B.Sc." />
              <option value="M.Sc." />
              <option value="PhD" />
              <option value="Professor" />
            </datalist>
            <FieldDescription id="title-description">
              Optional. Enter your academic title, or leave blank for none.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="loginCode">Registration code</FieldLabel>
            <Input
              id="loginCode"
              name="loginCode"
              autoComplete="one-time-code"
              aria-describedby="loginCode-description"
            />
            <FieldDescription id="loginCode-description">
              Sign-up is invite-only. Ask the operator for the code.
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Create account
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  )
}
