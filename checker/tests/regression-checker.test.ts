import { runRegressionCheck } from '../src/regression-checker';
import { Manifest, ChangedFiles } from '../src/types';

const manifest: Manifest = {
  version: '1',
  surfaces: [
    {
      id: 'admin-auth',
      description: 'Admin requires auth',
      type: 'auth',
      severity: 'warning',
      location: { file: 'fixture-app/src/routes/admin.ts', scope: 'route-handler' },
      control: {
        signals: [
          { pattern: 'requireAuth', context: 'must be present' },
        ],
        absent_signals: [],
      },
    },
  ],
  auto_detect: {
    route_file_patterns: ['fixture-app/src/routes/*.ts'],
    suspicious_route_patterns: [
      { pattern: '/admin', reason: 'Admin path not in manifest' },
    ],
  },
};

describe('runRegressionCheck', () => {
  it('returns no findings when manifest file is not in changedFiles', () => {
    const changed: ChangedFiles = {
      'fixture-app/src/routes/api.ts': {
        status: 'modified',
        removedLines: [],
        addedLines: [],
      },
    };
    expect(runRegressionCheck(manifest, changed)).toHaveLength(0);
  });

  it('returns a regression finding when signal is removed', () => {
    const changed: ChangedFiles = {
      'fixture-app/src/routes/admin.ts': {
        status: 'modified',
        removedLines: ['router.get(\'/dashboard\', requireAuth, handler);'],
        addedLines: ['router.get(\'/dashboard\', handler);'],
        fullNewContent: "router.get('/dashboard', handler);",
      },
    };
    const findings = runRegressionCheck(manifest, changed);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('regression');
  });

  it('detects unregistered surface in a new route file', () => {
    const changed: ChangedFiles = {
      'fixture-app/src/routes/reports.ts': {
        status: 'added',
        removedLines: [],
        addedLines: ["router.get('/admin/reports', handler);"],
      },
    };
    const findings = runRegressionCheck(manifest, changed);
    expect(findings.some((f) => f.type === 'unregistered-surface')).toBe(true);
  });

  it('does not flag new route files that are already in the manifest', () => {
    const changed: ChangedFiles = {
      'fixture-app/src/routes/admin.ts': {
        status: 'added',
        removedLines: [],
        addedLines: ["router.get('/dashboard', requireAuth, handler);"],
        fullNewContent: "router.get('/dashboard', requireAuth, handler);",
      },
    };
    const findings = runRegressionCheck(manifest, changed);
    // Should have no unregistered-surface finding (may have regression finding if signals missing)
    expect(findings.every((f) => f.type !== 'unregistered-surface')).toBe(true);
  });
});
