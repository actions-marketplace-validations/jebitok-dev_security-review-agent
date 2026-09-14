"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFindings = formatFindings;
const suggest_1 = require("./suggest");
const SEVERITY_EMOJI = {
    info: 'ℹ️',
    warning: '⚠️',
    error: '🚨',
};
function formatRegressionConsole(f) {
    const lines = [
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
function formatUnregisteredConsole(f) {
    return [
        `[INFO] Unregistered surface detected`,
        `  File: ${f.file}`,
        `  Reason: ${f.reason}`,
    ].join('\n');
}
function formatConsole(findings) {
    if (findings.length === 0) {
        return '✓ No security regressions detected.';
    }
    return findings
        .map((f) => f.type === 'regression'
        ? formatRegressionConsole(f)
        : formatUnregisteredConsole(f))
        .join('\n\n');
}
function formatGithubComment(findings) {
    const regressions = findings.filter((f) => f.type === 'regression');
    const unregistered = findings.filter((f) => f.type === 'unregistered-surface');
    const lines = ['## Security Regression Check\n'];
    if (findings.length === 0) {
        lines.push('✅ No security regressions detected in this PR.');
        lines.push('\n---');
        lines.push('_Powered by [security-review-agent](../../)._');
        return lines.join('\n');
    }
    if (regressions.length > 0) {
        lines.push('> **This PR has modified one or more security-hardened features.**\n' +
            '> A previous developer intentionally added security controls to the code paths below.\n' +
            '> The changes in this PR appear to have removed or weakened those controls.\n' +
            '> **Please have a security-aware reviewer look at this before merging.**');
        lines.push('');
        // Summary table
        lines.push('| Severity | Surface | File | Affected Control |');
        lines.push('|----------|---------|------|-----------------|');
        for (const f of regressions) {
            const emoji = SEVERITY_EMOJI[f.surface.severity] ?? '⚠️';
            const affected = f.missingSignals.length > 0
                ? f.missingSignals.map((s) => `\`${s.pattern}\``).join(', ')
                : f.triggeredAbsentSignals.map((s) => `\`${s.pattern}\``).join(', ');
            lines.push(`| ${emoji} ${f.surface.severity.toUpperCase()} | \`${f.surface.id}\` | \`${f.surface.location.file}\` | ${affected} |`);
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
        const suggestion = (0, suggest_1.buildSuggestion)(f);
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
    // Unregistered surfaces
    if (unregistered.length > 0) {
        lines.push('### New files that may need security coverage (info)');
        lines.push('These newly added files look like they expose sensitive surfaces but are not yet declared in `security-surface.yaml`.\n' +
            'Consider adding them to ensure future regressions are caught.');
        for (const f of unregistered) {
            lines.push(`- \`${f.file}\` — ${f.reason}`);
        }
        lines.push('');
    }
    lines.push('---');
    lines.push('_This check is non-blocking. It flags when code changes affect previously hardened security surfaces._');
    return lines.join('\n');
}
function formatFindings(findings, format) {
    return format === 'github-comment' ? formatGithubComment(findings) : formatConsole(findings);
}
