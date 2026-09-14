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
exports.loadManifest = loadManifest;
const fs = __importStar(require("fs"));
const yaml = __importStar(require("js-yaml"));
function validateSurface(s, index) {
    const surface = s;
    const required = ['id', 'description', 'type', 'severity', 'location', 'control'];
    for (const key of required) {
        if (!surface[key]) {
            throw new Error(`Surface at index ${index} is missing required field: "${key}"`);
        }
    }
    const control = surface.control;
    if (!Array.isArray(control.signals)) {
        throw new Error(`Surface "${surface.id}" control.signals must be an array`);
    }
    if (!Array.isArray(control.absent_signals)) {
        throw new Error(`Surface "${surface.id}" control.absent_signals must be an array`);
    }
}
function loadManifest(manifestPath) {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest file not found: ${manifestPath}`);
    }
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = yaml.load(raw);
    if (!parsed.version) {
        throw new Error('Manifest is missing required field: "version"');
    }
    if (!Array.isArray(parsed.surfaces)) {
        throw new Error('Manifest "surfaces" must be an array');
    }
    parsed.surfaces.forEach((s, i) => validateSurface(s, i));
    return parsed;
}
