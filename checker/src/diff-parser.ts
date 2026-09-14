import { ChangedFiles, DiffRecord, FileStatus } from './types';

export function parseDiff(diffOutput: string): ChangedFiles {
  const result: ChangedFiles = {};
  const lines = diffOutput.split('\n');

  let currentFile: string | null = null;
  let currentRecord: DiffRecord | null = null;

  for (const line of lines) {
    // New file block
    if (line.startsWith('diff --git ')) {
      if (currentFile && currentRecord) {
        result[currentFile] = currentRecord;
      }
      // Extract the b/ path
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = match ? match[1] : null;
      currentRecord = {
        status: 'modified',
        removedLines: [],
        addedLines: [],
      };
      continue;
    }

    if (!currentRecord) continue;

    if (line.startsWith('new file mode')) {
      currentRecord.status = 'added';
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      currentRecord.status = 'deleted';
      continue;
    }

    if (line.startsWith('rename to ')) {
      currentRecord.status = 'renamed';
      continue;
    }

    // Skip diff headers
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) {
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      currentRecord.removedLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentRecord.addedLines.push(line.slice(1));
      continue;
    }
  }

  if (currentFile && currentRecord) {
    result[currentFile] = currentRecord;
  }

  return result;
}

export function getChangedFilePaths(changedFiles: ChangedFiles): string[] {
  return Object.keys(changedFiles);
}
