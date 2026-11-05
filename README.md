# Security Review Agent

A non-blocking GitHub Action that catches security regressions in pull requests: cases where a previously hardened route, endpoint, or feature silently loses its security control during a routine code change.

> **Background**: This project is the implementation companion to the Substack article [Designing a Security-First Code Review Agent](https://jebit.substack.com/p/designing-a-security-first-code-review). The article covers the "why" in depth; this repo is the working "how".

---

## Contents

- [The problem it solves](#the-problem-it-solves)
- [How it works](#how-it-works)
- [The manifest: `security-surface.yaml`](#the-manifest-security-surfaceyaml)
  - [Field reference](#field-reference)
  - [Why multiple signals?](#why-multiple-signals)
  - [Auto-detect: coverage gaps](#auto-detect-coverage-gaps)
  - [Moved or renamed files](#moved-or-renamed-files)
- [GitHub Action setup](#github-action-setup)
  - [Keeping the manifest honest: `mode: verify`](#keeping-the-manifest-honest-mode-verify)
  - [Running it without the Action](#running-it-without-the-action)
  - [Versions](#versions)
- [Example: Next.js (App Router)](#example-nextjs-app-router)
- [Project layout](#project-layout)
- [Quick start (local demo)](#quick-start-local-demo)
- [Fixture app — curl examples](#fixture-app--curl-examples)
- [Extending to your own codebase](#extending-to-your-own-codebase)
- [What this is not](#what-this-is-not)

---

## The problem it solves

Security hardening rarely gets removed on purpose. It erodes.

A senior developer adds `requireAuth` middleware to every admin route. Three months later, a junior developer picks up a ticket to refactor the admin dashboard UI. The code change is legitimate, but in the process of restructuring the route file, the middleware is accidentally dropped. No line in the diff looks obviously wrong. Static analysis won't catch it. The test suite won't catch it. The PR reviewer is focused on the UI logic, not the security wiring.

This tool catches that. It keeps a versioned record of which files are security-hardened and what controls they require, then checks every PR diff against that record.

---

## How it works

```
PR opened / updated
       │
       ▼
┌──────────────────────┐
│  git diff base..head │  ← what changed in this PR
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────┐
│  security-surface.yaml       │  ← your versioned manifest of
│  (manifest of protected      │    protected files + required controls
│   surfaces)                  │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Checker                     │
│  · For each declared surface │
│    whose file was changed:   │
│    – are the required signals│
│      still present?          │
│    – were any guards         │
│      commented out?          │
│  · For moved/renamed files:  │
│    – was a protected file    │
│      moved out from under    │
│      the manifest?           │
│  · For new route files:      │
│    – do they match sensitive │
│      path patterns?          │
│    – are they in the manifest│
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  PR comment posted           │  ← updated on every push,
│  (non-blocking by default)   │    never spams with duplicates
└──────────────────────────────┘
```

When a regression is found, the PR comment says:

> **This PR has modified one or more security-hardened features.**
> A previous developer intentionally added security controls to the code paths below.
> The changes in this PR appear to have removed or weakened those controls.
> **Please have a security-aware reviewer look at this before merging.**

For auth regressions, it also includes a suggested code diff so the fix is one click away.

A second mode, [`verify`](#keeping-the-manifest-honest-mode-verify), runs on pushes to `main` and confirms the manifest itself still matches the code, so a typo or outdated pattern can't leave a surface silently unprotected.

> **Using this in your own project?**
> The fixture app in this repo is just a demo. The only file you need to edit is `security-surface.yaml` — replace the example entries with your own file paths and security controls. The checker, the Action, and everything else works without any code changes. See [Extending to your own codebase](#extending-to-your-own-codebase) below.

---

## The manifest: `security-surface.yaml`

This is the most important file in the project. It is a versioned list of every file that has been deliberately security-hardened, and what controls it must have.

```yaml
version: "1"

surfaces:
  - id: admin-dashboard-auth          # stable ID used in PR comments
    description: "Admin dashboard routes require authentication"
    type: auth                        # auth | rate-limit | upload-validation | mfa | custom
    severity: warning                 # info | warning | error
    location:
      file: src/routes/admin.ts       # path relative to repo root
      scope: route-handler
    control:
      signals:                        # ALL of these must still be present after the change
        - pattern: "requireAuth"
          context: "requireAuth middleware must be imported and referenced"
        - pattern: "router\\.(get|post|put|delete|patch|use).*requireAuth"
          context: "requireAuth must be wired into at least one route definition"
      absent_signals:                 # if ANY of these appear, flag it
        - pattern: "//\\s*requireAuth"
          context: "Commented-out auth guard detected"
```

### Field reference

| Field | Purpose |
|-------|---------|
| `id` | Stable identifier shown in PR comments. Use kebab-case, be descriptive. |
| `type` | Human grouping. It doesn't affect detection, just how findings are labelled. |
| `severity` | `info`, `warning` or `error`. Every finding is commented; the job only fails for regressions at or above `fail-on-severity` (not set = never fails). |
| `location.file` | Relative path from repo root to the file being guarded. A PR check skips the surface if the PR doesn't touch this file; verify mode always checks it. |
| `control.signals` | Array of regex patterns that must **all** match somewhere in the file after the change. Losing any one triggers a finding. |
| `control.absent_signals` | Regex patterns that indicate a guard was disabled (e.g. commented out). A PR check looks for them in the lines the PR adds; verify mode looks in the whole file. |

The manifest is validated when it loads: missing fields, an unknown `severity` or an invalid regex fail straight away with a message naming the surface.

### Why multiple signals?

A single regex like `requireAuth` would match a comment or a string literal. Requiring two signals (one for presence, one for structural wiring) reduces false positives significantly:

```yaml
signals:
  - pattern: "requireAuth"                              # is it imported / referenced?
  - pattern: "router\\.get.*requireAuth"               # is it actually on a route?
```

Both must be true for the control to be considered intact.

### Auto-detect: coverage gaps

The manifest also supports an `auto_detect` section that flags newly added route files that match sensitive path patterns but aren't yet in the manifest:

```yaml
auto_detect:
  route_file_patterns:
    - "src/routes/*.ts"
  suspicious_route_patterns:
    - pattern: "/admin|/dashboard|/manage"
      reason: "Admin-like route path with no manifest entry: add to security-surface.yaml"
    - pattern: "/upload|/import|/ingest"
      reason: "Upload-like route path with no manifest entry"
```

This catches the case where a developer adds a new `/admin/reports.ts` route but never registers it in the manifest. Patterns are matched against the new file's content, its name and its full path.

### Moved or renamed files

If a PR renames or moves a protected file, the checker reports it (and still checks the control at the new location), so the manifest can be updated. Without this, moving a file would quietly take it out of the manifest's protection.

---

## GitHub Action setup

Use it from any repository as a GitHub Action. Add `.github/workflows/security-check.yml`:

```yaml
name: Security Regression Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write   # to post the summary comment
  contents: read

jobs:
  security-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0   # required: the checker diffs the PR's base and head commits

      - uses: jebitok-dev/security-review-agent@v1
        with:
          manifest: security-surface.yaml   # default
          # fail-on-severity: error         # optional: fail CI on regressions at this level
```

Then add a `security-surface.yaml` at the root of your repo (see [the manifest](#the-manifest-security-surfaceyaml) and the [Next.js example](#example-nextjs-app-router)).

| Input | Default | Purpose |
|-------|---------|---------|
| `mode` | `check` | `check` reviews a pull request. `verify` confirms the manifest still matches the current code (see below). |
| `manifest` | `security-surface.yaml` | Path to your manifest |
| `fail-on-severity` | _(empty)_ | `info`, `warning` or `error`. Fail the job when a regression at or above this level is found. Empty means never fail. |
| `comment` | `true` | Post or update one summary comment on the PR |
| `github-token` | `github.token` | Token used for the comment |

**How it behaves:**

- **Non-blocking by default.** The comment does the communicating; merging stays a team decision. Set `fail-on-severity: error` and mark critical surfaces `severity: error` to block merges on those only.
- **One comment per PR.** Later pushes update the same comment instead of adding new ones.
- **Always a report.** The findings are also written to the job summary, so forks (whose tokens can't comment) still get them.
- **No secrets needed.** It uses the automatic `GITHUB_TOKEN`.

### Keeping the manifest honest: `mode: verify`

The PR check only looks at files a PR touches, so a typo in a pattern, or code that changed long ago, can leave a surface quietly unprotected. Verify mode catches that: it confirms every listed file exists, every pattern still matches, and no "disabled guard" pattern is present. Run it on every push to `main`:

```yaml
name: Verify Security Manifest
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: jebitok-dev/security-review-agent@v1
        with:
          mode: verify
```

It fails with a list of the surfaces to fix. Locally: `node checker/dist/index.js --manifest security-surface.yaml --verify-manifest` (exit `1` when something needs fixing).

### Running it without the Action

```bash
npm ci --prefix checker && npm run build --prefix checker
node checker/dist/index.js --manifest security-surface.yaml --base origin/main --head HEAD
# add --fail-on-severity error to exit 1 on error-level regressions
```

| Exit code | Meaning |
|-----------|---------|
| `0` | Passed (findings may still be reported) |
| `1` | A regression at or above `--fail-on-severity`, or, with `--verify-manifest`, problems in the manifest |
| `2` | The checker couldn't run (bad manifest, missing git history, invalid ref) |

### Versions

- `@v1` follows the latest 1.x release, so you get fixes automatically. Pin an exact version (`@v1.2.0`) or a commit SHA if you prefer to update deliberately.
- Runs on GitHub-hosted runners as-is. Self-hosted runners need runner v2.327.1 or newer (Node 24 actions).
- Release notes: [CHANGELOG.md](CHANGELOG.md).

---

## Example: Next.js (App Router)

Next.js puts the URL in folder names and every API file is called `route.ts`, so auto-detect matches patterns against the full file path:

```yaml
version: "1"
surfaces:
  - id: contact-form-spam-protection
    description: Contact form keeps its spam trap, timing check and rate limit
    type: rate-limit
    severity: error
    location:
      file: src/app/api/contact/route.ts
      scope: route-handler
    control:
      signals:
        - pattern: "body\\.hp"
          context: "Hidden spam-trap field must still be checked"
        - pattern: "MIN_FILL_MS"
          context: "Too-fast submissions must still be rejected"
        - pattern: "rateLimited\\("
          context: "Per-visitor rate limit must still be applied"
      absent_signals:
        - pattern: "//\\s*if \\(rateLimited"
          context: "Commented-out rate limit"

auto_detect:
  route_file_patterns:
    - "src/app/api/**/route.ts"
  suspicious_route_patterns:
    - pattern: "/admin|/dashboard|/internal"
      reason: "Admin-like route with no manifest entry"
    - pattern: "/webhook|/upload|/import"
      reason: "Inbound-data route with no manifest entry"
```

A new `src/app/api/admin/route.ts` is flagged even if its code never mentions "admin".

---

## Project layout

```
.
├── action.yml                    # the reusable GitHub Action (uses: jebitok-dev/security-review-agent@v1)
├── security-surface.yaml         # the manifest: declare protected surfaces here
├── .github/
│   └── workflows/
│       ├── security-check.yml   # runs this repo's own action on every PR
│       ├── verify-manifest.yml  # verifies this repo's manifest on every push to main
│       └── test.yml             # builds and runs the checker's tests
├── checker/                      # the diff-checker (TypeScript)
│   ├── src/
│   │   ├── index.ts              # CLI entry point
│   │   ├── manifest.ts           # manifest loader + validator
│   │   ├── diff-parser.ts        # parses git diff output
│   │   ├── relevant-paths.ts     # picks which changed files need a full diff
│   │   ├── control-detector.ts   # tests signal presence in a diff record
│   │   ├── regression-checker.ts # orchestrates checks across all surfaces
│   │   ├── reporter.ts           # formats findings for console or PR comment
│   │   ├── suggest.ts            # builds suggested code-diff blocks
│   │   ├── verify.ts             # --verify-manifest / mode: verify
│   │   └── types.ts              # shared TypeScript types
│   └── tests/
│       ├── diff-parser.test.ts
│       ├── control-detector.test.ts
│       ├── regression-checker.test.ts
│       └── hardening.test.ts     # renames, Next.js routes, big PRs, verify mode, CLI safety
├── fixture-app/                  # small Express app used for demo
│   └── src/
│       ├── middleware/
│       │   ├── auth.ts           # requireAuth
│       │   ├── rateLimiter.ts    # express-rate-limit
│       │   └── uploadValidator.ts # multer with type + size guards
│       └── routes/
│           ├── admin.ts          # GET /admin/dashboard - guarded by requireAuth
│           ├── api.ts            # POST /api/data - guarded by rateLimiter
│           └── upload.ts         # POST /upload - guarded by uploadValidator
└── demo/
    ├── 01-secure-state.patch     # a note describing the secure baseline (not an applyable patch)
    └── 02-regression.patch       # drops requireAuth from admin routes
```

`CHANGELOG.md` lists what changed in each release.

---

## Quick start (local demo)

```bash
# 1. Clone, install and build
git clone https://github.com/jebitok-dev/security-review-agent.git && cd security-review-agent
npm ci --prefix checker && npm ci --prefix fixture-app
npm run build --prefix checker

# 2. Confirm the manifest matches the code (the secure baseline)
node checker/dist/index.js --manifest security-surface.yaml --verify-manifest
# ✓ Manifest verified: all 3 surfaces match the current code.

# 3. Simulate a PR that drops the auth guard, on a throwaway branch
git switch -c demo-regression
git apply demo/02-regression.patch
git commit -am "refactor: admin routes"

# 4. Check it like a PR against main
node checker/dist/index.js --manifest security-surface.yaml --base main --head HEAD

# 5. Clean up
git switch main && git branch -D demo-regression
```

Expected output:
```
[WARNING] admin-dashboard-auth
  Admin dashboard routes require authentication
  File: fixture-app/src/routes/admin.ts
  Missing signals:
    - pattern: requireAuth  (requireAuth middleware must be imported and referenced)
    - pattern: router\.(get|post|...).*requireAuth  (requireAuth must be wired into at least one route definition)
```

---

## Fixture app — curl examples

Start the app first:

```bash
cd fixture-app
API_SECRET=dev123 npm run dev
```

**Health check**
```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

**Admin dashboard — with valid auth**
```bash
curl http://localhost:3000/admin/dashboard \
  -H "Authorization: Bearer dev123"
# {"message":"Admin dashboard","userId":null}
```

**Admin dashboard — without auth (expect 401)**
```bash
curl http://localhost:3000/admin/dashboard
# {"error":"Unauthorized"}
```

**POST to rate-limited API endpoint**
```bash
curl -X POST http://localhost:3000/api/data \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
# {"received":{"hello":"world"}}
```

**File upload — valid file**
```bash
curl -X POST http://localhost:3000/upload \
  -F "document=@/path/to/file.pdf"
# {"message":"File accepted","filename":"file.pdf","size":12345,"mimetype":"application/pdf"}
```

**File upload — rejected type (expect 500 with multer error)**
```bash
curl -X POST http://localhost:3000/upload \
  -F "document=@/path/to/file.exe"
# Error: Unsupported file type: application/octet-stream
```

---

## Extending to your own codebase

1. **Identify a hardened file**: any file where a past developer added a security control: auth middleware, rate limiting, OTP check, CORS restriction, etc.

2. **Add a surface entry** to `security-surface.yaml` with the file path and one or two signal patterns that uniquely identify the control.

3. **Verify locally**: run `node checker/dist/index.js --manifest security-surface.yaml --verify-manifest`. It should report that every surface matches the current code.

4. **Test the detection**: on a throwaway branch, remove the control and commit, then run `node checker/dist/index.js --manifest security-surface.yaml --base main --head HEAD` and confirm it reports the surface.

That's it. The manifest is the only thing you need to maintain.

---

## What this is not

This is a **code-review-time** tool. It detects regressions in static code. It does not:

- Monitor runtime behavior or detect a compromised account acting maliciously
- Replace a WAF, intrusion detection system, or runtime security monitoring
- Guarantee security: it only knows about surfaces you've declared in the manifest

Think of it as institutional memory for security decisions, made machine-checkable.
