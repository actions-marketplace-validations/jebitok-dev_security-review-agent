#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import minimist from 'minimist';
import { loadManifest } from './manifest';
import { parseDiff } from './diff-parser';
import { runRegressionCheck } from './regression-checker';
import { formatFindings } from './reporter';
import { ChangedFiles, OutputFormat } from './types';

const args = minimist(process.argv.slice(2), {
  string: ['manifest', 'base', 'head', 'format', 'output-file'],
  boolean: ['fail-on-warning'],
  default: {
    manifest: 'security-surface.yaml',
    head: 'HEAD',
    format: 'console',
    'fail-on-warning': false,
  },
});

function runGitDiff(base: string, head: string): string {
  const cmd = base
    ? `git diff --unified=5 ${base}..${head}`
    : `git diff --unified=5 HEAD~1..HEAD`;
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function enrichWithFullContent(changedFiles: ChangedFiles, head: string): void {
  for (const [filePath, record] of Object.entries(changedFiles)) {
    if (record.status === 'deleted') continue;
    try {
      const content = execSync(`git show ${head}:${filePath}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      record.fullNewContent = content;
    } catch {
      // file may not exist at HEAD (e.g. renamed) — fallback to heuristic
    }
  }
}

async function main(): Promise<void> {
  const manifestPath = path.resolve(args.manifest);
  const format = args.format as OutputFormat;
  const outputFile = args['output-file'] as string | undefined;
  const failOnWarning = args['fail-on-warning'] as boolean;

  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    console.error(`Error loading manifest: ${(err as Error).message}`);
    process.exit(1);
  }

  let diffOutput: string;
  try {
    diffOutput = runGitDiff(args.base, args.head);
  } catch (err) {
    console.error(`Error running git diff: ${(err as Error).message}`);
    process.exit(1);
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

  const hasRegressions = findings.some((f) => f.type === 'regression');
  if (failOnWarning && hasRegressions) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
