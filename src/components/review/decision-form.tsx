"use client"

import {
  Check,
  FileCheck2,
  PencilLine,
  Save,
  ShieldQuestion,
  StickyNote,
  TriangleAlert,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { LinkPicker, type LinkCandidate } from "@/components/review/link-picker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { discardDraftAction, saveDecisionAction } from "@/lib/review/actions"
import type { DecisionView } from "@/lib/review/decisions"
import { formatTimestamp } from "@/lib/review/format"
import {
  decisionSchemasByKind,
  draftDecisionSchema,
  MAX_DECISION_NOTE_LENGTH,
  type ReviewItem,
  type Severity,
} from "@/lib/review/types"

const STRENGTHS = ["exact", "strong", "weak"] as const
const COVERAGES = [
  "equivalent",
  "agent_broader",
  "auditowl_broader",
  "partial",
] as const
const CLUSTER_VERIFICATIONS = [
  "confirmed",
  "partly_confirmed",
  "refuted",
  "not_checked",
] as const
const ASSESSMENTS = [
  "confirmed_valid",
  "partly_valid",
  "invalid",
  "not_checked",
] as const
const NOVELTIES = [
  "genuine_addition",
  "variant_of_auditowl",
  "out_of_scope",
  "invalid",
] as const

type StrengthValue = (typeof STRENGTHS)[number]
type CoverageValue = (typeof COVERAGES)[number]
type VerificationValue = (typeof CLUSTER_VERIFICATIONS)[number]
type AssessmentValue = (typeof ASSESSMENTS)[number]
type NoveltyValue = (typeof NOVELTIES)[number]

interface FormState {
  verdict: string
  note: string
  adjustLabels: boolean
  strength: StrengthValue | ""
  coverage: CoverageValue | ""
  verification: VerificationValue | ""
  severity: Severity | ""
  novelty: NoveltyValue | ""
  assessment: AssessmentValue
  linkRef: string
}

interface VerdictOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

function oneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[]
): T | "" {
  return value !== null && value !== undefined && allowed.includes(value as T)
    ? (value as T)
    : ""
}

function humanize(value: string): string {
  return value.replace(/_/g, " ")
}

function verdictOptions(item: ReviewItem): VerdictOption[] {
  switch (item.kind) {
    case "cluster":
      return [
        {
          value: "same_defect",
          label: "Same defect",
          hint: "The two findings describe the same defect.",
        },
        {
          value: "not_a_match",
          label: "Not a match",
          hint: "The findings are unrelated; a note is required.",
        },
        { value: "unsure", label: "Unsure", hint: "Return it to the pool." },
      ]
    case "agent_only":
      return [
        { value: "confirmed_valid", label: "Confirmed valid" },
        { value: "partly_valid", label: "Partly valid" },
        { value: "invalid", label: "Invalid" },
        {
          value: "not_checked",
          label: "Not checked",
          hint:
            item.severity === "low"
              ? "Allowed for low-severity findings."
              : "Only low-severity findings may be left not checked.",
          disabled: item.severity !== "low",
        },
        { value: "unsure", label: "Unsure", hint: "Return it to the pool." },
      ]
    case "auditowl_only":
      return [
        {
          value: "agent_missed",
          label: "Agent missed it",
          hint: "A genuine miss by the review agent.",
        },
        { value: "scope_difference", label: "Scope difference" },
        { value: "revision_difference", label: "Revision difference" },
        {
          value: "invalid_original_finding",
          label: "Invalid original finding",
        },
        {
          value: "unclear",
          label: "Unclear",
          hint: "A final cannot-decide classification.",
        },
        { value: "unsure", label: "Unsure", hint: "Return it to the pool." },
      ]
    case "related":
      return [
        {
          value: "agree_not_matched",
          label: "Agree: not matched",
          hint: "The comparator was right to keep them apart.",
        },
        {
          value: "same_defect",
          label: "Same defect",
          hint: "This pair should have been a cluster.",
        },
        { value: "unsure", label: "Unsure", hint: "Return it to the pool." },
      ]
  }
}

function defaultAssessment(item: ReviewItem): AssessmentValue {
  const proposed = oneOf(item.comparator.proposedAssessment, ASSESSMENTS)
  return proposed === "" ? "confirmed_valid" : proposed
}

function defaultForm(item: ReviewItem): FormState {
  const strength = oneOf(item.comparator.strength, STRENGTHS)
  const coverage = oneOf(item.comparator.coverage, COVERAGES)
  const verification = oneOf(
    item.comparator.verification?.status,
    CLUSTER_VERIFICATIONS
  )
  const completeProposal =
    strength !== "" && coverage !== "" && verification !== ""
  const verdict =
    item.kind === "cluster"
      ? "same_defect"
      : item.kind === "agent_only"
        ? oneOf(item.comparator.proposedAssessment, [
            "confirmed_valid",
            "partly_valid",
            "invalid",
            "unsure",
          ] as const) || "confirmed_valid"
        : item.kind === "related"
          ? "agree_not_matched"
          : "agent_missed"

  return {
    verdict,
    note: "",
    adjustLabels: !completeProposal,
    strength: strength === "" ? "" : strength,
    coverage: coverage === "" ? "" : coverage,
    verification: verification === "" ? "" : verification,
    severity: "",
    novelty: "",
    assessment: defaultAssessment(item),
    linkRef: "",
  }
}

function formFromDraft(
  item: ReviewItem,
  draft: DecisionView | null
): FormState {
  const initial = defaultForm(item)
  if (!draft) {
    return initial
  }
  // Drafts are permissive, so restore them with the draft schema rather than
  // dropping a half-finished autosave because a final-only rule is missing.
  const parsed = draftDecisionSchema.safeParse(draft.record.payload)
  if (!parsed.success) {
    return initial
  }
  const decision = parsed.data
  if (
    !verdictOptions(item).some((option) => option.value === decision.verdict)
  ) {
    return initial
  }
  return {
    ...initial,
    verdict: decision.verdict,
    note: decision.note,
    adjustLabels: decision.acceptedAsProposed !== true,
    strength:
      oneOf(decision.strength, STRENGTHS) === ""
        ? initial.strength
        : oneOf(decision.strength, STRENGTHS),
    coverage:
      oneOf(decision.coverage, COVERAGES) === ""
        ? initial.coverage
        : oneOf(decision.coverage, COVERAGES),
    verification:
      oneOf(decision.verification, CLUSTER_VERIFICATIONS) === ""
        ? initial.verification
        : oneOf(decision.verification, CLUSTER_VERIFICATIONS),
    severity: decision.severity ?? "",
    novelty: oneOf(decision.novelty, NOVELTIES),
    assessment: oneOf(decision.assessment, ASSESSMENTS) || initial.assessment,
    linkRef: decision.proposedLink?.ref ?? "",
  }
}

interface PayloadResult {
  ok: true
  status: "closed" | "unsure"
  payload: unknown
}

interface PayloadError {
  ok: false
  error: string
}

function buildCandidate(
  item: ReviewItem,
  form: FormState,
  forcedVerdict?: string
): Record<string, unknown> {
  const verdict = forcedVerdict ?? form.verdict
  if (verdict === "unsure") {
    return {
      ...(item.kind === "auditowl_only" ? { assessment: form.assessment } : {}),
      verdict,
      note: form.note.trim(),
    }
  }

  if (item.kind === "cluster") {
    const candidate: Record<string, unknown> = {
      verdict,
      note: form.note.trim(),
    }
    if (verdict === "same_defect") {
      if (form.adjustLabels) {
        if (form.strength !== "") {
          candidate.strength = form.strength
        }
        if (form.coverage !== "") {
          candidate.coverage = form.coverage
        }
        if (form.verification !== "") {
          candidate.verification = form.verification
        }
      } else {
        candidate.acceptedAsProposed = true
        const strength = oneOf(item.comparator.strength, STRENGTHS)
        const coverage = oneOf(item.comparator.coverage, COVERAGES)
        const verification = oneOf(
          item.comparator.verification?.status,
          CLUSTER_VERIFICATIONS
        )
        if (strength !== "") {
          candidate.strength = strength
        }
        if (coverage !== "") {
          candidate.coverage = coverage
        }
        if (verification !== "") {
          candidate.verification = verification
        }
      }
    }
    return candidate
  }

  if (item.kind === "agent_only") {
    const candidate: Record<string, unknown> = {
      verdict,
      note: form.note.trim(),
    }
    if (form.severity !== "") {
      candidate.severity = form.severity
    }
    if (form.novelty !== "") {
      candidate.novelty = form.novelty
    }
    if (form.linkRef !== "") {
      candidate.proposedLink = { kind: "auditowl_only", ref: form.linkRef }
    }
    return candidate
  }

  if (item.kind === "auditowl_only") {
    const candidate: Record<string, unknown> = {
      verdict,
      assessment: form.assessment,
      note: form.note.trim(),
    }
    if (form.linkRef !== "") {
      candidate.proposedLink = { kind: "agent_only", ref: form.linkRef }
    }
    return candidate
  }

  return { verdict, note: form.note.trim() }
}

function buildPayload(
  item: ReviewItem,
  form: FormState,
  forcedVerdict?: string
): PayloadResult | PayloadError {
  const verdict = forcedVerdict ?? form.verdict
  if (
    item.kind === "agent_only" &&
    verdict === "not_checked" &&
    item.severity !== "low"
  ) {
    return {
      ok: false,
      error: "not_checked is only allowed for low-severity findings.",
    }
  }
  return parseCandidate(item, buildCandidate(item, form, forcedVerdict))
}

function buildDraftPayload(
  item: ReviewItem,
  form: FormState,
  forcedVerdict?: string
): PayloadResult | PayloadError {
  const parsed = draftDecisionSchema.safeParse(
    buildCandidate(item, form, forcedVerdict)
  )
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "The draft is not valid.",
    }
  }
  return {
    ok: true,
    status: parsed.data.verdict === "unsure" ? "unsure" : "closed",
    payload: parsed.data,
  }
}

function parseCandidate(
  item: ReviewItem,
  candidate: Record<string, unknown>
): PayloadResult | PayloadError {
  const parsed = decisionSchemasByKind[item.kind].safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "The decision is incomplete.",
    }
  }
  const verdict = typeof candidate.verdict === "string" ? candidate.verdict : ""
  return {
    ok: true,
    status: verdict === "unsure" ? "unsure" : "closed",
    payload: parsed.data,
  }
}

function noteErrorFrom(message: string): string | null {
  return /note/i.test(message) ? message : null
}

const SELECT_CLASS = "w-full"

/** Item-page shortcuts drive the form through this imperative handle. */
export interface DecisionFormActions {
  chooseVerdict(index: number): boolean
  save(): void
  markUnsure(): void
  /** Persist pending edits before a keyboard/button navigation. */
  flushDraft(): Promise<void>
  /** True while the form has unsaved edits or a draft write in flight. */
  hasPendingChanges(): boolean
  /**
   * Stop autosave and wait for any in-flight draft write. The form stays
   * read-only until `resumeAutosave` or a server refresh unlocks it again.
   */
  suspendAutosave(): Promise<void>
  /** Re-enable the form after a release/reopen attempt failed. */
  resumeAutosave(): void
}

export interface DecisionFormProps {
  item: ReviewItem
  batchId: string
  draft: DecisionView | null
  canEdit: boolean
  nextHref: string | null
  returnHref: string
  linkCandidates: readonly LinkCandidate[]
  actionRef?: RefObject<DecisionFormActions | null>
}

export function DecisionForm({
  item,
  batchId,
  draft,
  canEdit,
  nextHref,
  returnHref,
  linkCandidates,
  actionRef,
}: DecisionFormProps) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(() => formFromDraft(item, draft))
  const [finalPending, setFinalPending] = useState(false)
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saved" | "error"
  >(draft ? "saved" : "idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [noteError, setNoteError] = useState<string | null>(null)
  const [discardPending, setDiscardPending] = useState(false)
  const [suspended, setSuspended] = useState(false)
  const [suspendedDraftId, setSuspendedDraftId] = useState<string | null>(null)
  const [savedSignature, setSavedSignature] = useState(() =>
    JSON.stringify(form)
  )
  const initialised = useRef(false)
  const finalising = useRef(false)
  const finalised = useRef(false)
  const suspendedRef = useRef(false)
  const autosaveTimer = useRef<number | null>(null)
  const draftSave = useRef<Promise<boolean> | null>(null)

  const options = verdictOptions(item)
  const signature = JSON.stringify(form)
  const dirty = signature !== savedSignature
  // A discard lock ends as soon as the server reports that the draft is gone.
  // A release lock lasts until the claim state changes and remounts the form.
  const suspendedForDraft =
    suspended &&
    (suspendedDraftId === null ||
      suspendedDraftId === (draft?.record.id ?? null))
  const proposedStrength = oneOf(item.comparator.strength, STRENGTHS)
  const proposedCoverage = oneOf(item.comparator.coverage, COVERAGES)
  const proposedVerification = oneOf(
    item.comparator.verification?.status,
    CLUSTER_VERIFICATIONS
  )
  const completeProposal =
    proposedStrength !== "" &&
    proposedCoverage !== "" &&
    proposedVerification !== ""

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
    }
  }, [])

  const persistDraft = useCallback(
    async (payload: unknown, expectedSignature: string): Promise<boolean> => {
      // A final save always wins. Never let a late autosave turn a just-saved
      // unsure/closed decision back into a draft, and never let it re-claim a
      // released item or recreate a discarded draft.
      if (finalising.current || finalised.current || suspendedRef.current) {
        return false
      }
      if (draftSave.current) {
        await draftSave.current
      }
      if (finalising.current || finalised.current || suspendedRef.current) {
        return false
      }

      setSaveState("pending")
      setSaveError(null)
      const task = (async () => {
        try {
          const response = await saveDecisionAction({
            batchId,
            paperId: item.paperId,
            itemKind: item.kind,
            itemRef: item.ref,
            status: "draft",
            payload,
          })
          if (!response.ok) {
            setSaveState("error")
            setSaveError(response.message)
            if (response.code !== "invalid_input") {
              toast.error(response.message)
              router.refresh()
            }
            return false
          }
          setSavedSignature(expectedSignature)
          setSaveState("saved")
          setNoteError(null)
          router.refresh()
          return true
        } catch {
          setSaveState("error")
          setSaveError("The draft could not be saved.")
          toast.error("The draft could not be saved. Reload and try again.")
          return false
        }
      })()
      draftSave.current = task
      const saved = await task
      if (draftSave.current === task) {
        draftSave.current = null
      }
      return saved
    },
    [batchId, item.kind, item.paperId, item.ref, router]
  )

  const suspendAutosave = useCallback(async () => {
    suspendedRef.current = true
    setSuspendedDraftId(draft?.record.id ?? null)
    setSuspended(true)
    clearAutosaveTimer()
    if (draftSave.current) {
      // Wait for the write that is already on the wire. Releasing or
      // discarding after it means the late response can no longer win.
      await draftSave.current
    }
  }, [clearAutosaveTimer, draft?.record.id])

  const resumeAutosave = useCallback(() => {
    suspendedRef.current = false
    setSuspendedDraftId(null)
    setSuspended(false)
  }, [])

  const commit = useCallback(
    async (
      mode: "closed" | "unsure" | "draft",
      options: {
        forcedVerdict?: string
        destination?: "next" | "return"
      } = {}
    ): Promise<boolean> => {
      // A release or discard owns the item until its request settles. A
      // keyboard/button save must not write a decision behind it.
      if (suspendedRef.current) {
        return false
      }
      const { forcedVerdict, destination = "next" } = options
      const current = forcedVerdict ? { ...form, verdict: forcedVerdict } : form
      const currentSignature = JSON.stringify(current)

      if (mode === "draft") {
        const draft = buildDraftPayload(item, current, forcedVerdict)
        if (!draft.ok) {
          setSaveState("error")
          setSaveError(draft.error)
          return false
        }
        return persistDraft(draft.payload, currentSignature)
      }

      const result = buildPayload(item, current, forcedVerdict)
      if (!result.ok) {
        // PLAN §10.4: `s` on an incomplete form still saves a draft.
        if (mode === "closed") {
          const draft = buildDraftPayload(item, current, forcedVerdict)
          if (draft.ok) {
            const saved = await persistDraft(draft.payload, currentSignature)
            if (saved) {
              const message = noteErrorFrom(result.error)
              setNoteError(message)
              toast.message("Draft saved", {
                description: `${result.error} Finish the form to close the item.`,
              })
            }
            return false
          }
        }
        setNoteError(noteErrorFrom(result.error))
        toast.error(result.error)
        return false
      }

      finalising.current = true
      setFinalPending(true)
      setNoteError(null)
      try {
        // Serialise behind an in-flight autosave so the final decision is the
        // last write to the row.
        if (draftSave.current) {
          await draftSave.current
        }
        const response = await saveDecisionAction({
          batchId,
          paperId: item.paperId,
          itemKind: item.kind,
          itemRef: item.ref,
          status: result.status,
          payload: result.payload,
        })
        if (!response.ok) {
          finalising.current = false
          setNoteError(noteErrorFrom(response.message))
          toast.error(response.message)
          router.refresh()
          return false
        }
        finalised.current = true
        setSavedSignature(currentSignature)
        if (result.status === "unsure") {
          toast.success("Marked unsure. The item is back in the open pool.")
          router.push(returnHref)
          router.refresh()
          return true
        }
        toast.success("Decision saved. The item is closed.")
        router.push(
          destination === "return" ? returnHref : (nextHref ?? returnHref)
        )
        router.refresh()
        return true
      } catch {
        finalising.current = false
        toast.error("The decision could not be saved. Reload and try again.")
        router.refresh()
        return false
      } finally {
        setFinalPending(false)
      }
    },
    [batchId, form, item, nextHref, persistDraft, returnHref, router]
  )

  const flushDraft = useCallback(async () => {
    if (
      !canEdit ||
      finalising.current ||
      finalised.current ||
      suspendedRef.current
    ) {
      if (draftSave.current) {
        await draftSave.current
      }
      return
    }
    if (draftSave.current) {
      await draftSave.current
    }
    if (suspendedRef.current) {
      return
    }
    if (signature === savedSignature) {
      return
    }
    const draft = buildDraftPayload(item, form)
    if (draft.ok) {
      await persistDraft(draft.payload, signature)
    }
  }, [canEdit, form, item, persistDraft, savedSignature, signature])

  useEffect(() => {
    return () => {
      if (actionRef) {
        actionRef.current = null
      }
    }
  }, [actionRef])

  useImperativeHandle(
    actionRef,
    () => ({
      chooseVerdict(index: number): boolean {
        if (suspendedRef.current) {
          return false
        }
        const option = options[index]
        if (!option || option.disabled) {
          return false
        }
        update("verdict", option.value)
        setNoteError(null)
        return true
      },
      save() {
        if (suspendedRef.current) {
          return
        }
        void commit("closed")
      },
      markUnsure() {
        if (suspendedRef.current) {
          return
        }
        update("verdict", "unsure")
        setNoteError(null)
        void commit("unsure", { forcedVerdict: "unsure" })
      },
      flushDraft,
      hasPendingChanges() {
        return signature !== savedSignature || draftSave.current !== null
      },
      suspendAutosave,
      resumeAutosave,
    }),
    [
      commit,
      flushDraft,
      options,
      resumeAutosave,
      savedSignature,
      signature,
      suspendAutosave,
    ]
  )

  // Keep the imperative autosave guard in sync with the derived lock without
  // calling setState from an effect.
  useEffect(() => {
    suspendedRef.current = suspendedForDraft
  }, [suspendedForDraft])

  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      return
    }
    if (
      !canEdit ||
      suspendedForDraft ||
      finalPending ||
      finalising.current ||
      finalised.current
    ) {
      return
    }
    if (signature === savedSignature) {
      return
    }
    clearAutosaveTimer()
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null
      void commit("draft")
    }, 800)
    return clearAutosaveTimer
  }, [
    signature,
    canEdit,
    suspendedForDraft,
    finalPending,
    commit,
    savedSignature,
    clearAutosaveTimer,
  ])

  const discardDraft = useCallback(async () => {
    if (
      !canEdit ||
      finalising.current ||
      finalised.current ||
      suspendedRef.current
    ) {
      return
    }
    setDiscardPending(true)
    await suspendAutosave()
    try {
      const response = await discardDraftAction({
        batchId,
        paperId: item.paperId,
        itemKind: item.kind,
        itemRef: item.ref,
      })
      if (!response.ok) {
        resumeAutosave()
        toast.error(response.message)
        return
      }
      const reset = defaultForm(item)
      setForm(reset)
      setSavedSignature(JSON.stringify(reset))
      setSaveState("idle")
      setSaveError(null)
      setNoteError(null)
      toast.success("Draft discarded.")
      router.refresh()
    } catch {
      resumeAutosave()
      toast.error("The draft could not be discarded. Reload and try again.")
    } finally {
      setDiscardPending(false)
    }
  }, [batchId, canEdit, item, resumeAutosave, router, suspendAutosave])

  if (!canEdit || suspendedForDraft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldQuestion data-icon="inline-start" />
            Your decision
          </CardTitle>
          <CardDescription>
            {suspendedForDraft
              ? "The claim or draft is being updated. Reload or reserve again to continue."
              : "Reserve this item to unlock the decision form."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <ShieldQuestion />
            <AlertTitle>Read-only for now</AlertTitle>
            <AlertDescription>
              You can read the evidence and the comparator while the item is
              open or reserved by someone else. Only the active claimant can
              save a decision.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const showLabels = item.kind === "cluster" && form.verdict === "same_defect"
  const noteRequired =
    form.verdict === "unsure" ||
    (item.kind === "cluster" && form.verdict === "not_a_match") ||
    (item.kind === "agent_only" && form.verdict === "not_checked")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PencilLine data-icon="inline-start" />
          Your decision
        </CardTitle>
        <CardDescription>
          The comparator is a hint. Record the verdict the evidence supports;
          drafts autosave after you pause.
        </CardDescription>
        <div
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {draft?.stale ? (
            <Badge variant="destructive">Draft source changed</Badge>
          ) : null}
          {saveState === "pending" ? (
            <span>Saving…</span>
          ) : saveState === "error" ? (
            <span className="flex items-center gap-1 text-destructive">
              <TriangleAlert data-icon="inline-start" />
              Not saved{saveError ? ` — ${saveError}` : ""}
            </span>
          ) : dirty ? (
            <span className="flex items-center gap-1 text-warning-foreground">
              <TriangleAlert data-icon="inline-start" />
              Unsaved changes
            </span>
          ) : saveState === "saved" ? (
            <span className="flex items-center gap-1 text-success">
              <Check data-icon="inline-start" />
              Saved
            </span>
          ) : (
            <span>No draft saved yet</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <FieldGroup>
          <Field>
            <FieldLabel>Verdict</FieldLabel>
            <ToggleGroup
              value={[form.verdict]}
              onValueChange={(values) => {
                const next = values[0]
                if (next) {
                  update("verdict", next)
                }
              }}
              className="flex flex-wrap"
              aria-label="Verdict"
            >
              {options.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  variant="outline"
                  disabled={option.disabled}
                  aria-label={option.label}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {options.find((option) => option.value === form.verdict)?.hint ??
                "Pick the verdict that matches the evidence."}
            </FieldDescription>
          </Field>

          {showLabels ? (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileCheck2 data-icon="inline-start" />
                  <span className="text-sm font-medium">Proposed labels</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={form.adjustLabels || !completeProposal}
                    disabled={!completeProposal}
                    onCheckedChange={(checked) =>
                      update("adjustLabels", checked === true)
                    }
                  />
                  Adjust labels
                </label>
              </div>

              {!form.adjustLabels ? (
                <dl className="grid gap-2 sm:grid-cols-3">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Strength</dt>
                    <dd className="text-sm">
                      {proposedStrength || "not proposed"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Coverage</dt>
                    <dd className="text-sm">
                      {proposedCoverage || "not proposed"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">
                      Verification
                    </dt>
                    <dd className="text-sm">
                      {proposedVerification || "not proposed"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <LabeledSelect
                    label="Strength"
                    value={form.strength}
                    onChange={(value) =>
                      update("strength", oneOf(value, STRENGTHS))
                    }
                    options={STRENGTHS}
                    emptyLabel="No value"
                  />
                  <LabeledSelect
                    label="Coverage"
                    value={form.coverage}
                    onChange={(value) =>
                      update("coverage", oneOf(value, COVERAGES))
                    }
                    options={COVERAGES}
                    emptyLabel="No value"
                  />
                  <LabeledSelect
                    label="Verification"
                    value={form.verification}
                    onChange={(value) =>
                      update(
                        "verification",
                        oneOf(value, CLUSTER_VERIFICATIONS)
                      )
                    }
                    options={CLUSTER_VERIFICATIONS}
                    emptyLabel="No value"
                  />
                </div>
              )}
              {!completeProposal ? (
                <p className="text-xs text-muted-foreground">
                  The comparator did not propose all three labels, so choose
                  them manually. Accepted-as-proposed only applies when they
                  stay unchanged.
                </p>
              ) : null}
            </div>
          ) : null}

          {item.kind === "agent_only" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledSelect
                label="Severity correction (optional)"
                value={form.severity}
                onChange={(value) =>
                  update(
                    "severity",
                    oneOf(value, ["high", "medium", "low"] as const)
                  )
                }
                options={["high", "medium", "low"] as const}
                emptyLabel="Keep proposed severity"
              />
              <LabeledSelect
                label="Novelty (optional)"
                value={form.novelty}
                onChange={(value) => update("novelty", oneOf(value, NOVELTIES))}
                options={NOVELTIES}
                emptyLabel="No novelty note"
              />
            </div>
          ) : null}

          {item.kind === "auditowl_only" ? (
            <div className="flex flex-col gap-1">
              <LabeledSelect
                label="Assessment of the original finding"
                value={form.assessment}
                onChange={(value) =>
                  update(
                    "assessment",
                    oneOf(value, ASSESSMENTS) || "confirmed_valid"
                  )
                }
                options={ASSESSMENTS}
                emptyLabel="Choose an assessment"
              />
              <p className="text-xs text-muted-foreground">
                This is your independent verdict on the AuditOwl finding, not
                the classification of why the agent missed it.
              </p>
            </div>
          ) : null}

          {item.kind === "agent_only" || item.kind === "auditowl_only" ? (
            <LinkPicker
              candidates={linkCandidates}
              value={form.linkRef}
              onChange={(ref) => update("linkRef", ref)}
              disabled={finalPending}
            />
          ) : null}

          <Field>
            <FieldLabel htmlFor="decision-note">
              Reviewer note
              {noteRequired ? <Badge variant="outline">required</Badge> : null}
            </FieldLabel>
            <Textarea
              id="decision-note"
              value={form.note}
              maxLength={MAX_DECISION_NOTE_LENGTH}
              aria-invalid={noteError !== null}
              aria-describedby={
                noteError === null
                  ? "decision-note-help"
                  : "decision-note-help decision-note-error"
              }
              onChange={(event) => {
                update("note", event.target.value)
                setNoteError(null)
              }}
              placeholder="What did you check, and why does this verdict follow?"
              rows={4}
            />
            <FieldDescription id="decision-note-help">
              Keep it short but concrete: cite the line, check output or paper
              page that decided it. An unsure note is shown to the next
              reviewer. Up to {MAX_DECISION_NOTE_LENGTH.toLocaleString("en-US")}{" "}
              characters.
            </FieldDescription>
            {noteError ? (
              <FieldError id="decision-note-error">{noteError}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              void commit("closed", {
                destination:
                  nextHref && nextHref !== returnHref ? "next" : "return",
              })
            }
            disabled={finalPending}
          >
            {finalPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {nextHref && nextHref !== returnHref
              ? "Save & next"
              : "Save & close"}
          </Button>
          {nextHref && nextHref !== returnHref ? (
            <Button
              variant="outline"
              onClick={() => void commit("closed", { destination: "return" })}
              disabled={finalPending}
            >
              Save & close
            </Button>
          ) : null}
          <Button
            variant="secondary"
            aria-label="Mark unsure and release the claim"
            onClick={() => {
              update("verdict", "unsure")
              setNoteError(null)
              void commit("unsure", { forcedVerdict: "unsure" })
            }}
            disabled={finalPending}
          >
            <StickyNote data-icon="inline-start" />
            Mark unsure & release
          </Button>
          <Button
            variant="ghost"
            onClick={() => void commit("draft")}
            disabled={finalPending}
          >
            Save draft
          </Button>
          {draft ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="ghost" disabled={discardPending} />}
              >
                Discard draft
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The saved draft is deleted. Final and unsure history is not
                    affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={discardPending}
                    onClick={() => void discardDraft()}
                  >
                    Discard draft
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {item.kind === "cluster" ? (
              <>Shortcuts: 1–3 verdict · s save · u unsure</>
            ) : (
              <>Shortcuts: 1–5 verdict · s save · u unsure</>
            )}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Saving a final decision closes the item and releases your claim. Your
          last autosave was{" "}
          {draft ? formatTimestamp(draft.record.updatedAt) : "not yet saved"}.
        </p>
      </CardContent>
    </Card>
  )
}

function LabeledSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  label: string
  value: T | ""
  onChange: (value: string) => void
  options: readonly T[]
  emptyLabel: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={value === "" ? "none" : value}
        onValueChange={(next) => {
          if (typeof next === "string") {
            onChange(next === "none" ? "" : next)
          }
        }}
      >
        <SelectTrigger aria-label={label} className={SELECT_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{emptyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {humanize(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
