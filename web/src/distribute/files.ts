import { ALLOWED_FILE_TYPES, contentTypeForFileName, LIMITS } from '@docbeam/shared/browser';

export interface Rejected {
  name: string;
  reason: string;
}

export interface Accepted {
  file: File;
  contentType: string;
}

export interface PickResult {
  accepted: Accepted[];
  rejected: Rejected[];
}

/**
 * Applies the client-side rules of Step 2.6 to what the user picked: an allowed type (by extension, since the
 * browser's own `type` can be empty), 1 byte to 1 GiB, and room left under the 100-file cap.
 */
export function acceptFiles(existingCount: number, picked: File[]): PickResult {
  const accepted: Accepted[] = [];
  const rejected: Rejected[] = [];
  let room = LIMITS.maxFilesPerJob - existingCount;
  for (const file of picked) {
    const contentType = contentTypeForFileName(file.name);
    if (contentType === null) {
      rejected.push({ name: file.name, reason: 'This type is not allowed. Use PDF, DOCX, XLSX, PNG or JPG.' });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'The file is empty.' });
    } else if (file.size > LIMITS.maxFileBytes) {
      rejected.push({ name: file.name, reason: 'The file is over 1 GB.' });
    } else if (room <= 0) {
      rejected.push({ name: file.name, reason: `A distribution can have at most ${LIMITS.maxFilesPerJob} files.` });
    } else {
      accepted.push({ file, contentType });
      room -= 1;
    }
  }
  return { accepted, rejected };
}

/** "1.2 MB", with 1 MB = 1,048,576 bytes as the rest of the product counts. */
export function formatSize(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 10 * MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / KB))} KB`;
}

export function typeLabel(contentType: string): 'PDF' | 'DOCX' | 'XLSX' | 'PNG' | 'JPG' {
  return ALLOWED_FILE_TYPES.find((t) => t.contentType === contentType)?.label ?? 'PDF';
}
