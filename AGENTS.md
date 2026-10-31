<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# review-pls — agent guide

## Engineering standards

- Write **clean, maintainable, secure code**. Prefer the root-cause fix over workarounds.
- Keep changes small, typed, and consistent with the surrounding code. No `any`, dead code, or duplicated logic.
- Validate at the server boundary. Client-side validation is UX only, never a security control.
- Never weaken auth: do not disable CSRF, origin checks, rate limiting, or secret checks to make a test pass.
- Do not commit secrets, `.env` files, local databases, or generated test artifacts.
- Ask before destructive changes (dropping data, rewriting applied migrations, deleting user work).
- Run the relevant checks before finishing: `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e`, and `pnpm build` for user-facing changes.

## Stack

- Next.js 16 App Router, React 19, TypeScript strict mode.
- Tailwind CSS v4 with shadcn/ui (`base-nova` style, **Base UI**, not Radix).
- Better Auth 1.7.x with the Drizzle adapter.
- Drizzle ORM + `better-sqlite3` (SQLite).
- Playwright for end-to-end tests.

## Repository layout

- `src/app/` — App Router pages, layouts, and route handlers. This is the active app directory; **do not create a root `app/`**, because it would shadow `src/app`.
- `src/app/api/auth/[...all]/route.ts` — Better Auth handler.
- `src/app/sign-up/`, `src/app/sign-in/` — auth pages.
- `src/components/ui/` — shadcn-generated primitives. Prefer adding/updating via the CLI instead of hand-writing.
- `src/components/auth-card.tsx` — shared auth page shell.
- `src/lib/auth.ts` — server auth config, registration-code hook, user fields.
- `src/lib/auth-client.ts` — auth client, additional-field inference, custom sign-up request.
- `src/db/index.ts` — Drizzle client; schema is passed here so the adapter can resolve tables.
- `src/db/auth-schema.ts` — **generated** by the Better Auth CLI. Do not hand-edit.
- `src/db/review-schema.ts` — reviewer roles, item claims, the mutable review
  decision row and the append-only `review_decision_event` history.
- `drizzle/` — version-controlled migrations and snapshots.
- `drizzle.config.ts` — Drizzle Kit config.
- `e2e/` — Playwright tests and test-database preparation.
- `playwright.config.ts` — isolated E2E server on port `3100`.

## Commands

```bash
pnpm dev                 # Next dev server on :3000
pnpm build               # production build
pnpm start               # run production build
pnpm lint                # ESLint
pnpm typecheck           # tsc --noEmit
pnpm format              # Prettier (no semicolons, double quotes)

pnpm test                # Vitest unit and database tests
pnpm test:e2e            # Playwright, isolated DB + isolated dist dir
pnpm test:e2e:ui         # Playwright UI mode

pnpm review-data:prepare # build a review-data batch from the analysis repos
pnpm review-data:check   # verify the Phase 1 data contract and counts
pnpm review:admin:sync --list        # list registered ADMIN_EMAILS candidates
pnpm review:admin:sync --user-id <id> # promote one confirmed candidate
pnpm review:export --batch <id> --type dataset|decisions|both --out ./exports
                         # write schema-versioned review exports (also /admin)

pnpm auth:generate       # regenerate src/db/auth-schema.ts from src/lib/auth.ts
pnpm db:generate         # generate a new Drizzle migration
pnpm db:migrate          # apply migrations to DATABASE_URL
pnpm db:push             # push schema in development (no migration file)
pnpm db:studio           # Drizzle Studio
```

## Auth and user data

- Auth config lives in `src/lib/auth.ts`. Client inference is enabled in `src/lib/auth-client.ts` with `inferAdditionalFields<typeof auth>()`.
- Registration is **invite-only**: the server-side `hooks.before` checks `loginCode` against `REGISTRATION_CODE`. This check must stay on the server. Missing `REGISTRATION_CODE` fails closed (all registrations rejected).
- User profile fields:
  - `association` — free text, optional, default `"none"` (e.g. a chair).
  - `title` — free text, optional, default `"none"` (e.g. `M.Sc.`, `PhD`).
- These are intentionally free text, not enums, so new chairs/titles do not require migrations. If they become controlled vocabularies, normalize them deliberately.
- If a field must not be user-editable, set `input: false` in `user.additionalFields`.
- The Drizzle adapter requires the schema object. `src/db/index.ts` must keep `drizzle(sqlite, { schema })`; otherwise Better Auth cannot resolve models.
- Do **not** add `import "server-only"` inside `src/db/index.ts` or any module loaded by the Better Auth CLI. The CLI runs outside Next and cannot resolve it. If a server guard is needed, keep it outside the auth/CLI import graph.

### Changing the user schema

1. Edit `user.additionalFields` in `src/lib/auth.ts`.
2. Run `pnpm auth:generate` to update `src/db/auth-schema.ts`.
3. Run `pnpm db:generate` to create a new migration.
4. Run `pnpm db:migrate` (or `pnpm db:push` in development).
5. Update `src/lib/auth-client.ts` input types if the sign-up flow changes.
6. Add/extend Playwright coverage, then run `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e`.

The repo has the auth migration, the review-core migration, the claim-expiry
migration, the decision-event migration and the event backfill
(`0004_backfill_decision_events`). Do not squash or rewrite an applied migration
once it has been deployed or the database contains real data; add a new
migration instead. The backfill inserts an event for every pre-0003
`closed`/`unsure` row that has none; it is safe to re-run because it checks for
an existing matching event. Limitation: a pre-0004 closed/unsure decision that
was already reopened before `0004` is no longer in `review_decision`, so only
the `reopened` event remains and the original decision payload cannot be
recovered by the backfill.

`review_decision` is the current state per `(item, reviewer)`.
`review_decision_event` is append-only: insert an event in the same transaction
for every `closed`/`unsure` save and every admin reopen, never for draft
autosaves. Reads that show unsure history or exports must use the event table,
because a later draft can overwrite the mutable row.

Unsure semantics: an unsure save releases the claim and leaves the item open.
If the same reviewer re-claims and drafts later, the public status follows the
active claim again (`claimed`, then `open` after the lease expires) while the
unsure event stays in history. Stats and filters use that same derived status;
they do not count a resumed item as unsure.

Unknown batch/paper/item ids must render the `notFound()` boundary. Because
`loading.tsx` starts the response stream first, that boundary can arrive as HTTP
200 with the correct not-found body; the boundary is what matters. `DataErrorState`
is only for corrupt mounted data; it shows a generic reviewer message and keeps
absolute paths, hashes and loader details in an admin-only block.

## Admin, exports and data health

- `/admin` is admin-only (`notFound()` for reviewers) and is linked from the
  shell only for admins. It owns data health, roles, active claims, the unsure
  queue, statistics, exports and the review-data cache reload action.
- `src/lib/review/export.ts` holds the pure, zod-validated dataset and
  decisions-only builders. `src/lib/review/export-data.ts` is the only
  export module that touches the mount and database. The dataset keeps every
  decision row (including drafts), claims and the append-only event history;
  decisions-only takes final closed rows plus the unsure event history and must
  never contain a draft.
- `scripts/export-reviews.ts` (`pnpm review:export`) writes
  `exports/<batch>/review-dataset-<timestamp>.json` and
  `decisions-<timestamp>.json`. Existing files at the same timestamp are refused
  unless `--force` is passed; `--force` backs up and restores them if a later
  install fails. `GET /api/admin/export/[batch]?type=dataset|decisions` is the
  admin download route; both require admin authorization.
- `src/lib/review/data-health.ts` caches evidence inspection for five minutes.
  `adminReloadReviewDataAction` clears both the loader cache and the data-health
  cache. Do not make the admin page re-resolve every anchor on each request.
- Exports may include reviewer email; reviewer-facing views must keep using
  `getReviewerNames` (id + name only).

## Environment and security

`.env` (never committed; `.env*` is ignored):

- `BETTER_AUTH_SECRET` — server-only secret, at least 32 characters.
- `BETTER_AUTH_URL` — public base URL, e.g. `http://localhost:3000`.
- `DATABASE_URL` — SQLite path, e.g. `./local.db`.
- `REVIEW_DATA_ROOT` — read-only review-data mount, one directory per batch (e.g. `./review-data`). Never commit it.
- `REGISTRATION_CODE` — invite code. **Never expose it to the client**; never name it `NEXT_PUBLIC_*`, log it, or return it in an API response.
- `ADMIN_EMAILS` — comma-separated **candidate allowlist** for `pnpm review:admin:sync`. It never grants admin at request time. The real admin registers first; an operator inspects `pnpm review:admin:sync --list` and then runs `pnpm review:admin:sync --user-id <id>` to promote exactly that account. This confirmation step prevents pre-registration takeover: anyone with the invite code could otherwise register an allowlisted address before its owner. Unmatched configured emails are reported and never created, and the command exits non-zero for them.

Security rules:

- Admin bootstrap is explicit: `ADMIN_EMAILS` only lists candidates, and promotion requires `pnpm review:admin:sync --user-id <id>` after the real admin registered. Never promote by email match alone; that allows pre-registration takeover.
- Keep the registration-code comparison server-side and fail closed when the variable is unset.
- Do not disable Better Auth rate limiting, CSRF, or origin checks without explicit approval.
- Do not weaken cookie or session settings to make local tests pass.
- Treat `association` and `title` as user-owned data. If they ever affect authorization, stop accepting them from user input.
- SQLite is for local development. Serverless deployments need persistent storage or a managed database; a local SQLite file is not durable across deployments/instances.

## Testing

- Playwright runs its own `next dev` on `http://localhost:3100`; it can run while `pnpm dev` is on `:3000`.
- Isolation:
  - `DATABASE_URL=.playwright/test.db` — recreated and migrated by `e2e/prepare-db.mjs` before every run.
  - `NEXT_DIST_DIR=.next-e2e` — separate Next dist dir and dev lock, so it does not collide with the normal dev server.
  - `BETTER_AUTH_URL` is overridden to port `3100`.
- Never point E2E tests at `local.db`.
- Tests cover: wrong code, missing code, correct-code registration, profile-field persistence, valid login, wrong password, and `"none"` defaults.
- Registration tests require `REGISTRATION_CODE` in `.env`; the suite fails fast if it is missing.
- Prefer role/label locators (`getByRole`, `getByLabel`) over CSS selectors.
- Filter `getByRole("alert")` by text; Next's route announcer also uses `role="alert"`.

## UI conventions

- Use shadcn components from `src/components/ui/`; add missing ones with `pnpm exec shadcn add <component>`.
- Use full composition: `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`, `FieldGroup` + `Field` + `FieldLabel`.
- Use semantic tokens (`bg-background`, `text-muted-foreground`), not raw colors.
- Use `gap-*` with flex/grid, not `space-x-*`/`space-y-*`.
- Use `size-*` when width and height are equal.
- Buttons do not have `isLoading`; compose `Spinner` + `disabled`.
- Icons come from `lucide-react`; use `data-icon` inside buttons and let components size them.
- Base UI components use the `render` prop, not Radix's `asChild`.
- Import with the `@/*` alias, which maps to `src/*`.

## Known pitfalls

- `src/app` is ignored if a root `app/` exists. Keep the app under `src/`.
- The Better Auth CLI is pinned to `1.7.14` in `package.json`; bump it together with `better-auth`.
- `auth-schema.ts` is generated. Regenerate it; do not patch it by hand.
- Drizzle Kit loads `.env` automatically, but tests pass `DATABASE_URL` explicitly.
- `local.db*`, `.playwright/`, `.next-e2e/`, `test-results/`, and reports are ignored; do not commit them.
- The `AGENTS.md` block above is maintained by `next dev`; commit it with your changes rather than deleting it.
