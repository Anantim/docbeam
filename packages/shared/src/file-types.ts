/** The content-type allow-list (ADR-002) and the first bytes each type must start with (Step 1.3). */
const ZIP = [0x50, 0x4b, 0x03, 0x04];

const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
  // DOCX and XLSX are both ZIP files; the first bytes cannot tell them apart (D-M1-5).
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
};

export function isAllowedType(contentType: string): boolean {
  return Object.hasOwn(SIGNATURES, contentType);
}

/** How many bytes are needed before the signature can be checked. */
export const SIGNATURE_BYTES = 8;

export function matchesSignature(contentType: string, head: Uint8Array): boolean {
  const signature = SIGNATURES[contentType];
  if (!signature || head.length < signature.length) return false;
  return signature.every((byte, i) => head[i] === byte);
}

export interface AllowedFileType {
  contentType: string;
  /** Short label shown on the file tile. */
  label: 'PDF' | 'DOCX' | 'XLSX' | 'PNG' | 'JPG';
  /** Lower-case, with the dot. */
  extensions: string[];
}

/** For the picker: the browser's own `file.type` can be empty, so the extension decides. */
export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { contentType: 'application/pdf', label: 'PDF', extensions: ['.pdf'] },
  { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'DOCX', extensions: ['.docx'] },
  { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'XLSX', extensions: ['.xlsx'] },
  { contentType: 'image/png', label: 'PNG', extensions: ['.png'] },
  { contentType: 'image/jpeg', label: 'JPG', extensions: ['.jpg', '.jpeg'] },
];

/** The allowed content type for a file name, or null when the extension is not on the list. */
export function contentTypeForFileName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot).toLowerCase();
  return ALLOWED_FILE_TYPES.find((t) => t.extensions.includes(extension))?.contentType ?? null;
}
