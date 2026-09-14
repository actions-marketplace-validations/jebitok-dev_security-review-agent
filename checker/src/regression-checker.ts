import * as path from 'path';
import { Manifest, ChangedFiles, Finding, RegressionFinding } from './types';
import { checkControl } from './control-detector';

function matchesGlob(filePath: string, pattern: string): boolean {
  // Simple glob support: convert * and ** to regex equivalents
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLE§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLE§/g, '.*');
  return new RegExp(`^${escaped}$`).test(filePath);
}

export function runRegressionCheck(manifest: Manifest, changedFiles: ChangedFiles): Finding[] {
  const findings: Finding[] = [];
  const manifestFiles = new Set(manifest.surfaces.map((s) => s.location.file));

  // --- Regression check: declared surfaces vs. changed files ---
  for (const surface of manifest.surfaces) {
    const diffRecord = changedFiles[surface.location.file];
    if (!diffRecord) continue; // file not touched — no regression possible

    const result = checkControl(surface, diffRecord);
    if (!result.intact) {
      const regressionFinding: RegressionFinding = {
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
  if (!manifest.auto_detect) return findings;

  const { route_file_patterns, suspicious_route_patterns } = manifest.auto_detect;

  for (const [filePath, diffRecord] of Object.entries(changedFiles)) {
    if (diffRecord.status !== 'added') continue;
    if (manifestFiles.has(filePath)) continue;

    const matchesRoutePattern = route_file_patterns.some((glob) =>
      matchesGlob(filePath, glob)
    );
    if (!matchesRoutePattern) continue;

    const allLines = [...diffRecord.addedLines];
    const fileContent = allLines.join('\n');

    for (const suspiciousPattern of suspicious_route_patterns) {
      const regex = new RegExp(suspiciousPattern.pattern, 'i');
      if (regex.test(fileContent) || regex.test(path.basename(filePath))) {
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
