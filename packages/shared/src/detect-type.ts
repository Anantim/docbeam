import { ALLOWED_FILE_TYPES } from './file-types.js';

/**
 * Finds out what a file really is from its bytes, never from its name (D-F1-44). The same code runs in the browser, when a
 * file is added, and in the Upload Events Lambda, after the upload; each gives it a way to read a range of the file.
 *
 *  - PDF, PNG and JPEG are told by their first bytes.
 *  - DOCX and XLSX are ZIP files, so the first bytes only say "ZIP". The ZIP's file list is read from the central directory
 *    at the end of the file (no unzipping, no new dependency): `word/document.xml` means DOCX, `xl/workbook.xml` XLSX.
 * The answer is one of the five allowed content types, or null when the file is none of them (a program, a plain ZIP, a
 * file cut short).
 */
export interface ByteSource {
  /** The size of the file in bytes. */
  size: number;
  /** The bytes from `start` up to, not including, `end`. Past the end of the file it returns what there is. */
  read(start: number, end: number): Promise<Uint8Array>;
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];

const PDF_TYPE = 'application/pdf';
const PNG_TYPE = 'image/png';
const JPEG_TYPE = 'image/jpeg';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The end-of-central-directory record is 22 bytes and may be followed by a comment of up to 65,535 bytes. */
const EOCD_SEARCH = 22 + 65_535;
/** A central directory larger than this is not read: a real Office file has a few dozen entries. */
const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: number[]): boolean => bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
const u16 = (b: Uint8Array, at: number): number => (b[at] as number) | ((b[at + 1] as number) << 8);
const u32 = (b: Uint8Array, at: number): number => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

/** The names of the entries of a ZIP file, read from its central directory; null when it is not a ZIP this code can read. */
export async function zipEntryNames(source: ByteSource): Promise<string[] | null> {
  if (source.size < 22) return null;
  const tailStart = Math.max(0, source.size - EOCD_SEARCH);
  const tail = await source.read(tailStart, source.size);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const entries = u16(tail, at + 10);
  const size = u32(tail, at + 12);
  const offset = u32(tail, at + 16);
  // 0xFFFF and 0xFFFFFFFF mean "see the ZIP64 record": not something an Office file needs.
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null;
  if (size > MAX_DIRECTORY_BYTES || offset + size > source.size) return null;
  if (size === 0) return entries === 0 ? [] : null; // an empty directory: nothing to read (a range with no length would read the whole object)
  const directory = await source.read(offset, offset + size);
  if (directory.length < size) return null;

  const names: string[] = [];
  const decoder = new TextDecoder('utf-8');
  let pos = 0;
  while (pos + 46 <= directory.length && u32(directory, pos) === 0x02014b50) {
    const nameLength = u16(directory, pos + 28);
    const extraLength = u16(directory, pos + 30);
    const commentLength = u16(directory, pos + 32);
    if (pos + 46 + nameLength > directory.length) return null;
    names.push(decoder.decode(directory.subarray(pos + 46, pos + 46 + nameLength)));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return names.length === entries ? names : null;
}

/** One of the five allowed content types, or null. */
export async function detectFileType(source: ByteSource): Promise<string | null> {
  if (source.size <= 0) return null;
  const head = await source.read(0, 8);
  if (startsWith(head, PDF)) return PDF_TYPE;
  if (startsWith(head, PNG)) return PNG_TYPE;
  if (startsWith(head, JPEG)) return JPEG_TYPE;
  if (startsWith(head, ZIP_LOCAL) || startsWith(head, ZIP_EMPTY)) {
    const names = await zipEntryNames(source);
    if (names === null) return null;
    if (names.includes('word/document.xml')) return DOCX_TYPE;
    if (names.includes('xl/workbook.xml')) return XLSX_TYPE;
  }
  return null;
}

/** The short label of an allowed content type, "PDF", "DOCX", "XLSX", "PNG" or "JPG". */
export function labelOfType(contentType: string): 'PDF' | 'DOCX' | 'XLSX' | 'PNG' | 'JPG' | null {
  return ALLOWED_FILE_TYPES.find((t) => t.contentType === contentType)?.label ?? null;
}

/** A `ByteSource` over bytes already in memory, for tests and small files. */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (start, end) => bytes.subarray(start, Math.min(end, bytes.length)) };
}
