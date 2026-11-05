#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import minimist from 'minimist';
import { loadManifest } from './manifest';
import { parseDiff } from './diff-parser';
import { parseNameStatus, relevantPaths } from './relevant-paths';
import { runRegressionCheck } from './regression-checker';
import { formatFindings } from './reporter';
import { formatVerify, verifyManifest } from './verify';
import { ChangedFiles, Manifest, OutputFormat, Severity } from './types';

const args = minimist(process.argv.slice(2), {
  string: ['manifest', 'base', 'head', 'format', 'output-file', 'fail-on-severity'],
  boolean: ['fail-on-warning', 'verify-manifest'],
  default: {
    manifest: 'security-surface.yaml',
    head: 'HEAD',
    format: 'console',
    'fail-on-warning': false,
  },
});

// Git is always run with an argument list (never through a shell), so file names
// and refs from a pull request can't inject commands.
function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Refs come from CI inputs; a leading "-" would be read by git as an option
function assertSafeRef(name: string, value: string): void {
  if (!value || value.startsWith('-') || /[\s\0]/.test(value)) {
    throw new Error(`Invalid --${name} ref: ${JSON.stringify(value)}`);
  }
}

function runGitDiff(manifest: Manifest, base: string | undefined, head: string): string {
  const from = base || 'HEAD~1';
  const to = base ? head : 'HEAD';
  assertSafeRef('base', from);
  assertSafeRef('head', to);
  const range = `${from}..${to}`;

  // 1. List what changed (names only, small even for huge PRs).
  //    -M reports renames so moved protected files are caught.
  const names = parseNameStatus(git(['-c', 'core.quotePath=false', 'diff', '--name-status', '-z', '-M', range]));

  // 2. Full diff only for the files the checks need
  const paths = relevantPaths(manifest, names);
  if (paths.length === 0) return '';
  const pathspecs = paths.map((p) => `:(literal)${p}`); // no glob/magic from file names
  return git(['-c', 'core.quotePath=false', 'diff', '--unified=5', '-M', range, '--', ...pathspecs]);
}

function enrichWithFullContent(changedFiles: ChangedFiles, head: string): void {
  for (const [filePath, record] of Object.entries(changedFiles)) {
    if (record.status === 'deleted') continue;
    try {
      record.fullNewContent = git(['show', `${head}:${filePath}`]);
    } catch {
      // file may not exist at HEAD (e.g. renamed) — fallback to heuristic
    }
  }
}

// Exit codes: 0 = ok, 1 = regression at/above --fail-on-severity (or, with
// --verify-manifest, problems in the manifest), 2 = the checker couldn't run
const EXIT_REGRESSION = 1;
const EXIT_ERROR = 2;

// Reads a repo file for --verify-manifest; null when it doesn't exist
function readRepoFile(file: string): string | null {
  const root = process.cwd();
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep)) return null; // stay inside the repository
  try {
    return fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf-8') : null;
  } catch {
    return null;
  }
}

function writeOutput(text: string, outputFile: string | undefined): void {
  if (outputFile) {
    fs.writeFileSync(outputFile, text, 'utf-8');
    console.log(`Report written to ${outputFile}`);
  } else {
    console.log(text);
  }
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

async function main(): Promise<void> {
  const manifestPath = path.resolve(args.manifest);
  const format = args.format as OutputFormat;
  const outputFile = args['output-file'] as string | undefined;
  // --fail-on-severity <info|warning|error>: exit 1 when a regression at or above
  // that severity is found. --fail-on-warning is kept as a shortcut for "warning".
  const failOn = (args['fail-on-severity'] as string | undefined) || (args['fail-on-warning'] ? 'warning' : undefined);
  if (failOn && !(failOn in SEVERITY_RANK)) {
    console.error(`Invalid --fail-on-severity: ${failOn} (use info, warning or error)`);
    process.exit(EXIT_ERROR);
  }

  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    console.error(`Error loading manifest: ${(err as Error).message}`);
    process.exit(EXIT_ERROR);
  }

  // --verify-manifest: check the manifest against the current code (no PR needed)
  if (args['verify-manifest']) {
    const result = verifyManifest(manifest, readRepoFile);
    writeOutput(formatVerify(result, format), outputFile);
    if (outputFile) console.log(formatVerify(result, 'console'));
    process.exit(result.issues.length ? EXIT_REGRESSION : 0);
  }

  let diffOutput: string;
  try {
    diffOutput = runGitDiff(manifest, args.base, args.head);
  } catch (err) {
    console.error(`Error running git diff: ${(err as Error).message}`);
    process.exit(EXIT_ERROR);
  }

  const changedFiles = parseDiff(diffOutput);
  enrichWithFullContent(changedFiles, args.head);

  const findings = runRegressionCheck(manifest, changedFiles);
  const formatted = formatFindings(findings, format);

  if (outputFile) {
    fs.writeFileSync(outputFile, formatted, 'utf-8');
    console.log(`Findings written to ${outputFile}`);
  } else {
    console.log(formatted);
  }

  if (failOn) {
    const threshold = SEVERITY_RANK[failOn as Severity];
    const blocking = findings.some(
      (f) => f.type === 'regression' && SEVERITY_RANK[f.surface.severity] >= threshold
    );
    if (blocking) {
      console.error(`Failing: security regression at or above "${failOn}" severity.`);
      process.exit(EXIT_REGRESSION);
    }
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(EXIT_ERROR);
});
