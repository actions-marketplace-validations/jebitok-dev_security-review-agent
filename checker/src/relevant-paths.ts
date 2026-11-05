import { Manifest } from './types';
import { matchesGlob } from './regression-checker';

// One entry from `git diff --name-status -z -M`
export interface NameStatus {
  status: string;   // A, M, D, T, R100, C75, ...
  path: string;     // path after the change
  oldPath?: string; // for renames and copies
}

// -z output is NUL-separated: "M\0path\0" or "R100\0old\0new\0"
export function parseNameStatus(output: string): NameStatus[] {
  const parts = output.split('\0');
  const entries: NameStatus[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = parts[i++];
      const path = parts[i++];
      entries.push({ status, path, oldPath });
    } else {
      entries.push({ status, path: parts[i++] });
    }
  }
  return entries;
}

// Only the files the checks actually look at. Diffing just these keeps big PRs
// (for example one that deletes thousands of vendored files) cheap.
export function relevantPaths(manifest: Manifest, entries: NameStatus[]): string[] {
  const protectedFiles = new Set(manifest.surfaces.map((s) => s.location.file));
  const routeGlobs = manifest.auto_detect?.route_file_patterns ?? [];
  const wanted = new Set<string>();

  for (const e of entries) {
    if (protectedFiles.has(e.path)) wanted.add(e.path);
    if (e.oldPath && protectedFiles.has(e.oldPath)) {
      // Keep both sides so git still reports it as a rename
      wanted.add(e.oldPath);
      wanted.add(e.path);
    }
    if (e.status === 'A' && routeGlobs.some((g) => matchesGlob(e.path, g))) wanted.add(e.path);
  }
  return [...wanted];
}
