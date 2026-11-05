"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyManifest = verifyManifest;
exports.formatVerify = formatVerify;
// readFile returns the file's content, or null when it doesn't exist
function verifyManifest(manifest, readFile) {
    const issues = [];
    for (const surface of manifest.surfaces) {
        const file = surface.location.file;
        const content = readFile(file);
        if (content === null) {
            issues.push({ surfaceId: surface.id, file, problem: 'missing-file' });
            continue;
        }
        for (const signal of surface.control.signals) {
            if (!new RegExp(signal.pattern, 'm').test(content)) {
                issues.push({ surfaceId: surface.id, file, problem: 'signal-not-found', pattern: signal.pattern, context: signal.context });
            }
        }
        for (const signal of surface.control.absent_signals) {
            if (new RegExp(signal.pattern, 'm').test(content)) {
                issues.push({ surfaceId: surface.id, file, problem: 'guard-disabled', pattern: signal.pattern, context: signal.context });
            }
        }
    }
    return { checkedSurfaces: manifest.surfaces.length, issues };
}
const EXPLAIN = {
    'missing-file': 'File not found. Was it moved, renamed or deleted? Update `location.file`.',
    'signal-not-found': 'Pattern no longer matches the code. Either the control was removed, or the code changed and the pattern needs updating.',
    'guard-disabled': 'A "disabled guard" pattern matches right now, so the control looks switched off.',
};
const code = (text) => `\`${text.replace(/`/g, "'")}\``;
function formatVerify(result, format) {
    const { checkedSurfaces, issues } = result;
    if (format === 'console') {
        if (issues.length === 0)
            return `✓ Manifest verified: all ${checkedSurfaces} surfaces match the current code.`;
        return [
            `✗ Manifest has ${issues.length} problem${issues.length === 1 ? '' : 's'} (${checkedSurfaces} surfaces checked):`,
            ...issues.map((i) => `\n[${i.problem}] ${i.surfaceId}\n  File: ${i.file}` +
                (i.pattern ? `\n  Pattern: ${i.pattern}${i.context ? `  (${i.context})` : ''}` : '') +
                `\n  ${EXPLAIN[i.problem]}`),
        ].join('\n');
    }
    const lines = ['## Security Manifest Verification\n'];
    if (issues.length === 0) {
        lines.push(`✅ All ${checkedSurfaces} protected surfaces match the current code.`);
        return lines.join('\n');
    }
    lines.push(`❌ ${issues.length} problem${issues.length === 1 ? '' : 's'} found in \`security-surface.yaml\` (${checkedSurfaces} surfaces checked). Until fixed, these surfaces aren't really protected.\n`);
    for (const i of issues) {
        lines.push(`- **${code(i.surfaceId)}** in ${code(i.file)}` + (i.pattern ? `: pattern ${code(i.pattern)}` : ''));
        lines.push(`  ${EXPLAIN[i.problem]}`);
    }
    return lines.join('\n');
}
