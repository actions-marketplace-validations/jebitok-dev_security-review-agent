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
    string: ['manifest', 'base', 'head', 'format', 'output-file'],
    boolean: ['fail-on-warning'],
    default: {
        manifest: 'security-surface.yaml',
        head: 'HEAD',
        format: 'console',
        'fail-on-warning': false,
    },
});
function runGitDiff(base, head) {
    const cmd = base
        ? `git diff --unified=5 ${base}..${head}`
        : `git diff --unified=5 HEAD~1..HEAD`;
    return (0, child_process_1.execSync)(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function enrichWithFullContent(changedFiles, head) {
    for (const [filePath, record] of Object.entries(changedFiles)) {
        if (record.status === 'deleted')
            continue;
        try {
            const content = (0, child_process_1.execSync)(`git show ${head}:${filePath}`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            record.fullNewContent = content;
        }
        catch {
            // file may not exist at HEAD (e.g. renamed) — fallback to heuristic
        }
    }
}
async function main() {
    const manifestPath = path.resolve(args.manifest);
    const format = args.format;
    const outputFile = args['output-file'];
    const failOnWarning = args['fail-on-warning'];
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
    const hasRegressions = findings.some((f) => f.type === 'regression');
    if (failOnWarning && hasRegressions) {
        process.exit(1);
    }
}
main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
