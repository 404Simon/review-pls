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

pnpm test:e2e            # Playwright, isolated DB + isolated dist dir
pnpm test:e2e:ui         # Playwright UI mode

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

The repo currently has a single initial migration. Do not squash or rewrite it after it has been deployed or once the database contains real data; add a new migration instead.

## Environment and security

`.env` (never committed; `.env*` is ignored):

- `BETTER_AUTH_SECRET` — server-only secret, at least 32 characters.
- `BETTER_AUTH_URL` — public base URL, e.g. `http://localhost:3000`.
- `DATABASE_URL` — SQLite path, e.g. `./local.db`.
- `REGISTRATION_CODE` — invite code. **Never expose it to the client**; never name it `NEXT_PUBLIC_*`, log it, or return it in an API response.

Security rules:

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
