import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { parseDiff } from '../src/diff-parser';
import { runRegressionCheck } from '../src/regression-checker';
import { loadManifest } from '../src/manifest';
import { formatFindings } from '../src/reporter';
import { parseNameStatus, relevantPaths } from '../src/relevant-paths';
import { ChangedFiles, Manifest } from '../src/types';

const manifest: Manifest = {
  version: '1',
  surfaces: [
    {
      id: 'contact-rate-limit',
      description: 'Contact form is rate limited',
      type: 'rate-limit',
      severity: 'error',
      location: { file: 'src/app/api/contact/route.ts', scope: 'route-handler' },
      control: { signals: [{ pattern: 'rateLimited\\(', context: 'must be called' }], absent_signals: [] },
    },
  ],
  auto_detect: {
    route_file_patterns: ['src/app/api/**/route.ts'],
    suspicious_route_patterns: [{ pattern: '/admin|/dashboard', reason: 'Admin-like route' }],
  },
};

describe('renamed protected files', () => {
  it('parses the old path of a rename', () => {
    const diff = [
      'diff --git a/src/app/api/contact/route.ts b/src/app/api/enquiry/route.ts',
      'similarity index 90%',
      'rename from src/app/api/contact/route.ts',
      'rename to src/app/api/enquiry/route.ts',
    ].join('\n');
    const files = parseDiff(diff);
    expect(files['src/app/api/enquiry/route.ts']).toMatchObject({
      status: 'renamed',
      renamedFrom: 'src/app/api/contact/route.ts',
    });
  });

  it('flags a move even when the control survived', () => {
    const changed: ChangedFiles = {
      'src/app/api/enquiry/route.ts': {
        status: 'renamed', renamedFrom: 'src/app/api/contact/route.ts',
        removedLines: [], addedLines: [], fullNewContent: 'if (rateLimited(ip)) return;',
      },
    };
    const findings = runRegressionCheck(manifest, changed);
    expect(findings).toEqual([
      expect.objectContaining({ type: 'moved-surface', newPath: 'src/app/api/enquiry/route.ts', controlIntact: true }),
    ]);
  });

  it('reports a regression when the control was lost in the move', () => {
    const changed: ChangedFiles = {
      'src/app/api/enquiry/route.ts': {
        status: 'renamed', renamedFrom: 'src/app/api/contact/route.ts',
        removedLines: ['if (rateLimited(ip)) return;'], addedLines: [], fullNewContent: 'export async function POST() {}',
      },
    };
    const types = runRegressionCheck(manifest, changed).map((f) => f.type);
    expect(types).toEqual(['moved-surface', 'regression']);
  });
});

describe('auto-detect for folder-based routes (Next.js)', () => {
  it('flags a new admin route even when its code never mentions "admin"', () => {
    const changed: ChangedFiles = {
      'src/app/api/admin/route.ts': {
        status: 'added', removedLines: [], addedLines: ['export async function GET() { return Response.json({}) }'],
      },
    };
    expect(runRegressionCheck(manifest, changed)).toEqual([
      expect.objectContaining({ type: 'unregistered-surface', file: 'src/app/api/admin/route.ts' }),
    ]);
  });

  it('ignores ordinary new routes', () => {
    const changed: ChangedFiles = {
      'src/app/api/health/route.ts': { status: 'added', removedLines: [], addedLines: ['export function GET() {}'] },
    };
    expect(runRegressionCheck(manifest, changed)).toHaveLength(0);
  });
});

describe('manifest validation', () => {
  const write = (yaml: string) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-')), 'm.yaml');
    fs.writeFileSync(file, yaml);
    return file;
  };
  const surface = (severity: string, pattern: string) => `
version: "1"
surfaces:
  - id: s1
    description: d
    type: auth
    severity: ${severity}
    location: { file: a.ts, scope: x }
    control:
      signals: [{ pattern: "${pattern}", context: c }]
      absent_signals: []
`;

  it('rejects an unknown severity', () => {
    expect(() => loadManifest(write(surface('high', 'requireAuth')))).toThrow(/severity must be one of/);
  });

  it('rejects a broken regex with the surface name', () => {
    expect(() => loadManifest(write(surface('error', 'requireAuth('))))
      .toThrow(/Invalid regex in surface "s1"/);
  });
});

describe('PR comment formatting', () => {
  it('keeps file names with backticks inside their code span', () => {
    const out = formatFindings([{ type: 'unregistered-surface', file: 'src/app/api/a`b/route.ts', reason: 'r' }], 'github-comment');
    expect(out).toContain("`src/app/api/a'b/route.ts`");
  });
});

describe('CLI against a real git repository', () => {
  const cli = path.resolve(__dirname, '../src/index.ts');
  const run = (cwd: string, extra: string[] = []) =>
    spawnSync(process.execPath, ['-r', require.resolve('ts-node/register'), cli, '--manifest', 'm.yaml', ...extra], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', TS_NODE_PROJECT: path.resolve(__dirname, '../tsconfig.json') },
    });

  const repo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-repo-'));
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    g('init', '-q');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 'test');
    g('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'm.yaml'), `
version: "1"
surfaces:
  - id: guard
    description: Guarded route keeps its check
    type: auth
    severity: error
    location: { file: guarded.ts, scope: x }
    control:
      signals: [{ pattern: "requireAuth", context: must stay }]
      absent_signals: []
`);
    fs.writeFileSync(path.join(dir, 'guarded.ts'), 'requireAuth();\n');
    g('add', '.');
    g('commit', '-qm', 'base');
    return { dir, g };
  };

  it('treats a malicious file name as data, not a command', () => {
    const { dir, g } = repo();
    fs.writeFileSync(path.join(dir, '$(touch PWNED).ts'), 'x\n');
    g('add', '.');
    g('commit', '-qm', 'evil name');
    const res = run(dir);
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'PWNED'))).toBe(false);
  }, 30000);

  it('rejects refs that git would read as options', () => {
    const { dir } = repo();
    const res = run(dir, ['--base=--output=/tmp/x', '--head', 'HEAD']);
    expect(res.status).toBe(2); // 2 = the checker couldn't run
    expect(res.stderr).toMatch(/Invalid --base ref/);
  }, 30000);

  it('fails CI only at or above --fail-on-severity', () => {
    const { dir, g } = repo();
    fs.writeFileSync(path.join(dir, 'guarded.ts'), 'open();\n');
    g('commit', '-qam', 'drop the guard');
    expect(run(dir, ['--fail-on-severity', 'error']).status).toBe(1);
    expect(run(dir).status).toBe(0); // non-blocking by default
  }, 30000);
});

describe('PR comment table', () => {
  it('escapes "|" in patterns so the table keeps its columns', () => {
    const out = formatFindings([{
      type: 'regression',
      surface: {
        id: 'admin', description: 'd', type: 'auth', severity: 'warning',
        location: { file: 'a.ts', scope: 'x' },
        control: { signals: [], absent_signals: [] },
      },
      missingSignals: [{ pattern: 'router\\.(get|post)', context: 'c' }],
      triggeredAbsentSignals: [], removedLines: [], addedLines: [],
    }], 'github-comment');
    const row = out.split('\n').find((l) => l.includes('WARNING'))!;
    expect(row).toContain('`router\\.(get\\|post)`');
    expect(row.split(/(?<!\\)\|/).length).toBe(6); // 4 columns + 2 outer edges
  });
});

describe('only diffing the files that matter', () => {
  it('parses NUL-separated name-status output, including renames', () => {
    const out = 'M\0src/a.ts\0R097\0old/b.ts\0new/b.ts\0D\0vendor/x.js\0';
    expect(parseNameStatus(out)).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'R097', path: 'new/b.ts', oldPath: 'old/b.ts' },
      { status: 'D', path: 'vendor/x.js' },
    ]);
  });

  it('keeps protected files, both sides of their renames, and new route files', () => {
    const picked = relevantPaths(manifest, [
      { status: 'M', path: 'src/app/api/contact/route.ts' },
      { status: 'A', path: 'src/app/api/admin/route.ts' },
      { status: 'D', path: 'node_modules/huge/index.js' },
      { status: 'M', path: 'README.md' },
    ]);
    expect(picked.sort()).toEqual(['src/app/api/admin/route.ts', 'src/app/api/contact/route.ts']);
    expect(relevantPaths(manifest, [
      { status: 'R100', oldPath: 'src/app/api/contact/route.ts', path: 'src/app/api/enquiry/route.ts' },
    ]).sort()).toEqual(['src/app/api/contact/route.ts', 'src/app/api/enquiry/route.ts']);
  });
});

describe('big pull requests', () => {
  it('handles a PR that deletes a huge unrelated file (the 89 MB node_modules case)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checker-big-'));
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@e.com'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'm.yaml'), 'version: "1"\nsurfaces: []\n');
    // ~70 MB of text, more than the old single-diff approach could read
    const line = 'vendored line of text that nobody needs to review\n';
    fs.writeFileSync(path.join(dir, 'vendor.txt'), line.repeat(Math.ceil(70e6 / line.length)));
    g('add', '.'); g('commit', '-qm', 'base');
    g('rm', '-q', 'vendor.txt'); g('commit', '-qm', 'drop vendored file');
    const res = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register'), path.resolve(__dirname, '../src/index.ts'), '--manifest', 'm.yaml'], {
      cwd: dir, encoding: 'utf-8',
      env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', TS_NODE_PROJECT: path.resolve(__dirname, '../tsconfig.json') },
    });
    expect(res.stderr).not.toMatch(/ENOBUFS/);
    expect(res.status).toBe(0);
  }, 60000);
});
