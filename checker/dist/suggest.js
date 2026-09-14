"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSuggestion = buildSuggestion;
function buildAuthSuggestion(finding) {
    const authSignal = finding.missingSignals.find((s) => s.pattern.includes('requireAuth'));
    if (!authSignal)
        return null;
    // Find route lines in removedLines that had the signal
    const signalRegex = /requireAuth/;
    const removedRouteLine = finding.removedLines.find((l) => signalRegex.test(l));
    if (!removedRouteLine)
        return null;
    // Find the corresponding added line (same route, without the middleware)
    const routeRegex = /router\.(get|post|put|delete|patch)\(['"`]([^'"`]+)/;
    const removedMatch = removedRouteLine.match(routeRegex);
    if (!removedMatch)
        return null;
    const routePath = removedMatch[2];
    const addedLine = finding.addedLines.find((l) => l.includes(routePath));
    if (!addedLine)
        return null;
    return [
        '```diff',
        `- ${addedLine.trimStart()}`,
        `+ ${removedRouteLine.trimStart()}`,
        '```',
    ].join('\n');
}
function buildSuggestion(finding) {
    if (finding.surface.type === 'auth') {
        return buildAuthSuggestion(finding);
    }
    return null;
}
