"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState, type FormEvent } from "react"

import { AuthCard } from "@/components/auth-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import {
  signUpWithRegistrationCode,
  verifyRegistrationCode,
} from "@/lib/auth-client"

const steps = [
  {
    title: "Registration code",
    description: "Sign-up is invite-only. Enter the code you received.",
  },
  {
    title: "Your account",
    description: "Tell us who you are and choose your sign-in details.",
  },
  {
    title: "Your profile",
    description: "Optionally add the chair or association you belong to.",
  },
] as const

type Step = 1 | 2 | 3

type Draft = {
  loginCode: string
  firstName: string
  lastName: string
  email: string
  password: string
  association: string
  title: string
}

type Notice = {
  title: string
  message: string
}

const emptyDraft: Draft = {
  loginCode: "",
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  association: "",
  title: "",
}

function readAccountValues(data: FormData) {
  return {
    firstName: String(data.get("firstName") ?? "").trim(),
    lastName: String(data.get("lastName") ?? "").trim(),
    email: String(data.get("email") ?? "").trim(),
    password: String(data.get("password") ?? ""),
  }
}

function readProfileValues(data: FormData) {
  return {
    association: String(data.get("association") ?? "").trim(),
    title: String(data.get("title") ?? "").trim(),
  }
}

export function SignUpForm() {
  const router = useRouter()
  const accountFormRef = useRef<HTMLFormElement>(null)
  const profileFormRef = useRef<HTMLFormElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState(false)

  const currentStep = steps[step - 1]

  function goTo(nextStep: Step) {
    setCodeError(null)
    setNotice(null)
    setStep(nextStep)
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCodeError(null)
    setPending(true)

    const code = String(
      new FormData(event.currentTarget).get("loginCode") ?? ""
    ).trim()

    try {
      await verifyRegistrationCode(code)
      setDraft((current) => ({ ...current, loginCode: code }))
      goTo(2)
    } catch (cause) {
      setCodeError(
        cause instanceof Error
          ? cause.message
          : "Could not verify the registration code"
      )
    } finally {
      setPending(false)
    }
  }

  function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const values = readAccountValues(new FormData(event.currentTarget))

    if (!values.firstName || !values.lastName) {
      setNotice({
        title: "Name required",
        message: "Please enter both your first and last name.",
      })
      return
    }

    setDraft((current) => ({ ...current, ...values }))
    goTo(3)
  }

  function handleAccountBack() {
    if (accountFormRef.current) {
      const values = readAccountValues(new FormData(accountFormRef.current))

      setDraft((current) => ({ ...current, ...values }))
    }

    goTo(1)
  }

  function handleProfileBack() {
    if (profileFormRef.current) {
      const values = readProfileValues(new FormData(profileFormRef.current))

      setDraft((current) => ({ ...current, ...values }))
    }

    goTo(2)
  }

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)
    setPending(true)

    const data = new FormData(event.currentTarget)
    const { association, title } = readProfileValues(data)

    try {
      await signUpWithRegistrationCode({
        name: `${draft.firstName} ${draft.lastName}`.trim(),
        email: draft.email,
        password: draft.password,
        loginCode: draft.loginCode,
        association: association || undefined,
        title: title || undefined,
      })

      router.push("/dashboard")
      router.refresh()
    } catch (cause) {
      setNotice({
        title: "Registration failed",
        message: cause instanceof Error ? cause.message : "Registration failed",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard
      className="max-w-md"
      title="Create an account"
      description={currentStep.description}
      footer={
        <>
          <span className="text-muted-foreground">Already registered?</span>
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{currentStep.title}</p>
            <p className="text-xs text-muted-foreground">
              Step {step} of {steps.length}
            </p>
          </div>
          <Progress
            value={(step / steps.length) * 100}
            aria-label={`Sign-up progress: step ${step} of ${steps.length}`}
          />
        </div>

        {notice ? (
          <Alert variant="destructive">
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        ) : null}

        {step === 1 ? (
          <form
            key="code"
            className="flex flex-col gap-4"
            onSubmit={handleCodeSubmit}
          >
            <FieldGroup>
              <Field data-invalid={codeError ? true : undefined}>
                <FieldLabel htmlFor="loginCode">Registration code</FieldLabel>
                <Input
                  id="loginCode"
                  name="loginCode"
                  autoComplete="one-time-code"
                  defaultValue={draft.loginCode}
                  aria-invalid={codeError ? true : undefined}
                  aria-describedby={
                    codeError
                      ? "loginCode-description loginCode-error"
                      : "loginCode-description"
                  }
                  autoFocus
                  required
                />
                <FieldDescription id="loginCode-description">
                  Ask the operator for an invite code.
                </FieldDescription>
                <FieldError id="loginCode-error">{codeError}</FieldError>
              </Field>
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Continue
              </Button>
            </FieldGroup>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            key="account"
            ref={accountFormRef}
            className="flex flex-col gap-4"
            onSubmit={handleAccountSubmit}
          >
            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="firstName">First name</FieldLabel>
                  <Input
                    id="firstName"
                    name="firstName"
                    autoComplete="given-name"
                    defaultValue={draft.firstName}
                    autoFocus
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lastName">Last name</FieldLabel>
                  <Input
                    id="lastName"
                    name="lastName"
                    autoComplete="family-name"
                    defaultValue={draft.lastName}
                    required
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={draft.email}
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
                  defaultValue={draft.password}
                  required
                />
                <FieldDescription>Use at least 8 characters.</FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={handleAccountBack}
                >
                  Back
                </Button>
                <Button type="submit" className="flex-1">
                  Continue
                </Button>
              </div>
            </FieldGroup>
          </form>
        ) : null}

        {step === 3 ? (
          <form
            key="profile"
            ref={profileFormRef}
            className="flex flex-col gap-4"
            onSubmit={handleProfileSubmit}
          >
            <FieldGroup>
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">
                  {draft.firstName} {draft.lastName}
                </p>
                <p className="text-muted-foreground">{draft.email}</p>
              </div>
              <Field>
                <FieldLabel htmlFor="association">Association</FieldLabel>
                <Input
                  id="association"
                  name="association"
                  autoComplete="organization"
                  placeholder="e.g. Chair of Software Engineering"
                  defaultValue={draft.association}
                  autoFocus
                />
                <FieldDescription>
                  Optional. Your chair, group, or affiliation.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="title">Title</FieldLabel>
                <Input
                  id="title"
                  name="title"
                  list="title-options"
                  placeholder="e.g. M.Sc."
                  defaultValue={draft.title}
                />
                <datalist id="title-options">
                  <option value="B.Sc." />
                  <option value="M.Sc." />
                  <option value="PhD" />
                  <option value="Professor" />
                </datalist>
                <FieldDescription>
                  Optional. Your academic title.
                </FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={handleProfileBack}
                  disabled={pending}
                >
                  Back
                </Button>
                <Button type="submit" className="flex-1" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  Create account
                </Button>
              </div>
            </FieldGroup>
          </form>
        ) : null}
      </div>
    </AuthCard>
  )
}
