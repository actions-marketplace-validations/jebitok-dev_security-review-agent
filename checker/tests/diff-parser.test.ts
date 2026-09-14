import * as fs from 'fs';
import * as path from 'path';
import { parseDiff } from '../src/diff-parser';

const sampleDiff = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'sample.diff'),
  'utf-8'
);

describe('parseDiff', () => {
  it('identifies the correct file path', () => {
    const result = parseDiff(sampleDiff);
    expect(Object.keys(result)).toContain('fixture-app/src/routes/admin.ts');
  });

  it('marks the file as modified', () => {
    const result = parseDiff(sampleDiff);
    expect(result['fixture-app/src/routes/admin.ts'].status).toBe('modified');
  });

  it('captures removed lines', () => {
    const result = parseDiff(sampleDiff);
    const removed = result['fixture-app/src/routes/admin.ts'].removedLines;
    expect(removed.some((l) => l.includes('requireAuth'))).toBe(true);
  });

  it('captures added lines', () => {
    const result = parseDiff(sampleDiff);
    const added = result['fixture-app/src/routes/admin.ts'].addedLines;
    expect(added.some((l) => l.includes("router.get('/dashboard'"))).toBe(true);
  });

  it('returns empty object for empty diff', () => {
    expect(parseDiff('')).toEqual({});
  });
});
