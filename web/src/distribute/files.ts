import { ALLOWED_FILE_TYPES, contentTypeForFileName, detectFileType, LIMITS, type ByteSource } from '@docbeam/shared/browser';

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

/** The bytes of a file the way the type detector asks for them: a range at a time, never the whole file (D-F1-44). */
export function fileSource(file: Blob): ByteSource {
  return { size: file.size, read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()) };
}

const withArticle = (label: string): string => `${label === 'XLSX' ? 'an' : 'a'} ${label}`;

/**
 * Applies the client-side rules of Step 2.6 to what the user picked: an allowed type by extension (the browser's own `type`
 * can be empty), 1 byte to 1 GiB, and room left under the 100-file cap. Then the file's first bytes (and, for a DOCX or an
 * XLSX, the file list at the end of the ZIP) must show the type its name says (D-F1-44): a renamed program, a PDF named
 * .docx or a cut-off file is not added, and the reason says which.
 */
export async function acceptFiles(existingCount: number, picked: File[]): Promise<PickResult> {
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
      const found = await detectFileType(fileSource(file)).catch(() => null);
      if (found === contentType) {
        accepted.push({ file, contentType });
        room -= 1;
      } else if (found === null) {
        rejected.push({ name: file.name, reason: `This isn't a real ${typeLabel(contentType)} file.` });
      } else {
        const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        rejected.push({ name: file.name, reason: `The contents are ${withArticle(typeLabel(found))}, but the name says ${extension}.` });
      }
    }
  }
  return { accepted, rejected };
}

/** "1.2 MB", with 1 MB = 1,048,576 bytes as the rest of the product counts. */
export function formatSize(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes <= 0) return '0 KB';
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 10 * MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / KB))} KB`;
}

export function typeLabel(contentType: string): 'PDF' | 'DOCX' | 'XLSX' | 'PNG' | 'JPG' {
  return ALLOWED_FILE_TYPES.find((t) => t.contentType === contentType)?.label ?? 'PDF';
}
