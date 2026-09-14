# Security Review Agent

A non-blocking GitHub Action that catches security regressions in pull requests cases where a previously hardened route, endpoint, or feature silently loses its security control during a routine code change.

> **Background**: This project is the implementation companion to the Substack article [Designing a Security-First Code Review Agent](https://jebit.substack.com/p/designing-a-security-first-code-review). The article covers the "why" in depth this repo is the working "how".

---

## The problem it solves

Security hardening rarely gets removed on purpose. It erodes.

A senior developer adds `requireAuth` middleware to every admin route. Three months later, a junior developer picks up a ticket to refactor the admin dashboard UI. The code change is legitimate but in the process of restructuring the route file, the middleware is accidentally dropped. No line in the diff looks obviously wrong. Static analysis won't catch it. The test suite won't catch it. The PR reviewer is focused on the UI logic, not the security wiring.

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
| `type` | Human grouping does not affect detection logic, just how findings are labelled. |
| `severity` | `warning` posts a comment but does not fail CI. `error` fails CI if `--fail-on-severity error` is passed to the checker. |
| `location.file` | Relative path from repo root to the file being guarded. The checker skips a surface if this file is not in the PR diff. |
| `control.signals` | Array of regex patterns that must **all** match somewhere in the file after the change. Losing any one triggers a finding. |
| `control.absent_signals` | Regex patterns that, if found in the added lines of the diff, indicate a guard was intentionally disabled. |

### Why multiple signals?

A single regex like `requireAuth` would match a comment or a string literal. Requiring two signals one for presence, one for structural wiring reduces false positives significantly:

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
      reason: "Admin-like route path with no manifest entry add to security-surface.yaml"
    - pattern: "/upload|/import|/ingest"
      reason: "Upload-like route path with no manifest entry"
```

This catches the case where a developer adds a new `/admin/reports.ts` route but never registers it in the manifest.

---

## GitHub Action setup

Add this file to `.github/workflows/security-check.yml`:

```yaml
name: Security Regression Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  contents: read

jobs:
  security-regression:
    name: Detect Security Regressions
    runs-on: ubuntu-latest

    steps:
      - name: Checkout with full history
        uses: actions/checkout@v4
        with:
          fetch-depth: 0        # required the checker needs git history for diffs

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install checker
        run: npm ci --prefix checker

      - name: Build checker
        run: npm run build --prefix checker

      - name: Run security regression checker
        id: checker
        run: |
          node checker/dist/index.js \
            --manifest security-surface.yaml \
            --base ${{ github.event.pull_request.base.sha }} \
            --head ${{ github.event.pull_request.head.sha }} \
            --format github-comment \
            --output-file /tmp/security-findings.md
        continue-on-error: true   # non-blocking: CI passes even when regressions are found

      - name: Post or update PR comment
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('/tmp/security-findings.md', 'utf8');
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find(c =>
              c.user.login === 'github-actions[bot]' &&
              c.body.includes('## Security Regression Check')
            );
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

**Key design decisions:**

- `fetch-depth: 0` is not optional. Without full history, `git diff <base-sha>..<head-sha>` will fail with "unknown revision".
- `continue-on-error: true` makes the check non-blocking. The comment does the communicating; merging is still a team decision.
- The comment upsert pattern (check for existing bot comment, update if found) prevents a PR with 10 pushes from getting 10 separate bot comments.
- No secrets needed `actions/github-script` uses the automatically-provided `GITHUB_TOKEN`.

### Making it blocking for critical surfaces

If you want regressions on a specific surface to fail CI, set `severity: error` in the manifest for that surface and pass `--fail-on-severity error` to the checker (remove `continue-on-error: true` from the Action step). The checker exits `1` when any finding meets or exceeds the specified severity.

---

## Project layout

```
.
├── security-surface.yaml         # the manifest declare protected surfaces here
├── .github/
│   └── workflows/
│       └── security-check.yml   # the GitHub Action
├── checker/                      # the diff-checker (TypeScript)
│   ├── src/
│   │   ├── index.ts              # CLI entry point
│   │   ├── manifest.ts           # manifest loader + validator
│   │   ├── diff-parser.ts        # parses git diff output
│   │   ├── control-detector.ts   # tests signal presence in a diff record
│   │   ├── regression-checker.ts # orchestrates checks across all surfaces
│   │   ├── reporter.ts           # formats findings for console or PR comment
│   │   ├── suggest.ts            # builds suggested code-diff blocks
│   │   └── types.ts              # shared TypeScript types
│   └── tests/
│       ├── diff-parser.test.ts
│       ├── control-detector.test.ts
│       └── regression-checker.test.ts
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
    ├── 01-secure-state.patch     # establishes all controls intact
    └── 02-regression.patch       # drops requireAuth from admin routes
```

---

## Quick start (local demo)

```bash
# 1. Install
npm install --prefix checker
npm install --prefix fixture-app

# 2. Build the checker
npm run build --prefix checker

# 3. Init a git repo (required: the checker runs git diff)
git init && git add . && git commit -m "initial: secure state"

# 4. Apply the regression patch
git apply demo/02-regression.patch
git add fixture-app/src/routes/admin.ts && git commit -m "refactor: admin routes"

# 5. Run the checker against the last commit
node checker/dist/index.js --manifest security-surface.yaml
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

3. **Verify locally** by running the checker against a diff where the control is intact it should produce no findings.

4. **Test the detection** by temporarily removing the control in a branch, running the checker, and confirming it fires.

That's it. The manifest is the only thing you need to maintain.

---

## What this is not

This is a **code-review-time** tool. It detects regressions in static code. It does not:

- Monitor runtime behavior or detect a compromised account acting maliciously
- Replace a WAF, intrusion detection system, or runtime security monitoring
- Guarantee security it only knows about surfaces you've declared in the manifest

Think of it as institutional memory for security decisions, made machine-checkable.
