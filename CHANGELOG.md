# Changelog

## 1.1.0

**Security**
- Fixed command injection: file paths from a pull request were passed to a shell (`git show ${head}:${file}`). A file named `$(…).ts` could run commands in CI. Git now runs with an argument list, and refs starting with `-` are rejected.
- PR comments: file names can no longer break out of their code formatting.

**New**
- Reusable GitHub Action (`action.yml`): `uses: jebitok-dev/security-review-agent@v1`.
- `--fail-on-severity <info|warning|error>`, as the README described (`--fail-on-warning` still works).
- Moved or renamed protected files are reported, and their control is checked at the new path.
- Auto-detect matches the full file path, so folder-based routes (Next.js `src/app/api/admin/route.ts`) are caught.
- Manifest validation: unknown severities and invalid regex patterns fail early with a clear message.
- Report is also written to the job summary, so pull requests from forks still get it.

**Fixes**
- PR comment table: `|` in patterns no longer splits table columns.
- `demo/02-regression.patch` was corrupt (blank context lines had lost their leading space), so the README quick start failed at `git apply`. Regenerated, and `.editorconfig` / `.gitattributes` now stop editors trimming patch files.
- The "Powered by" link in comments pointed at the wrong repo when used elsewhere.

**Housekeeping**
- Stopped tracking `node_modules` (about 6,700 files) and added a `.gitignore`.
- New `Tests` workflow builds and tests the checker on every PR.

## 1.0.0
- Initial release.
