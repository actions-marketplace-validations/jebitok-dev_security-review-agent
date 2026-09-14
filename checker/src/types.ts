export type SurfaceType = 'auth' | 'rate-limit' | 'upload-validation' | 'mfa' | 'custom';
export type Severity = 'info' | 'warning' | 'error';
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type OutputFormat = 'console' | 'github-comment';

export interface ControlSignal {
  pattern: string;
  context: string;
}

export interface SurfaceControl {
  signals: ControlSignal[];
  absent_signals: ControlSignal[];
}

export interface SurfaceLocation {
  file: string;
  scope: string;
}

export interface Surface {
  id: string;
  description: string;
  type: SurfaceType;
  severity: Severity;
  location: SurfaceLocation;
  control: SurfaceControl;
}

export interface AutoDetectRoutePattern {
  pattern: string;
  reason: string;
}

export interface AutoDetect {
  route_file_patterns: string[];
  suspicious_route_patterns: AutoDetectRoutePattern[];
}

export interface Manifest {
  version: string;
  surfaces: Surface[];
  auto_detect?: AutoDetect;
}

export interface DiffRecord {
  status: FileStatus;
  removedLines: string[];
  addedLines: string[];
  fullNewContent?: string;
}

export type ChangedFiles = Record<string, DiffRecord>;

export interface ControlCheckResult {
  intact: boolean;
  missingSignals: ControlSignal[];
  triggeredAbsentSignals: ControlSignal[];
}

export type FindingType = 'regression' | 'unregistered-surface';

export interface RegressionFinding {
  type: 'regression';
  surface: Surface;
  missingSignals: ControlSignal[];
  triggeredAbsentSignals: ControlSignal[];
  removedLines: string[];
  addedLines: string[];
}

export interface UnregisteredSurfaceFinding {
  type: 'unregistered-surface';
  file: string;
  reason: string;
}

export type Finding = RegressionFinding | UnregisteredSurfaceFinding;
