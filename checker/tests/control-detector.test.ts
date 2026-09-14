import { checkControl } from '../src/control-detector';
import { Surface, DiffRecord } from '../src/types';

const authSurface: Surface = {
  id: 'admin-auth',
  description: 'Admin auth',
  type: 'auth',
  severity: 'warning',
  location: { file: 'fixture-app/src/routes/admin.ts', scope: 'route-handler' },
  control: {
    signals: [
      { pattern: 'requireAuth', context: 'must be present' },
      { pattern: 'router\\.(get|post).*requireAuth', context: 'must be wired' },
    ],
    absent_signals: [
      { pattern: '//\\s*requireAuth', context: 'commented out' },
    ],
  },
};

describe('checkControl', () => {
  it('reports intact when fullNewContent contains all signals', () => {
    const record: DiffRecord = {
      status: 'modified',
      removedLines: [],
      addedLines: [],
      fullNewContent: "import { requireAuth } from '../middleware/auth';\nrouter.get('/dashboard', requireAuth, handler);",
    };
    const result = checkControl(authSurface, record);
    expect(result.intact).toBe(true);
    expect(result.missingSignals).toHaveLength(0);
  });

  it('detects missing signal when fullNewContent lacks requireAuth', () => {
    const record: DiffRecord = {
      status: 'modified',
      removedLines: [],
      addedLines: [],
      fullNewContent: "router.get('/dashboard', handler);",
    };
    const result = checkControl(authSurface, record);
    expect(result.intact).toBe(false);
    expect(result.missingSignals.length).toBeGreaterThan(0);
  });

  it('uses heuristic when fullNewContent is absent: removed and not re-added', () => {
    const record: DiffRecord = {
      status: 'modified',
      removedLines: ["router.get('/dashboard', requireAuth, handler);"],
      addedLines: ["router.get('/dashboard', handler);"],
    };
    const result = checkControl(authSurface, record);
    expect(result.intact).toBe(false);
  });

  it('reports intact via heuristic when signal not in removedLines at all', () => {
    const record: DiffRecord = {
      status: 'modified',
      removedLines: ["// some comment removed"],
      addedLines: ["// new comment"],
    };
    const result = checkControl(authSurface, record);
    expect(result.intact).toBe(true);
  });

  it('flags deleted file as not intact', () => {
    const record: DiffRecord = {
      status: 'deleted',
      removedLines: [],
      addedLines: [],
    };
    const result = checkControl(authSurface, record);
    expect(result.intact).toBe(false);
    expect(result.missingSignals).toEqual(authSurface.control.signals);
  });

  it('triggers absent_signal when commented-out guard appears in addedLines', () => {
    const record: DiffRecord = {
      status: 'modified',
      removedLines: [],
      addedLines: ["// requireAuth commented out for debugging"],
      fullNewContent: "router.get('/dashboard', handler); // requireAuth commented out for debugging",
    };
    const result = checkControl(authSurface, record);
    expect(result.triggeredAbsentSignals.length).toBeGreaterThan(0);
  });
});
