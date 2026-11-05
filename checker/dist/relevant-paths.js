"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNameStatus = parseNameStatus;
exports.relevantPaths = relevantPaths;
const regression_checker_1 = require("./regression-checker");
// -z output is NUL-separated: "M\0path\0" or "R100\0old\0new\0"
function parseNameStatus(output) {
    const parts = output.split('\0');
    const entries = [];
    for (let i = 0; i < parts.length;) {
        const status = parts[i++];
        if (!status)
            continue;
        if (status[0] === 'R' || status[0] === 'C') {
            const oldPath = parts[i++];
            const path = parts[i++];
            entries.push({ status, path, oldPath });
        }
        else {
            entries.push({ status, path: parts[i++] });
        }
    }
    return entries;
}
// Only the files the checks actually look at. Diffing just these keeps big PRs
// (for example one that deletes thousands of vendored files) cheap.
function relevantPaths(manifest, entries) {
    const protectedFiles = new Set(manifest.surfaces.map((s) => s.location.file));
    const routeGlobs = manifest.auto_detect?.route_file_patterns ?? [];
    const wanted = new Set();
    for (const e of entries) {
        if (protectedFiles.has(e.path))
            wanted.add(e.path);
        if (e.oldPath && protectedFiles.has(e.oldPath)) {
            // Keep both sides so git still reports it as a rename
            wanted.add(e.oldPath);
            wanted.add(e.path);
        }
        if (e.status === 'A' && routeGlobs.some((g) => (0, regression_checker_1.matchesGlob)(e.path, g)))
            wanted.add(e.path);
    }
    return [...wanted];
}
