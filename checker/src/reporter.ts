import { Finding, MovedSurfaceFinding, OutputFormat, RegressionFinding, UnregisteredSurfaceFinding } from './types';
import { buildSuggestion } from './suggest';

const PROJECT_URL = 'https://github.com/jebitok-dev/security-review-agent';

// Inline code for PR comments; file names come from the PR, so a backtick
// in a name must not be able to break out of the code span
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;
// Inside a Markdown table a bare "|" starts a new column, even within code
const cell = (text: string) => code(text).replace(/\|/g, '\\|');

const SEVERITY_EMOJI: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '🚨',
};

function formatRegressionConsole(f: RegressionFinding): string {
  const lines: string[] = [
    `[${f.surface.severity.toUpperCase()}] ${f.surface.id}`,
    `  ${f.surface.description}`,
    `  File: ${f.surface.location.file}`,
  ];
  if (f.missingSignals.length > 0) {
    lines.push(`  Missing signals:`);
    for (const s of f.missingSignals) {
      lines.push(`    - pattern: ${s.pattern}  (${s.context})`);
    }
  }
  if (f.triggeredAbsentSignals.length > 0) {
    lines.push(`  Triggered absent-signal rules:`);
    for (const s of f.triggeredAbsentSignals) {
      lines.push(`    - pattern: ${s.pattern}  (${s.context})`);
    }
  }
  return lines.join('\n');
}

function formatUnregisteredConsole(f: UnregisteredSurfaceFinding): string {
  return [
    `[INFO] Unregistered surface detected`,
    `  File: ${f.file}`,
    `  Reason: ${f.reason}`,
  ].join('\n');
}

function formatMovedConsole(f: MovedSurfaceFinding): string {
  return [
    `[${f.surface.severity.toUpperCase()}] ${f.surface.id}: protected file was moved`,
    `  From: ${f.surface.location.file}`,
    `  To:   ${f.newPath}`,
    `  Control at new location: ${f.controlIntact ? 'intact' : 'MISSING'}`,
    `  Update location.file in the manifest so this surface stays protected.`,
  ].join('\n');
}

function formatConsole(findings: Finding[]): string {
  if (findings.length === 0) {
    return '✓ No security regressions detected.';
  }
  return findings
    .map((f) =>
      f.type === 'regression'
        ? formatRegressionConsole(f)
        : f.type === 'moved-surface'
          ? formatMovedConsole(f)
          : formatUnregisteredConsole(f)
    )
    .join('\n\n');
}

function formatGithubComment(findings: Finding[]): string {
  const regressions = findings.filter((f): f is RegressionFinding => f.type === 'regression');
  const unregistered = findings.filter(
    (f): f is UnregisteredSurfaceFinding => f.type === 'unregistered-surface'
  );
  const moved = findings.filter((f): f is MovedSurfaceFinding => f.type === 'moved-surface');

  const lines: string[] = ['## Security Regression Check\n'];

  if (findings.length === 0) {
    lines.push('✅ No security regressions detected in this PR.');
    lines.push('\n---');
    lines.push(`_Powered by [security-review-agent](${PROJECT_URL})._`);
    return lines.join('\n');
  }

  if (regressions.length > 0) {
    lines.push(
      '> **This PR has modified one or more security-hardened features.**\n' +
      '> A previous developer intentionally added security controls to the code paths below.\n' +
      '> The changes in this PR appear to have removed or weakened those controls.\n' +
      '> **Please have a security-aware reviewer look at this before merging.**'
    );
    lines.push('');

    // Summary table
    lines.push('| Severity | Surface | File | Affected Control |');
    lines.push('|----------|---------|------|-----------------|');
    for (const f of regressions) {
      const emoji = SEVERITY_EMOJI[f.surface.severity] ?? '⚠️';
      const affected = f.missingSignals.length > 0
        ? f.missingSignals.map((s) => cell(s.pattern)).join(', ')
        : f.triggeredAbsentSignals.map((s) => cell(s.pattern)).join(', ');
      lines.push(
        `| ${emoji} ${f.surface.severity.toUpperCase()} | ${cell(f.surface.id)} | ${cell(f.surface.location.file)} | ${affected} |`
      );
    }
    lines.push('');
  }

  // Details per regression
  for (const f of regressions) {
    lines.push(`### \`${f.surface.id}\``);
    lines.push(`**${f.surface.description}**`);
    lines.push('');
    lines.push(`- Control type: \`${f.surface.type}\``);
    lines.push(`- File: \`${f.surface.location.file}\``);

    if (f.missingSignals.length > 0) {
      lines.push('- Security signals no longer detected:');
      for (const s of f.missingSignals) {
        lines.push(`  - \`${s.pattern}\` — ${s.context}`);
      }
    }

    if (f.triggeredAbsentSignals.length > 0) {
      lines.push('- Guard appears to have been disabled:');
      for (const s of f.triggeredAbsentSignals) {
        lines.push(`  - \`${s.pattern}\` — ${s.context}`);
      }
    }

    const suggestion = buildSuggestion(f);
    if (suggestion) {
      lines.push('');
      lines.push('<details>');
      lines.push('<summary>Suggested fix — restore the original control</summary>');
      lines.push('');
      lines.push(suggestion);
      lines.push('');
      lines.push('</details>');
    }

    lines.push('');
  }

  // Protected files that moved: the manifest must follow them
  if (moved.length > 0) {
    lines.push('### Protected files that were moved or renamed');
    lines.push('Update `location.file` in `security-surface.yaml` so these surfaces stay protected.');
    for (const f of moved) {
      const status = f.controlIntact ? 'control still present' : '**control missing** (see above)';
      lines.push(`- ${code(f.surface.id)}: ${code(f.surface.location.file)} → ${code(f.newPath)} — ${status}`);
    }
    lines.push('');
  }

  // Unregistered surfaces
  if (unregistered.length > 0) {
    lines.push('### New files that may need security coverage (info)');
    lines.push(
      'These newly added files look like they expose sensitive surfaces but are not yet declared in `security-surface.yaml`.\n' +
      'Consider adding them to ensure future regressions are caught.'
    );
    for (const f of unregistered) {
      lines.push(`- ${code(f.file)} — ${f.reason}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    '_This check is non-blocking. It flags when code changes affect previously hardened security surfaces._'
  );

  return lines.join('\n');
}

export function formatFindings(findings: Finding[], format: OutputFormat): string {
  return format === 'github-comment' ? formatGithubComment(findings) : formatConsole(findings);
}
