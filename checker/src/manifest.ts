import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Manifest, Surface } from './types';

function validateSurface(s: unknown, index: number): asserts s is Surface {
  const surface = s as Record<string, unknown>;
  const required = ['id', 'description', 'type', 'severity', 'location', 'control'];
  for (const key of required) {
    if (!surface[key]) {
      throw new Error(`Surface at index ${index} is missing required field: "${key}"`);
    }
  }
  const control = surface.control as Record<string, unknown>;
  if (!Array.isArray(control.signals)) {
    throw new Error(`Surface "${surface.id}" control.signals must be an array`);
  }
  if (!Array.isArray(control.absent_signals)) {
    throw new Error(`Surface "${surface.id}" control.absent_signals must be an array`);
  }
}

export function loadManifest(manifestPath: string): Manifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = yaml.load(raw) as Record<string, unknown>;

  if (!parsed.version) {
    throw new Error('Manifest is missing required field: "version"');
  }
  if (!Array.isArray(parsed.surfaces)) {
    throw new Error('Manifest "surfaces" must be an array');
  }

  parsed.surfaces.forEach((s, i) => validateSurface(s, i));

  return parsed as unknown as Manifest;
}
