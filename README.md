# review-pls

Human review of AuditOwl / review-agent overlap and new findings. The app reads prepared review data from a read-only mount and stores users, roles, claims and decisions in SQLite.

## Docker

The published image is pulled from GHCR (`ghcr.io/404simon/review-pls`); `Dockerfile` builds the same Next.js standalone output locally. Run it behind a reverse proxy that terminates TLS. The runtime image includes `ripgrep` because the evidence search route spawns `rg`.

1. Create the bind-mounted database directory. The container runs as uid/gid `1000` (`node`), so the host directory must be writable by that user:

   ```bash
   mkdir -p data
   sudo chown -R 1000:1000 data
   ```

2. Prepare and mount the review data. It is never committed and is read-only at runtime:

   ```bash
   pnpm review-data:prepare --source /path/to/analysis --auditowl /path/to/auditowl --batch r16fix5 --out ./review-data
   pnpm review-data:check --root ./review-data --batch r16fix5
   chmod -R a+rX ./review-data
   ```

   `docker-compose.yml` mounts `./review-data` at `/data/reviews:ro` and sets `REVIEW_DATA_ROOT=/data/reviews`. The entrypoint refuses to start when the variable is unset or the directory is missing/unreadable.

   To prepare on a workstation and publish to a server, sync the whole batch and fix permissions remotely:

   ```bash
   pnpm review-data:prepare --source /path/to/analysis --auditowl /path/to/auditowl --batch r16fix5 --out ./review-data
   pnpm review-data:check --root ./review-data --batch r16fix5
   rsync -a --delete ./review-data/ server:/srv/review-pls/review-data/
   ssh server 'chmod -R a+rX /srv/review-pls/review-data'
   ```

3. Create the runtime environment file from the example and fill it in. `docker-compose.yml` loads `deploy.env` automatically; it is gitignored and must never be committed:

   ```bash
   cp deploy.env.example deploy.env
   chmod 600 deploy.env
   # edit deploy.env: BETTER_AUTH_URL, BETTER_AUTH_SECRET, REGISTRATION_CODE,
   # CONTACT_EMAIL and ADMIN_EMAILS
   ```

   `CONTACT_EMAIL` is the required contact address shown in the reviewer guide, and `ADMIN_EMAILS` lists the accounts that become admin on start; see the bootstrap notes below.

4. Pull the published image and start it:

   ```bash
   docker compose pull
   docker compose up -d
   docker compose logs -f
   ```

   If the GHCR package is private, log in first with a token that has `read:packages`:

   ```bash
   echo "$GHCR_TOKEN" | docker login ghcr.io -u 404Simon --password-stdin
   ```

On every start the container runs pending Drizzle migrations before accepting requests (see `src/instrumentation.ts`), so upgrades are a pull and restart. The SQLite database lives on the `./data` bind mount, including its `-wal`/`-shm` files, so use a local filesystem (not NFS/SMB).

The app listens on port `3000` inside the container. `docker-compose.yml` publishes it on `127.0.0.1:3000` only; point the reverse proxy at that address and forward the `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` headers.

## Review data

`REVIEW_DATA_ROOT` contains one directory per batch, each with its own `batch.json`. The manifest records included papers, excluded papers and their reasons, content hashes and the per-paper counts. In the r16 batch, `2254` (no AuditOwl evidence / no author code) and `3680` (repository revision mismatch; AuditOwl clone unavailable) are deliberately excluded and only appear in `batch.json` for provenance.

The mount is read-only. The app never writes findings, papers, code or PDFs. Evidence paths are resolved with `realpath` and rejected if they leave the paper or batch directory, so symlinks that point outside the mount are not evidence.

Permissions: the container's `node` user (uid 1000) must be able to read every file in the mount. `chmod -R a+rX` is the recommended host-side fix after `rsync`.

## Admin bootstrap

`ADMIN_EMAILS` is a comma-separated list of the accounts that should be admin. On every start the server promotes each **already registered** account whose email matches it (`src/instrumentation.ts`), so the admin set follows the deployment's environment after a restart:

```bash
docker compose restart
docker compose logs -f        # "Promoted N allowlisted account(s) to admin: ..."
```

Promotion only, never demotion: roles granted through `/admin` stay, so a typo or a temporarily empty allowlist cannot lock you out of the console. Emails without an account are logged as warnings and are never created; the next start picks them up once that person registers.

To promote without a restart, run the sync on the **host** against the same database (the runtime image has no `pnpm` or `tsx`):

```bash
ADMIN_EMAILS="simon@example.org" DATABASE_URL=./data/review.db \
  pnpm review:admin:sync --user-id <registered-user-id>
```

## Exports

Admins can download exports from `/admin`, or write them with the CLI. The CLI runs on the **host**, not inside the runtime image: the runtime image contains only the standalone server and has no `pnpm` or `tsx`. Point it at the host paths that back the container volumes, and use an existing database file:

```bash
pnpm review:export --batch r16fix5 --type both --out ./exports \
  --root ./review-data --database ./data/review.db
```

Use `--force` only when you intentionally want to replace an export that already exists at the same `--now` timestamp.

The database must already exist. The command applies pending Drizzle migrations idempotently before reading, and fails with an actionable message (without creating an empty database) when the path is wrong. Use `pnpm db:migrate` first if the migration folder is unavailable.

Two deterministic, schema-versioned JSON files are written to `exports/<batch>/`. `--type dataset` or `--type decisions` writes only that file. Both the download route and the CLI call the same `buildExportDocument` helper, so a download and a written file of the same type and timestamp are byte-identical. For `--type both`, every payload is built and staged before either file is installed, so a builder or staging failure leaves no partial export. Installing is two renames, not one atomic directory swap: a process kill between them can still leave only one of the two files. Existing files at the same timestamp are refused; pass `--force` to replace them. With `--force`, pre-existing files are moved aside and restored if installation fails.

- `review-dataset-<timestamp>.json` — the full archival dataset: `batch.json`, the complete per-paper sources (`overlap.json`, both findings files and every built item with its findings, comparator and hash), claims, every current decision row (including drafts) and the append-only decision event history, plus batch/paper/reviewer stats. It can be re-analysed without the review-data mount.
- `decisions-<timestamp>.json` — final closed decisions only, plus the durable unsure history from events. Drafts are excluded, and finding bodies are intentionally not duplicated here. Reviewers appear as id, name, title and association; the dataset additionally keeps the email.

The admin download route is `GET /api/admin/export/<batch>?type=dataset|decisions`. It requires an admin session and sends the JSON as an attachment.

## Search

Code search uses `ripgrep`. The Docker image installs it; a local checkout needs `rg` on `PATH`. If it is missing, `/api/search` returns a clear 503 and the rest of the app keeps working.

## Operations

- `/admin` shows mounted batches, manifest hashes, included/excluded papers, per-paper item counts, evidence resolution and quote-match summaries, build issues, missing files, stale and orphaned decisions, roles, active claims, the unsure queue, statistics and export buttons.
- Admins can freeze a reviewer account from `/admin`. A frozen account keeps read access but cannot claim items or save decisions, and its active claims are released so other reviewers can pick the work up. Unfreezing restores review access. Admins cannot be frozen; demote the account first.
- Admins can close registration from `/admin`. New sign-ups are then blocked even with a valid invite code, and `/sign-up` shows a closed notice; existing accounts can still sign in and review. Registration is open by default and the `REGISTRATION_CODE` is still required while it is open.
- “Reload data” clears the in-process review-data and data-health caches immediately. Without a reload, evidence inspection is cached for five minutes. It does not modify the mount or the database.
- Unknown batch, paper and item ids render the not-found boundary. Because `loading.tsx` starts the response stream before `notFound()` runs, that boundary can arrive as HTTP 200 with the correct not-found body; what matters is the boundary, not the status code. A corrupt mounted batch shows a generic reviewer message and keeps loader details in an admin-only block.

## Published images

`.github/workflows/docker.yml` builds and pushes the image to GHCR on every push to `main`, on `v*` tags, and on manual dispatch:

```bash
docker pull ghcr.io/404simon/review-pls:latest
```

Tags are `latest` (default branch), the branch name, `sha-<commit>`, and `X.Y.Z` / `X.Y` for version tags. Builds use BuildKit's GitHub Actions cache (`mode=max`), so the dependency install and build stages are reused between runs.
