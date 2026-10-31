# review-pls — human review of overlap and new findings

Status: implementation plan, 2026-10-30.

This app lets humans validate two things on the NeurIPS r16 sample:

1. **Is the finding-level overlap between AuditOwl and our review agent correct?**
   This covers match clusters, AuditOwl-only misses, and related-not-matched pairs.
2. **Are the findings we have on top of AuditOwl actual findings?**
   This covers every review-agent-only finding.

The app is a review workspace, not an analysis notebook. It must make the
evidence one click away: code at the cited lines, check scripts and outputs,
the paper page, and both audit reports.

---

## 1. Decisions taken

| Question         | Decision                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review unit      | **249 items**: 66 match clusters, 12 AuditOwl-only, 166 agent-only, 5 related pairs. A cluster is one item even when it contains several findings.                                                                         |
| Cluster severity | **Maximum severity of both sides.** A high on either side sorts as high.                                                                                                                                                   |
| Reservation      | **2-hour idle lease.** First reviewer claims an item; a heartbeat extends the lease while the item page is open. Expired claims return to the pool.                                                                        |
| Unsure           | **Returns to the open pool.** The unsure note stays visible to the next reviewer. The item is not closed.                                                                                                                  |
| Comparator hints | **Show everything immediately.** Proposed labels, verification notes and checked paths are visible, clearly attributed to the LLM comparator.                                                                              |
| Other reviewers  | **Read-only after items are closed.** Open items are viewable but only the claimant can edit. Admins can reopen.                                                                                                           |
| Excluded papers  | **Not placed in the bind folder.** `2254` (no AuditOwl evidence / no author code) and `3680` (repository revision mismatch; AuditOwl clone unavailable) are excluded. `batch.json` records them for admin provenance only. |
| Batch awareness  | Every route, claim, decision and export is keyed by `batchId`. Multiple batches can be mounted side by side.                                                                                                               |
| Export           | Two JSON exports: a full **review dataset** and a compact **decisions-only** file.                                                                                                                                         |

---

## 2. Workload after exclusion

14 included papers: `654 1171 1274 1333 1800 1829 1867 2167 2188 2278 2963 3764 4523 4647`.

**249 items — 47 high, 111 medium, 91 low.**

| paper     | title                                                                                                                 |      H |       M |      L |   total | clusters |     new | misses | related |
| --------- | --------------------------------------------------------------------------------------------------------------------- | -----: | ------: | -----: | ------: | -------: | ------: | -----: | ------: |
| 1171      | Evolving and Regularizing Meta-Environment Learner for Fine-Grained Few-Shot Class-Incremental Learning               |      3 |       6 |      4 |      13 |        5 |       8 |      0 |       0 |
| 1274      | Efficient Adaptive Experimentation with Noncompliance                                                                 |      1 |       3 |      5 |       9 |        4 |       5 |      0 |       0 |
| 1333      | Latent Harmony: Synergistic Unified UHD Image Restoration via Latent Space Regularization and Controllable Refinement |      8 |       4 |      5 |      17 |        8 |       9 |      0 |       0 |
| 1800      | Maximizing the Value of Predictions in Control: Accuracy Is Not Enough                                                |      0 |       2 |      7 |       9 |        2 |       7 |      0 |       0 |
| 1829      | OLinear: A Linear Model for Time Series Forecasting in Orthogonally Transformed Domain                                |      2 |      14 |     12 |      28 |        3 |      22 |      2 |       1 |
| 1867      | A Differential and Pointwise Control Approach to Reinforcement Learning                                               |      2 |      11 |      8 |      21 |        3 |      16 |      2 |       0 |
| 2167      | DiCoFlex: Model-Agnostic Diverse Counterfactuals with Flexible Control                                                |      3 |      14 |      7 |      24 |        7 |      15 |      1 |       1 |
| 2188      | Detoxifying Large Language Models via Autoregressive Reward Guided Representation Editing                             |      8 |      11 |      8 |      27 |        5 |      20 |      1 |       1 |
| 2278      | VITA-1.5: Towards GPT-4o Level Real-Time Vision and Speech Interaction                                                |      2 |      12 |      6 |      20 |        4 |      13 |      2 |       1 |
| 2963      | Learning Equilibria from Data: Provably Efficient Multi-Agent Imitation Learning                                      |      2 |       3 |      6 |      11 |        4 |       6 |      1 |       0 |
| 3764      | DNAEdit: Direct Noise Alignment for Text-Guided Rectified Flow Editing                                                |      2 |       5 |      3 |      10 |        5 |       4 |      1 |       0 |
| 4523      | Few-Shot Knowledge Distillation of LLMs With Counterfactual Explanations                                              |      5 |      11 |      4 |      20 |        6 |      14 |      0 |       0 |
| 4647      | Dynam3D: Dynamic Layered 3D Tokens Empower VLM for Vision-and-Language Navigation                                     |      4 |       6 |      9 |      19 |        5 |      11 |      2 |       1 |
| 654       | Unveiling Transformer Perception by Exploring Input Manifolds                                                         |      5 |       9 |      7 |      21 |        5 |      16 |      0 |       0 |
| **total** |                                                                                                                       | **47** | **111** | **91** | **249** |   **66** | **166** | **12** |   **5** |

By type:

| type                     | high | medium | low | total |
| ------------------------ | ---: | -----: | --: | ----: |
| match cluster            |   25 |     32 |   9 |    66 |
| agent-only finding       |   20 |     74 |  72 |   166 |
| AuditOwl-only finding    |    1 |      2 |   9 |    12 |
| related-not-matched pair |    1 |      3 |   1 |     5 |

---

## 3. Data source: runtime bind mount

No review data is committed. The app reads a read-only directory at runtime.

```text
./review-data:/data/reviews:ro     # findings, overlap, PDFs, code, reports
./data:/data/db                     # SQLite: users, roles, claims, decisions
```

Environment:

```bash
REVIEW_DATA_ROOT=/data/reviews
DATABASE_URL=/data/db/review-pls.db
ADMIN_EMAILS=simon@example.org   # candidate allowlist only; see §8.1
```

`REVIEW_DATA_ROOT` contains one directory per batch:

```text
review-data/
  r16fix5/
    batch.json
    papers/
      1171/
        overlap.json
        findings.agent.json       # copy of findings_verified.json
        findings.auditowl.json    # copy of AuditOwl findings_verified.json
        paper.json
        paper_text.txt
        paper.pdf
        run/                      # reports + */work/_audit_code trees; transient
                                  # inputs and trajectories excluded
        auditowl/                 # audit.md, findings_verified.json, _audit_code/
        code/
          Legenddddd__MEL/        # repo snapshot, .git excluded
      1274/
        ...
```

### 3.1 `batch.json`

The prep script writes this. It is the only manifest the app needs.

```json
{
  "schemaVersion": 1,
  "batchId": "r16fix5",
  "label": "NeurIPS r16 · review-agent dsv41-r16fix5 vs AuditOwl",
  "generatedAt": "2026-10-30T12:00:00.000Z",
  "contentSha256": "…",
  "protocol": {
    "name": "neurips-16-overlap-r16fix5",
    "version": "1",
    "path": "docs/experiments/neurips-16-overlap-r16fix5.md"
  },
  "excluded": [
    { "paperId": "2254", "reason": "no AuditOwl findings / no author code" },
    {
      "paperId": "3680",
      "reason": "repository revision mismatch; AuditOwl clone unavailable"
    }
  ],
  "papers": [
    {
      "id": "1171",
      "title": "Evolving and Regularizing Meta-Environment Learner ...",
      "category": "empirical",
      "auditowlStatus": "audited",
      "comparisonEligible": true,
      "scopeNote": null,
      "dir": "papers/1171",
      "files": {
        "overlap": "overlap.json",
        "agentFindings": "findings.agent.json",
        "auditowlFindings": "findings.auditowl.json",
        "paper": "paper.json",
        "paperText": "paper_text.txt",
        "paperPdf": "paper.pdf",
        "agentRun": "run",
        "auditowlDir": "auditowl"
      },
      "code": [
        {
          "name": "Legenddddd__MEL",
          "dir": "code/Legenddddd__MEL",
          "role": "repository",
          "commit": "e7bbd775d38a1be90c61465ca1af0f55ac895625"
        }
      ],
      "sha256": {
        "overlap": "…",
        "agentFindings": "…",
        "auditowlFindings": "…"
      },
      "counts": {
        "clusters": 5,
        "agentOnly": 8,
        "auditowlOnly": 0,
        "related": 0,
        "bySeverity": { "high": 3, "medium": 6, "low": 4 }
      }
    }
  ]
}
```

Paths in `files` and `dir` are relative to the paper directory. `code[].commit` is copied from `run.json` / `repo_revisions.json`; it is display-only. `role` is `repository`, `supplement` (a `supplement*` directory inside `code/`) or `workspace` (a directory without a known revision). Non-repository directories never claim an empty-string commit: `commit` is either the revision or `null`. `contentSha256` is the canonical content fingerprint of the batch (everything except `generatedAt` and `contentSha256` itself); it is what the app exposes as `manifestSha256` for decision staleness. Re-running prep on unchanged sources keeps the same fingerprint and reuses the previous `generatedAt`.

### 3.2 Prep script

`scripts/prepare-review-data.ts` (run with `tsx`) builds the mount from the analysis repos:

```bash
pnpm review-data:prepare \
  --source /home/simon/dev/ISMB-Reproducibility-Analysis \
  --auditowl /home/simon/dev/auditowl-neurips2025 \
  --batch r16fix5 \
  --out ./review-data \
  --exclude 2254,3680 \
  --mode copy
```

Modes: `copy` (default, portable) and `hardlink` (fast, same filesystem).
Symlink mode does not exist: evidence symlinks that point outside the batch
root are rejected by the resolver, so a symlinked batch could never resolve.

Input options:

- `--inputs <dir>` selects the paper input snapshot explicitly. The default is
  `<source>/review-agent/runs/inputs/neurips-2025-r16`; every paper is read from
  that snapshot (`papers/<id>/` or `<id>/`). There is no lexicographic scan of
  sibling snapshots.
- `--generated-at <iso>` writes a fixed timestamp for deterministic runs.
  Without it, a no-op re-prep reuses the previous `generatedAt` when the
  content fingerprint is unchanged.

The script:

- discovers `review-agent/runs/reviews/*-dsv41-r16fix5`;
- skips excluded papers and records them in `batch.json`;
- copies `overlap.json`, `findings_verified.json` (agent), the AuditOwl
  `findings_verified.json` / `audit.md` / `_audit_code/` / `_verifier_code*`,
  and the paper input directory (`paper.json`, `paper.pdf`, `paper_text.txt`,
  `code/`);
- requires `audit.md` on both sides and validates `paper.json` with
  `paperMetadataSchema`; a batch never reports success without its reports;
- copies the agent run directory, excluding `verify-input/`,
  `escalation-input/`, `escalate/`, `.run.lock`, `*/trajectory.json`, `*.sif`,
  and other intermediate files; keeps the top-level reports and data
  (`audit*.md`, `run.json`, `union.json`, `findings*.json`, `overlap.json`) plus
  `*/work/_audit_code*/` and `*/work/_verifier_code*/`;
- excludes `.git`, `node_modules`, `__pycache__`, `.venv`, `*.pyc`, `.DS_Store`;
- records `code[]` entries with an explicit `role` and `commit: null` when no
  revision is known, instead of pretending every `code/` directory is a repo;
- verifies every kept finding appears exactly once in a cluster or an
  `*_only` list, every referenced ID exists, and `counts` can be recomputed;
- runs the official `validate_overlap.py` when `python3` is available;
- writes sha256 values, the recomputed counts and the content fingerprint to
  `batch.json`;
- prints a summary table and the total size.

The new batch is built in a temporary sibling directory. Only after every file
was copied, parsed, validated and hashed does the script atomically replace the
target. If anything fails, the previous batch stays untouched and the temporary
directory is removed. A non-empty target is still refused unless `--force` is
given, but `--force` only replaces it after the new batch is valid.

The script is idempotent: unchanged content keeps the same `contentSha256` and
the same `generatedAt`, so decisions do not go stale after a no-op re-prep.

---

## 4. Domain model

### 4.1 Item kinds

| kind            | source                          | item ref                      |
| --------------- | ------------------------------- | ----------------------------- |
| `cluster`       | `overlap.matches[]`             | `match_id` (`M01`)            |
| `auditowl_only` | `overlap.auditowl_only[]`       | AuditOwl `id_local`           |
| `agent_only`    | `overlap.agent_only[]`          | agent `id_local`              |
| `related`       | `overlap.related_not_matched[]` | `<auditowl ids>--<agent ids>` |

Item ID used in URLs: `<kind>:<paperId>:<ref>` (ref URL-encoded).
For `related`, ref is `<auditowlIds.join("+")>--<agentIds.join("+")>`.

### 4.2 Severity

Rank: `high = 3`, `medium = 2`, `low = 1`.

- cluster: max of all AuditOwl and agent member severities.
- `auditowl_only`: its severity.
- `agent_only`: its severity.
- `related`: max of both underlying findings.

Sort order everywhere: severity desc, paper id asc, kind order
(`cluster`, `agent_only`, `auditowl_only`, `related`), ref asc.

### 4.3 Item status

| status    | meaning                                                                                    |
| --------- | ------------------------------------------------------------------------------------------ |
| `open`    | no active claim, no final decision                                                         |
| `claimed` | active claim (lease not expired)                                                           |
| `unsure`  | latest decision is unsure and no later final decision; claim released; visible to the pool |
| `closed`  | a final decision exists                                                                    |

A closed item is read-only for reviewers. Admins can reopen it.

### 4.4 Staleness

Every decision stores:

- `itemHash`: sha256 of the canonical item source JSON;
- `manifestSha256`: the batch content fingerprint at decision time
  (`batch.json.contentSha256`, canonical content without `generatedAt`).

On load, the app compares both. A mismatch shows a “source changed since this
decision” badge and is surfaced in admin data health and exports. It is never
silently applied.

---

## 5. Reviewer workflow

### 5.1 Home / paper list

`/dashboard` remains the signed-in home and keeps the existing “Welcome back”
heading and profile card so the current auth tests keep passing. It becomes the
review home:

- batch summary cards: total items, high/medium/low, open/claimed/unsure/closed;
- paper table: paper id + title, H/M/L counts, total, per-type counts, progress;
- filters: batch, severity, type, status, “only mine”;
- “Resume” link to the last claimed item;
- link to the global severity queue.

`/batches` may redirect to `/dashboard` or render the same batch list. All
detail routes live under `/batches/[batch]/...`.

### 5.2 Queue

`/batches/[batch]/queue` (optionally `/queue?batch=`):

- flat list of items sorted by severity;
- columns: item, paper, type, severity, status, claim;
- “Reserve” button on open items;
- filters and a search box;
- default filter hides closed items, but `?status=closed` shows them read-only.

### 5.3 Paper page

`/batches/[batch]/papers/[paperId]`:

- header: title, category, comparison eligibility, repos/commits, caveats;
- summary: counts by type and severity, progress;
- tabs: Matches, New findings, AuditOwl-only, Related, All;
- each tab is a filterable item list; items link to the item page;
- revision-mismatch banner is data-driven (not hard-coded), though 3680 is
  excluded from this batch.

### 5.4 Item page

`/batches/[batch]/items/[itemId]`:

- claim bar: “Reserved by you until 14:32” + Release, or “Reserved by X” +
  View only, or “Open” + Reserve;
- comparator panel: proposed labels, verification status/notes, checked paths,
  severity/status agreement, `agent_adds` / `auditowl_adds`;
- side-by-side findings for clusters and related pairs; a single finding for
  `*_only`;
- evidence panel: Code / Checks / Paper / Reports tabs (see §6);
- decision form (see §7);
- history: previous unsure notes and (for read-only closed items) the final
  decision, reviewer and timestamp.

### 5.5 Claiming and leases

- Claiming is first-come-first-served; no admin assignment is required.
- `item_claim` has one row per item, unique on
  `(batch_id, paper_id, item_kind, item_ref)`.
- Lease = **2 hours since last activity**. Claim, draft save and heartbeat
  extend it.
- The item page sends a heartbeat every 60 seconds while the tab is visible.
  Closing the tab stops the heartbeat; the claim expires after 2 hours.
- A heartbeat on an item that already has a final `closed` decision is rejected
  with `ItemClosedError` and removes any stale/direct claim row. Reads
  (`getItemClaim`, bulk state) also reap such rows instead of presenting a live
  claim on a closed item.
- Expired claims are reaped lazily on read/claim; the item is then `open`.
- A reviewer can release their own claim. Admins can release any claim.
- **A closed item cannot be claimed.** `claimItem`/`ensureClaim` reject it with
  `ItemClosedError` until an admin reopens it (closed row → draft).
- Saving a final decision releases the claim immediately.
- Saving `unsure` releases the claim immediately and leaves the item open.
- Only the active claimant can save a decision. A save from an **expired claim
  owned by the same reviewer** is rejected with `ClaimExpiredError`; the page
  refreshes the claim state and the reviewer must explicitly re-claim.
- Saving with no claim row may atomically claim a free item. An expired claim
  held by another reviewer is treated as free and may be taken over by the save.

### 5.6 Unsure

- `unsure` is a decision status, not a final classification.
- The item stays open. The next reviewer sees:
  “Marked unsure by Alice 12 minutes ago — reason: …”.
- The same reviewer may re-claim later.
- If another reviewer closes it, their final decision wins; the unsure note
  remains in the history and in exports.
- If the same reviewer re-claims and writes a draft, the public status follows
  the active claim/draft again (`claimed`, or `open` after the lease expires).
  This is deliberate: later work resumes the item, while the earlier unsure
  note stays visible from the append-only event history. Stats and filters use
  the same derived status, so an item resumed after unsure is no longer
  counted in the `unsure` bucket.

### 5.7 Read-only after closing

- Reviewers can open closed items and read the decision, note, reviewer and
  timestamp.
- The decision form is disabled.
- Admins can reopen: the decision becomes a draft owned by the admin, the claim
  is released, and the item returns to the pool. The previous payload is
  preserved in the row.

---

## 6. Evidence system

Every item page must let a reviewer verify the claim without leaving the app.

### 6.1 Path resolution

Findings cite paths in several forms:

- repo-relative: `dataloader/data_utils.py:6-32`
- workspace-relative: `code/<owner>__<repo>/...`
- repo-prefixed: `<owner>__<repo>/...`
- check output: `out/check_missing_modules.csv`
- arm-relative: `_audit_code/…`, `audit/work/_audit_code/out/…`
- paper: `paper.pdf`
- URL

Resolver order for a finding side:

1. paper directory + path;
2. each `code/<repo>/` + path;
3. strip a leading `code/` and retry;
4. strip a leading `<repo>/` and retry under that repo;
5. `run/` + path (agent side) or `auditowl/` + path (AuditOwl side);
6. for `out/...` and `_audit_code/...`, search the arm work trees:
   `run/*/work/_audit_code/...`, `run/*/work/_audit_code/out/...`,
   `auditowl/_audit_code/...`;
7. unique basename fallback inside the repo trees;
8. unresolved.

The resolver returns `{ kind, absolutePath, lineStart, lineEnd, note }` and
never escapes the paper directory or the batch root. Absolute paths and any `..`
traversal are rejected outright; they never fall through to the
unique-basename search. A unique-basename fallback is accepted only when exactly
one match exists. Resolution, tree browsing and code search all resolve the
paper and repo roots with `realpath`, reject roots that leave the paper, and
apply the ignored-path predicate to both the requested path and its real target
(so a symlink into another paper or into `.git`/`node_modules` is not evidence).

After excluding non-kept findings the batch has **331 kept finding anchors:
324 local files and 7 URLs**. The resolver resolves all 324 local anchors; the
7 URL anchors are not locally checkable by design. The data check asserts at
least 99% local coverage over the included kept findings and prints the exact
local/total numbers. It also reports quote mismatches separately as source
anomalies (currently 4) so they are not confused with resolver/app bugs.

### 6.2 Quote verification

For code anchors, compare the finding `quote` to the cited lines:

- normalize whitespace and common indentation;
- `exact` when normalized text matches;
- `fuzzy` when token overlap is high but not identical;
- `missing` when the file or quote cannot be matched;
- `not_checkable` when the cited lines fall beyond the bytes actually read, the
  file looks binary, or a quote has no line range. The cap is **bytes only**:
  verification reads at most the first 1 MB and never reads a whole evidence
  file. There is no line-number pre-check, so a small file cited at line 405 is
  verified normally; only citations past the 1 MB window are skipped.

Show a badge on every evidence card. This makes broken anchors obvious without
making the reviewer do the diff by hand.

### 6.3 Code tab

- One card per side/anchor: repo, path, commit, cited line range, quote.
- Render the cited range with 40 lines of context, line numbers, and a
  highlight on the cited lines.
- `Open full file`, `Open repo tree`, `Search this repo`.
- Missing file: show the path, the resolver's attempts, and the closest
  matches. Absence claims need the tree and search more than the file viewer.
- Cap inline files at 1 MB / 400 displayed lines (long single lines are
  truncated at 500 characters); larger files get a download/open link. The
  evidence route streams bytes from disk for any file size instead of buffering
  it, and applies the same ignored-path exclusions as tree and search.

### 6.4 Checks tab

- `check_script` (when present) and every resolvable path from
  `verification.checked` and `_audit_code` references.
- CSV rendered as a table (max 100 rows) with a filter; rows whose `reference`
  column matches the finding's file/line are highlighted. The filter applies to
  the displayed (already capped) rows, and the UI labels that scope explicitly.
- JSON pretty-printed (max 200 lines); `.py`, `.log`, `.md`, `.txt` as text or
  markdown.
- Badges for resolved/missing, and a clear note when the comparator's claim
  names an artifact that is not in the mount.

### 6.5 Paper tab

- `paper_ref` text and parsed page numbers (`p. 8`, `pp. 21-22`).
- PDF served through the evidence route and opened at `#page=N&zoom=page-width`.
- Full-text search over the first 8 MB of `paper_text.txt`; results show ±200
  characters of context and a “Find in PDF” hint. The UI states explicitly when
  the extracted text was truncated and only the first 8 MB was searched.
- The finding's own `quote` is shown above the PDF so the reviewer knows what
  to look for.

### 6.6 Reports tab

- Agent `run/audit.md` and AuditOwl `auditowl/audit.md`.
- Show an excerpt around `audit_md_line` (±40 lines) and a link to the full
  report.
- Render markdown with `react-markdown` + `remark-gfm`; fall back to
  preformatted text on parse errors.
- Additional arm reports (`audit-1.md`, `audit-2.md`) are available from the
  file tree, not in the main tab.

### 6.7 Search

- `GET /api/search?batch=&paper=&scope=code|paper&q=`:
  - code: `rg --json --fixed-strings` per repo, no shell, 5 s timeout,
    20 results per repo, 4 MB output cap reported as `truncated`, skip binary
    files and the ignored paths (`.git`, `node_modules`, `__pycache__`,
    `.venv`, `*.pyc`, `*.sif`, `trajectory.json`, `.env*`);
  - paper: case-insensitive search over `paper_text.txt`, max 50 results.
- If `rg` is unavailable, return a clear 503-style error; the rest of the app
  still works.
- Rate-limit searches per user with the existing in-memory limiter.

---

## 7. Classification vocabulary and payloads

The UI uses the protocol's vocabulary. Human payloads are validated with zod on
the server.

### 7.1 Cluster

```ts
{
  verdict: "same_defect" | "not_a_match" | "unsure",
  acceptedAsProposed?: boolean,
  strength?: "exact" | "strong" | "weak",
  coverage?: "equivalent" | "agent_broader" | "auditowl_broader" | "partial",
  verification?: "confirmed" | "partly_confirmed" | "refuted" | "not_checked",
  note: string
}
```

- `same_defect` is the primary accept action; the proposed strength, coverage
  and verification are pre-filled. “Adjust labels” exposes the selects.
- `not_a_match` requires a note; the server rejects any `strength`/`coverage`
  and rejects `acceptedAsProposed: true`.
- `unsure` requires a short note and releases the claim.
- `acceptedAsProposed: true` is only valid when `strength`, `coverage` and
  `verification` all equal the comparator's proposed values; the server
  validates this against the loaded item.

### 7.2 Agent-only

```ts
{
  verdict:
    | "confirmed_valid"
    | "partly_valid"
    | "invalid"
    | "not_checked"
    | "unsure",
  severity?: "high" | "medium" | "low", // optional correction
  novelty?:
    | "genuine_addition"
    | "variant_of_auditowl"
    | "out_of_scope"
    | "invalid",
  note: string
}
```

- `confirmed_valid`, `partly_valid`, `invalid` are final.
- `not_checked` is allowed only for low severity and requires a note.
- `unsure` releases the claim.
- The comparator's proposed assessment/novelty is shown in full; the reviewer's
  values are recorded separately.

### 7.3 AuditOwl-only

```ts
{
  verdict:
    | "agent_missed"
    | "scope_difference"
    | "revision_difference"
    | "invalid_original_finding"
    | "unclear"
    | "unsure",
  assessment: "confirmed_valid" | "partly_valid" | "invalid" | "not_checked",
  note: string
}
```

- `agent_missed` is the “genuine miss” action.
- `unclear` is a final “cannot decide” classification; it differs from
  `unsure` (which releases the claim and leaves the item open).
- `assessment` is the independent verdict on the original finding.

### 7.4 Related pair

```ts
{
  verdict: "agree_not_matched" | "same_defect" | "unsure",
  note: string
}
```

- `same_defect` records a missed match: the pair should have been a cluster.
- `unsure` releases the claim.

### 7.5 Optional link proposal

On agent-only and AuditOwl-only items, the reviewer can add:

```ts
proposedLink?: {
  kind: "agent_only" | "auditowl_only",
  ref: string
}
```

This records “this is actually the same defect as …” without editing the other
item. It is exported for adjudication. The link picker defaults to the
`closest_*` lists from `overlap.json`.

The server validates a proposed link against the loaded batch: the target must
exist in the same paper, must have the opposite side kind (`agent_only` links to
`auditowl_only` and vice versa), and is rejected otherwise.

`not_checked` remains valid only for low-severity agent-only items; this is
checked with the loaded item severity, not the payload alone.

### 7.6 Drafts

- Drafts are saved server-side with `status = "draft"` and are visible only to
  their owner and admins.
- Draft payloads use a permissive draft schema, so a half-finished form still
  autosaves. The strict per-kind rules apply only when the row becomes
  `closed`/`unsure`.
- The form autosaves a draft after 800 ms of inactivity and shows
  “Unsaved changes”, “Saving…”, “Saved” or “Not saved”.
- `s` saves and closes when the form is complete; on an incomplete form it
  saves a draft and says what is still missing (PLAN §10.4).
- Navigating with `j`/`k`, the previous/next buttons, or “Save & next” flushes a
  pending autosave before leaving the page.
- A final or unsure save always wins. In-flight autosaves are serialized and
  cannot turn a just-closed/unsure row back into a draft.
- Reviewers can discard their own draft; final and unsure history is untouched.
- On reload, the owner's draft is restored.
- If the claim expires, the next reviewer starts fresh; the old draft stays in
  the database for audit/admin.
- Final and unsure saves also append a row to `review_decision_event`. Draft
  autosaves do not, so a later draft can never erase an earlier unsure note.

---

## 8. Persistence

### 8.1 Tables

`reviewer_role`

| column       | type                 | notes                           |
| ------------ | -------------------- | ------------------------------- |
| `user_id`    | text PK              | FK `user.id`, cascade           |
| `role`       | text                 | `reviewer` (default) or `admin` |
| `created_at` | integer timestamp_ms |                                 |

`ADMIN_EMAILS` is a **candidate allowlist only**, never a runtime grant and
never an automatic promotion. The real admin registers first, then an operator
runs `pnpm review:admin:sync --list` to inspect the registered candidates
(email, user id, verification state, registration time) and
`pnpm review:admin:sync --user-id <id>` to promote exactly that account.
`getUserRole` reads `reviewer_role` only (default `reviewer`). The explicit
confirmation prevents pre-registration takeover: because the invite code is
shared, anyone could register an allowlisted address before its owner. A
confirmed id must exist and its email must be in the allowlist; the promotion
runs in one transaction. Emails with no account are reported and never created.
Admins can promote or demote other users afterwards.

`item_claim`

| column         | type                 | notes                 |
| -------------- | -------------------- | --------------------- |
| `id`           | text PK              | uuid                  |
| `batch_id`     | text                 |                       |
| `paper_id`     | text                 |                       |
| `item_kind`    | text                 |                       |
| `item_ref`     | text                 |                       |
| `user_id`      | text                 | FK `user.id`, cascade |
| `claimed_at`   | integer timestamp_ms |                       |
| `last_seen_at` | integer timestamp_ms |                       |
| `expires_at`   | integer timestamp_ms |                       |

Unique index on `(batch_id, paper_id, item_kind, item_ref)`.
Index on `(user_id, expires_at)` and on `expires_at` for lease reaping.

`review_decision`

| column            | type                 | notes                            |
| ----------------- | -------------------- | -------------------------------- |
| `id`              | text PK              | uuid                             |
| `batch_id`        | text                 |                                  |
| `paper_id`        | text                 |                                  |
| `item_kind`       | text                 |                                  |
| `item_ref`        | text                 |                                  |
| `user_id`         | text                 | FK `user.id`, cascade            |
| `status`          | text                 | `draft`, `closed`, `unsure`      |
| `payload`         | text                 | JSON, zod-validated              |
| `item_hash`       | text                 | sha256 at save time              |
| `manifest_sha256` | text                 | batch manifest hash at save time |
| `created_at`      | integer timestamp_ms |                                  |
| `updated_at`      | integer timestamp_ms |                                  |

Unique index on `(batch_id, paper_id, item_kind, item_ref, user_id)`.
Index on the item lookup and on `(batch_id, status)`.

`review_decision_event` (append-only history; migration `0003`)

| column            | type                 | notes                             |
| ----------------- | -------------------- | --------------------------------- |
| `id`              | text PK              | uuid                              |
| `batch_id`        | text                 |                                   |
| `paper_id`        | text                 |                                   |
| `item_kind`       | text                 |                                   |
| `item_ref`        | text                 |                                   |
| `user_id`         | text                 | FK `user.id`, cascade             |
| `status`          | text                 | `closed`, `unsure` or `reopened`  |
| `payload`         | text                 | JSON snapshot                     |
| `item_hash`       | text                 | sha256 at event time              |
| `manifest_sha256` | text                 | batch manifest hash at event time |
| `created_at`      | integer timestamp_ms |                                   |

Indexes on `(batch_id, paper_id, item_kind, item_ref)`,
`(user_id, created_at)` and `(batch_id, status)`.

`review_decision` remains the single mutable current-state row per
`(item, user)`. Every `closed` and `unsure` save appends an event in the same
transaction as the row update; admin reopen appends a `reopened` event carrying
the previous payload. Draft autosaves never append an event. This makes the
unsure note durable even when the same reviewer later re-claims and drafts over
their row.

No findings, overlaps, papers or code are copied into SQLite.

### 8.2 Final decision

For an item:

1. The latest `closed` decision (by `updated_at`) is the final decision.
2. Otherwise, if an `unsure` decision is the current row and no later draft
   exists, the item is `unsure`; the latest unsure note is shown.
3. Otherwise, an active claim means `claimed`.
4. Otherwise, `open`.

A draft does not change the public status on its own, but a draft written after
an unsure marker means the reviewer resumed work, so the item follows the active
claim/open state (`claimed` while the lease is live, otherwise `open`). The
earlier unsure note remains visible from `review_decision_event` and in exports,
and the stats/filters use this same derived status. Closed wins over any
draft/unsure.

Migration `0004_backfill_decision_events` inserts a matching event for every
pre-0003 `closed`/`unsure` row that has no event, so historical decisions appear
in history and exports without rewriting `0001`–`0003`.

Limitation: a pre-0004 closed/unsure decision that was reopened before `0004`
ran is no longer in `review_decision`, so only the `reopened` event survives.
The backfill cannot recover the original decision payload; that history is
irrecoverable by design rather than silently reconstructed.

### 8.3 Server actions

All mutations are server actions or POST route handlers with:

- session check;
- payload validation with zod;
- item existence check against the loaded batch;
- claim ownership check (or atomic claim if free);
- same-origin check for route handlers;
- rate limiting for heartbeat/search.

Actions:

- `claimItem`, `releaseItem`, `heartbeatItem`
- `saveDecision` (`draft`, `closed`, `unsure`)
- `proposeLink`
- `adminReleaseClaim`, `adminReopenItem`, `adminSetRole`

---

## 9. Exports

Two batch exports, both deterministic and schema-versioned.

### 9.1 Full review dataset

`exports/<batch>/review-dataset-<timestamp>.json`

```json
{
  "schemaVersion": 1,
  "batchId": "r16fix5",
  "exportedAt": "…",
  "source": { "manifestSha256": "…" },
  "batch": { "…": "the batch.json content" },
  "papers": [
    {
      "id": "1171",
      "title": "…",
      "overlap": { "…": "…" },
      "findings": { "auditowl": [], "agent": [] },
      "items": [
        { "kind": "cluster", "ref": "M01", "severity": "high", "itemHash": "…" }
      ],
      "repositories": []
    }
  ],
  "claims": [],
  "decisions": [
    {
      "paperId": "1171",
      "itemKind": "cluster",
      "itemRef": "M01",
      "itemHash": "…",
      "status": "closed",
      "payload": {},
      "reviewer": { "id": "…", "name": "…", "email": "…" },
      "createdAt": "…",
      "updatedAt": "…"
    }
  ],
  "decisionEvents": [
    {
      "paperId": "1171",
      "itemKind": "agent_only",
      "itemRef": "…",
      "status": "unsure",
      "payload": {},
      "reviewer": { "id": "…", "name": "…", "email": "…" },
      "createdAt": "…"
    }
  ],
  "stats": {}
}
```

Includes every decision row (draft, unsure, closed), every claim and every
append-only decision event. Each paper also keeps the complete `overlap.json`
object, both raw findings arrays and every built item (findings, comparator,
severity, kind, ref and item hash), so the event list and the review source are
both durable. This is the archival artifact: it can be re-analysed without the
mount.

### 9.2 Decisions only

`exports/<batch>/decisions-<timestamp>.json`

```json
{
  "schemaVersion": 1,
  "batchId": "r16fix5",
  "exportedAt": "…",
  "source": { "manifestSha256": "…" },
  "decisions": [
    {
      "paperId": "1171",
      "itemKind": "cluster",
      "itemRef": "M01",
      "itemHash": "…",
      "decision": {},
      "reviewer": { "id": "…", "name": "…" },
      "decidedAt": "…",
      "proposedLink": null,
      "stale": false
    }
  ],
  "unsure": [
    {
      "paperId": "1171",
      "itemKind": "agent_only",
      "itemRef": "…",
      "note": "…",
      "reviewer": { "id": "…", "name": "…" },
      "at": "…"
    }
  ],
  "stats": {}
}
```

Only final closed decisions go in `decisions`; unsure attempts come from
`review_decision_event` and go in `unsure` so a second reviewer's closure is not
duplicated. Drafts are excluded. The export reads the event table, not the
mutable current row, so an unsure note survives a later draft or closure by the
same reviewer.

### 9.3 Access

- CLI: `pnpm review:export --batch r16fix5 --type dataset|decisions --out exports`
- Admin UI: download buttons for both exports.
- Reviewer-facing export: not required; admin only.
- The export module is pure (DB read + domain build), so it can be tested.

---

## 10. UI

### 10.1 Pages

| route                               | purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `/dashboard`                        | review home: batch summary, paper table, profile card    |
| `/batches/[batch]/queue`            | global item queue, severity-sorted                       |
| `/batches/[batch]/papers/[paperId]` | paper header, tabs, item list                            |
| `/batches/[batch]/items/[itemId]`   | item detail, comparator, evidence, decision              |
| `/guide`                            | protocol definitions and worked examples                 |
| `/admin`                            | data health, roles, claims, unsure queue, exports, stats |

### 10.2 Components

`src/components/review/`:

- `severity-badge.tsx`, `status-badge.tsx`, `claim-bar.tsx`
- `paper-table.tsx`, `item-list.tsx`, `item-card.tsx`, `queue-table.tsx`
- `comparator-panel.tsx`, `decision-form.tsx`, `decision-history.tsx`
- `evidence-panel.tsx`, `code-view.tsx`, `check-view.tsx`, `paper-view.tsx`,
  `report-view.tsx`
- `stats-cards.tsx`, `data-health.tsx`, `empty-state.tsx`
- `confirm-release.tsx`, `link-picker.tsx`

Use shadcn composition from `src/components/ui/` and add missing primitives via
`pnpm exec shadcn add <component>`. Base UI uses the `render` prop, not
Radix's `asChild`.

Suggested additions: `badge`, `tabs`, `table`, `select`, `textarea`, `dialog`,
`sheet`, `dropdown-menu`, `tooltip`, `scroll-area`, `toggle-group`,
`breadcrumb`, `alert`, `alert-dialog`, `sonner`, `progress`, `popover`,
`command`, `separator`, `skeleton`, `avatar`, `resizable`.

### 10.3 Visual language

- Semantic tokens only: `bg-background`, `text-muted-foreground`, `border`,
  `bg-muted`, `text-destructive`, etc.
- Severity: high = destructive-tinted, medium = amber/warning-tinted,
  low = muted/blue-tinted. Use badges with a dot, not raw color text.
- Status: open = outline, claimed = blue/accent, unsure = amber, closed =
  green/success, stale = destructive outline.
- Layout: max-width container, sticky page header, two-column item page on
  desktop (details + sticky evidence), stacked on narrow screens.
- Typography: existing `font-heading` for page titles; mono for code/quotes.
- Empty states: explain what is missing and link to the guide/admin.
- Loading: skeletons, not spinners, for page sections; `Spinner` only inside
  buttons.
- Motion: subtle; respect reduced motion.

### 10.4 Keyboard and speed

- `j` / `k`: next / previous item in the current filtered list.
- `1`–`5`: choose the primary verdict for the current item type.
- `s`: save and close (or save draft if incomplete).
- `u`: mark unsure and release.
- `r`: release without decision.
- `e`: focus the evidence panel.
- `/`: focus search.
- `?`: shortcut help.
- Keyboard shortcuts are one shared guard per page: they are ignored while
  typing in an input/textarea/select/contenteditable, while the help dialog is
  open, and while any modal dialog, alert dialog, popover, menu or command
  palette is open (Base UI `data-open` plus role/`aria-modal` selectors). `d`
  does not toggle the theme behind a modal either.
- `/` and `?` also work on dashboard, queue and paper pages; `/` and `'` are
  consumed so Firefox quick-find does not open.
- The queue remembers filters in the URL.
- “Save & next” is the primary action; after closing, navigate to the next
  unclaimed item in the current filter or return to the queue.

---

## 11. Code organization

```text
src/lib/review/
  types.ts        zod schemas + TS types for batch, overlap, findings, payloads
  ids.ts          item id / ref helpers, severity rank, canonical item hash
  load.ts         runtime fs loader, batch/paper discovery, cache, hashes
  build.ts        pure domain build: papers, items, counts, validation
  resolve.ts      evidence path resolver + quote normalization
  evidence.ts     excerpts, check parsing, paper page extraction, report excerpt
  claims.ts       claim/lease DB logic
  decisions.ts    decision read/write, status derivation, reopen
  stats.ts        batch/paper/reviewer statistics
  export.ts       dataset + decisions exports
  roles.ts        admin/reviewer helpers
  format.ts       small shared formatters

src/db/review-schema.ts
scripts/prepare-review-data.ts
scripts/check-review-data.ts
scripts/export-reviews.ts
```

Rules:

- `types.ts`, `build.ts`, `ids.ts`, `hash.ts` and `resolve.ts` are pure and
  unit-tested. `hash.ts` is server-only (it uses `node:crypto`); `ids.ts` stays
  importable from client components.
- The filesystem boundary is `load.ts` plus `resolve.ts` (and later
  `evidence.ts`): the loader reads manifests and data files, the resolver reads
  evidence files and enforces the batch-root boundary. No other module reads
  the mount.
- `claims.ts` and `decisions.ts` write claim/decision rows. `roles.ts` is the
  single role-table writer (`reviewer_role` only, including the admin
  bootstrap sync); `schema` definitions and migrations are not writers.
- No `any`; zod at every boundary.
- No review data in `src/`, `public/`, or the repository.
- The existing auth code and `src/db/auth-schema.ts` remain untouched; roles
  live in the new table.

---

## 12. Security

- Every review/evidence route requires a session. Unauthenticated users are
  redirected to `/sign-in`.
- Evidence paths are resolved with `realpath` and must stay under the batch
  root. Reject traversal, symlinks escaping the root, and unknown files.
- File serving sets an allowlisted content type, `X-Content-Type-Options:
nosniff`, and no directory listing.
- Search uses `spawn("rg", args)` with no shell, a timeout, and a result cap.
- Server actions validate the session, the item, the claim and the payload.
- Custom POST route handlers check same-origin (`Origin`/`Sec-Fetch-Site`).
- Rate-limit heartbeat and search with the existing in-memory limiter.
- Do not expose another user's email in reviewer-facing read-only views; use
  name + id. Admin exports may include email.
- Never disable Better Auth CSRF, origin checks, rate limiting or the invite
  code. The existing registration code check stays server-side.
- PDFs and code are read-only. No editing from the app.

---

## 13. Testing and quality gates

### 13.1 Unit tests (Vitest)

- item IDs and severity maximum;
- item building from the three overlap lists (every kept finding exactly once);
- related-pair item building;
- resolver: all path forms, unique-basename fallback, traversal rejection;
- quote normalization exact/fuzzy/missing;
- decision payload validation and draft/final rules, including
  `not_a_match`, `acceptedAsProposed`, `proposedLink` and `not_checked`;
- claim expiry, heartbeat extension, heartbeat on a closed item (stale claim
  cleanup), unsure release, atomic claim conflict, concurrent claims,
  closed-item claim rejection and expired-own-claim saves;
- append-only decision events: unsure → re-claim → draft keeps the note,
  unsure → re-claim → closed keeps the note, a second reviewer sees it, and
  admin reopen appends a `reopened` event;
- admin role sync: `--list`/no-confirm promotes nobody, an explicit confirmed
  user id promotes, unknown or non-allowlisted ids are rejected, missing
  configured emails exit non-zero, and a failed promotion rolls back;
- export determinism (stable ordering, schema version), archival dataset
  completeness (full overlap, both findings files and built items) and a compact
  decisions-only export;
- the export CLI rejects missing/unmigrated databases actionably, writes only
  the requested type and never leaves a partial `both` export;
- stats (including unsure not counted as closed).

### 13.2 Data check

`pnpm review-data:check --root ./review-data --batch r16fix5`:

- 14 included papers, 2 excluded;
- 249 items, 47/111/91;
- 66/166/12/5 by type;
- every kept finding exactly once;
- resolver coverage ≥ 99% of local finding anchors over the included kept
  findings; print the exact local and total numbers (currently 324/324 local,
  7 URL, 0 unresolved);
- print unresolved anchors (app/data-contract bugs, which fail the check) and
  quote-match counts, listing quote mismatches separately as source anomalies
  (currently 4, not a check failure and never edited in the source data).
  Citations whose lines fall beyond the first 1 MB actually read are reported
  as `not checkable` (with the byte reason), not as mismatches. There is no
  line-number cap; the check currently reports 253 exact / 12 fuzzy / 4 missing
  / 62 not checkable. Three of the not-checkable anchors cite lines past 1 MB
  in paper 654's 71 MB notebook and are intentionally left unread.

The check runs against the real mount locally; CI skips it when the mount is
absent.

### 13.3 E2E (Playwright)

- Existing auth tests continue to pass (`/dashboard`, “Welcome back”).
- Fixture batches committed under `e2e/fixtures/review-data/`: the main
  `review-fixture` batch (synthetic paper, a handful of items, tiny code files,
  a minimal PDF and deliberately ignored/transient paths), a second
  `review-fixture-b` copy plus a dedicated admin-claim paper for multi-batch,
  race-isolation and global-claim-release tests, and a `broken-fixture` with an
  invalid manifest for the data-error UI. (Deviation from the original “2
  papers”: one paper covers every item kind and keeps each batch small; the
  second batch exists to exercise batch switching and admin claim tests.)
- Scenarios:
  - paper table shows H/M/L counts and total;
  - claim an item; it shows “Reserved by you”;
  - save a cluster decision; item closes; claim released;
  - mark unsure; item returns to the pool; another user can claim and sees the
    note;
  - closed item is read-only;
  - admin releases a claim and reopens a closed item;
  - release/discard wait for a delayed draft autosave and stay released or
    discarded;
  - clicking an internal link or shell nav link flushes the pending draft;
  - unknown batches/papers/items render the not-found boundary without mount
    paths, while a corrupt batch shows a generic reviewer error and admin-only
    details;
  - the dashboard honours `?batch=` in the header, selector and Queue/Papers
    links across two batches;
  - navigation controls expose link semantics, and the paper filters sit above
    the item list at mobile and desktop widths;
  - export decisions JSON contains the final decision and not drafts;
  - unauthenticated access to an evidence route is rejected.
- E2E uses `REVIEW_DATA_ROOT=./e2e/fixtures/review-data` and the existing
  isolated database/dist directory.
- The fixture is one synthetic paper (accepted deviation: a second paper would
  only duplicate coverage). Nested `.git` cannot be committed and `.env*` is
  ignored, so the ignored-path test creates those two entries at runtime and
  removes them afterwards; committed assertions still cover `node_modules/`,
  `trajectory.json` and `__pycache__`.

### 13.4 Gates

Before each phase is accepted:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm check:standalone
```

`pnpm check:standalone` asserts that `.next/standalone` stays under 200 MB and
contains no `review-data`, `data`, `exports`, `e2e`, `scripts`, `src`, `.git`,
`.env*`, `local.db*`, test-results or Playwright directories.

Plus `pnpm review-data:check` for Phase 1 and after any data-contract change.

---

## 14. Deployment

`docker-compose.yml`:

```yaml
environment:
  REVIEW_DATA_ROOT: "/data/reviews"
  # Candidate allowlist only: inspect with `pnpm review:admin:sync --list`
  # and promote the confirmed account with `--user-id <id>`.
  ADMIN_EMAILS: "simon@example.org"
volumes:
  - ./data:/data
  - ./review-data:/data/reviews:ro
```

`docker-entrypoint.sh`:

- require `REVIEW_DATA_ROOT`;
- require the directory to exist and be readable;
- keep the existing database checks and secret length check;
- do not parse every batch at startup; the app surfaces data errors per batch.

`Dockerfile` runner:

- install `ripgrep` (needed by search) before `USER node`;
- keep the existing standalone output and migration copy.

Build tracing:

- `src/lib/review/evidence.ts` spawns the literal command `rg`, never a dynamic
  binary, so Turbopack does not trace the whole project for the search route.
- `next.config.ts` sets `outputFileTracingExcludes` for `review-data/**`,
  `data/**`, `exports/**`, `e2e/**`, `scripts/**`, `src/**` (already compiled),
  `.env*` and `local.db*` as defense in depth.
- `.dockerignore` additionally excludes those paths (plus `.git`, `.next`,
  `node_modules`, test output and local artifacts) while keeping `src`,
  `public`, `drizzle`, configs and package files. A 450 MB review-data mount or
  a local database therefore cannot be baked into the image.
- Next copies loaded `.env` / `.env.production` files into the standalone
  bundle regardless of tracing excludes. `postbuild` strips those copies
  because runtime secrets are injected by the environment, then fails on any
  other forbidden entry (which would indicate a tracing regression).
- After a build, `pnpm check:standalone` verifies the output is small and free
  of review data, secrets, tests and scripts.

Data preparation on the server:

```bash
pnpm review-data:prepare --source … --auditowl … --out ./review-data
rsync -a --delete ./review-data/ server:/srv/review-pls/review-data/
ssh server 'chmod -R a+rX /srv/review-pls/review-data'
```

`.gitignore` additions:

```text
/review-data/
/exports/
```

README additions: preparing/mounting data, excluded papers, admin bootstrap,
export commands, permissions.

---

## 15. Implementation phases

Each phase is implemented by one implementer agent, then adversarially reviewed
by a reviewer agent. Bugs go to a fixer agent and the reviewer re-reviews until
clean. No phase starts before the previous one passes its gates.

### Phase 1 — Data contract, prep script, runtime loader, resolver

Deliverables:

- `scripts/prepare-review-data.ts`
- `scripts/check-review-data.ts`
- `src/lib/review/types.ts`, `ids.ts`, `load.ts`, `build.ts`, `resolve.ts`
- unit tests for pure logic
- a prepared `review-data/r16fix5` from the real sources (gitignored)
- `pnpm review-data:check` passing with the counts in §2

No UI, no database changes.

### Phase 2 — Database, roles, claims, decisions

Deliverables:

- `src/db/review-schema.ts`, drizzle config/index update, migration
- `src/lib/review/roles.ts`, `claims.ts`, `decisions.ts`, `stats.ts`
- server actions for claim/release/heartbeat/save/reopen
- unit tests for lease expiry, unsure release, conflict, final status,
  closed-item claim rejection and payload rules
- admin bootstrap via `pnpm review:admin:sync`: `ADMIN_EMAILS` is a candidate
  allowlist only; `--list` writes nothing and `--user-id <id>` promotes one
  explicitly confirmed account (never a runtime grant)

No evidence API or pages yet.

### Phase 3 — Evidence API and viewers

Deliverables:

- `src/app/api/evidence/[...path]/route.ts`
- `src/app/api/tree/route.ts`
- `src/app/api/search/route.ts`
- `src/lib/review/evidence.ts`
- shadcn primitives installed
- `code-view`, `check-view`, `paper-view`, `report-view`, `evidence-panel`
- security tests for traversal and auth

### Phase 4 — Review UI

Deliverables:

- `/dashboard` review home and paper table
- `/batches/[batch]/queue`
- `/batches/[batch]/papers/[paperId]`
- `/batches/[batch]/items/[itemId]`
- `claim-bar`, `comparator-panel`, `decision-form`, `decision-history`
- keyboard shortcuts, filters, autosave, toasts
- `/guide`
- E2E fixture and core flows

### Phase 5 — Admin, exports, stats, deployment

Deliverables:

- `/admin`: data health, roles, claims, unsure queue, stats
- `src/lib/review/export.ts`, `scripts/export-reviews.ts`, admin download route
- README and Docker changes
- final E2E, typecheck, lint, build
- final adversarial review

---

## 16. Acceptance criteria

- The app loads all 14 included papers from a read-only bind mount with no
  review data in git or SQLite.
- The paper table shows 249 items with 47 high / 111 medium / 91 low, and the
  per-paper counts in §2 are reproducible. The data check asserts at least 99%
  local evidence coverage over the included kept findings and reports the exact
  numbers (331 anchors: 324 local, 7 URL, 0 unresolved).
- A reviewer can claim any open item, sees a 2-hour lease with a countdown, and
  cannot be edited concurrently by someone else.
- An item marked unsure returns to the pool with the note visible; it is not
  counted as closed.
- Closed items are read-only; admins can reopen.
- Every item page has code, check, paper and report evidence, with quote
  badges and links to the full artifacts.
- Exports produce both `review-dataset-*.json` and `decisions-*.json`;
  decisions-only excludes drafts and includes unsure history.
- All quality gates pass; the existing auth tests still pass.
- The UI is responsive, keyboard-usable, and visually consistent with the
  existing shadcn/base-nova app.

---

## 17. Assumptions

- “Export the reviewing to JSON and also the decisions only” means the full
  review dataset plus a compact decisions-only export. Both are implemented.
- Reviewers may browse all included papers and self-select; no assignment table
  is needed. Admin roles are only for data health, releases, reopen, roles and
  exports.
- The 14 included papers have same-commit evidence on both sides; the data
  health page still reports any mismatch from `batch.json`.
- PDFs are public NeurIPS papers; they are still served behind auth.
- The in-memory rate limiter is acceptable because the app is a single
  container behind a reverse proxy, as documented in the README.
- The existing `/dashboard` URL and “Welcome back” heading stay, so the auth
  tests remain valid.
