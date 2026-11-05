#!/usr/bin/env node
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const minimist_1 = __importDefault(require("minimist"));
const manifest_1 = require("./manifest");
const diff_parser_1 = require("./diff-parser");
const regression_checker_1 = require("./regression-checker");
const reporter_1 = require("./reporter");
const args = (0, minimist_1.default)(process.argv.slice(2), {
    string: ['manifest', 'base', 'head', 'format', 'output-file', 'fail-on-severity'],
    boolean: ['fail-on-warning'],
    default: {
        manifest: 'security-surface.yaml',
        head: 'HEAD',
        format: 'console',
        'fail-on-warning': false,
    },
});
// Git is always run with an argument list (never through a shell), so file names
// and refs from a pull request can't inject commands.
function git(args) {
    return (0, child_process_1.execFileSync)('git', args, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
    });
}
// Refs come from CI inputs; a leading "-" would be read by git as an option
function assertSafeRef(name, value) {
    if (!value || value.startsWith('-') || /[\s\0]/.test(value)) {
        throw new Error(`Invalid --${name} ref: ${JSON.stringify(value)}`);
    }
}
function runGitDiff(base, head) {
    const from = base || 'HEAD~1';
    const to = base ? head : 'HEAD';
    assertSafeRef('base', from);
    assertSafeRef('head', to);
    // -M: report renames explicitly so moved protected files are caught
    return git(['-c', 'core.quotePath=false', 'diff', '--unified=5', '-M', `${from}..${to}`]);
}
function enrichWithFullContent(changedFiles, head) {
    for (const [filePath, record] of Object.entries(changedFiles)) {
        if (record.status === 'deleted')
            continue;
        try {
            record.fullNewContent = git(['show', `${head}:${filePath}`]);
        }
        catch {
            // file may not exist at HEAD (e.g. renamed) — fallback to heuristic
        }
    }
}
const SEVERITY_RANK = { info: 0, warning: 1, error: 2 };
async function main() {
    const manifestPath = path.resolve(args.manifest);
    const format = args.format;
    const outputFile = args['output-file'];
    // --fail-on-severity <info|warning|error>: exit 1 when a regression at or above
    // that severity is found. --fail-on-warning is kept as a shortcut for "warning".
    const failOn = args['fail-on-severity'] || (args['fail-on-warning'] ? 'warning' : undefined);
    if (failOn && !(failOn in SEVERITY_RANK)) {
        console.error(`Invalid --fail-on-severity: ${failOn} (use info, warning or error)`);
        process.exit(1);
    }
    let manifest;
    try {
        manifest = (0, manifest_1.loadManifest)(manifestPath);
    }
    catch (err) {
        console.error(`Error loading manifest: ${err.message}`);
        process.exit(1);
    }
    let diffOutput;
    try {
        diffOutput = runGitDiff(args.base, args.head);
    }
    catch (err) {
        console.error(`Error running git diff: ${err.message}`);
        process.exit(1);
    }
    const changedFiles = (0, diff_parser_1.parseDiff)(diffOutput);
    enrichWithFullContent(changedFiles, args.head);
    const findings = (0, regression_checker_1.runRegressionCheck)(manifest, changedFiles);
    const formatted = (0, reporter_1.formatFindings)(findings, format);
    if (outputFile) {
        fs.writeFileSync(outputFile, formatted, 'utf-8');
        console.log(`Findings written to ${outputFile}`);
    }
    else {
        console.log(formatted);
    }
    if (failOn) {
        const threshold = SEVERITY_RANK[failOn];
        const blocking = findings.some((f) => f.type === 'regression' && SEVERITY_RANK[f.surface.severity] >= threshold);
        if (blocking) {
            console.error(`Failing: security regression at or above "${failOn}" severity.`);
            process.exit(1);
        }
    }
}
main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
