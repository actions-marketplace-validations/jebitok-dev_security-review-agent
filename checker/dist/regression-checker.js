"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRegressionCheck = runRegressionCheck;
const path = __importStar(require("path"));
const control_detector_1 = require("./control-detector");
function matchesGlob(filePath, pattern) {
    // Simple glob support: convert * and ** to regex equivalents
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§DOUBLE§')
        .replace(/\*/g, '[^/]*')
        .replace(/§DOUBLE§/g, '.*');
    return new RegExp(`^${escaped}$`).test(filePath);
}
function runRegressionCheck(manifest, changedFiles) {
    const findings = [];
    const manifestFiles = new Set(manifest.surfaces.map((s) => s.location.file));
    // Protected files that this PR renamed or moved, keyed by their old path
    const movedTo = new Map();
    for (const [filePath, record] of Object.entries(changedFiles)) {
        if (record.renamedFrom)
            movedTo.set(record.renamedFrom, [filePath, record]);
    }
    // --- Regression check: declared surfaces vs. changed files ---
    for (const surface of manifest.surfaces) {
        const moved = movedTo.get(surface.location.file);
        if (moved) {
            // Check the control at its new location, and ask for the manifest to be updated
            const [newPath, record] = moved;
            const result = (0, control_detector_1.checkControl)(surface, record);
            findings.push({ type: 'moved-surface', surface, newPath, controlIntact: result.intact });
            if (!result.intact) {
                findings.push({
                    type: 'regression',
                    surface,
                    missingSignals: result.missingSignals,
                    triggeredAbsentSignals: result.triggeredAbsentSignals,
                    removedLines: record.removedLines,
                    addedLines: record.addedLines,
                });
            }
            continue;
        }
        const diffRecord = changedFiles[surface.location.file];
        if (!diffRecord)
            continue; // file not touched — no regression possible
        const result = (0, control_detector_1.checkControl)(surface, diffRecord);
        if (!result.intact) {
            const regressionFinding = {
                type: 'regression',
                surface,
                missingSignals: result.missingSignals,
                triggeredAbsentSignals: result.triggeredAbsentSignals,
                removedLines: diffRecord.removedLines,
                addedLines: diffRecord.addedLines,
            };
            findings.push(regressionFinding);
        }
    }
    // --- Auto-detect: new route files not in the manifest ---
    if (!manifest.auto_detect)
        return findings;
    const { route_file_patterns, suspicious_route_patterns } = manifest.auto_detect;
    for (const [filePath, diffRecord] of Object.entries(changedFiles)) {
        if (diffRecord.status !== 'added')
            continue;
        if (manifestFiles.has(filePath))
            continue;
        const matchesRoutePattern = route_file_patterns.some((glob) => matchesGlob(filePath, glob));
        if (!matchesRoutePattern)
            continue;
        const allLines = [...diffRecord.addedLines];
        const fileContent = allLines.join('\n');
        for (const suspiciousPattern of suspicious_route_patterns) {
            const regex = new RegExp(suspiciousPattern.pattern, 'i');
            // Full path too: frameworks like Next.js name every route file "route.ts"
            // and put the URL in the folders (src/app/api/admin/route.ts)
            if (regex.test(fileContent) || regex.test(path.basename(filePath)) || regex.test(`/${filePath}`)) {
                findings.push({
                    type: 'unregistered-surface',
                    file: filePath,
                    reason: suspiciousPattern.reason,
                });
                break; // one finding per new file is enough
            }
        }
    }
    return findings;
}
