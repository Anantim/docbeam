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
