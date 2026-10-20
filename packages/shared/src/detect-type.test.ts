import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { bytesSource, detectFileType, labelOfType, zipEntryNames } from './detect-type.js';

const PDF = 'application/pdf';
const PNG = 'image/png';
const JPEG = 'image/jpeg';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const zip = async (entries: Record<string, string>): Promise<Uint8Array> => {
  const z = new JSZip();
  for (const [name, text] of Object.entries(entries)) z.file(name, text);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};
const docx = () => zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' });
const xlsx = () => zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const pdf = () => new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const detect = (bytes: Uint8Array) => detectFileType(bytesSource(bytes));

describe('what a file is, from its bytes (D-F1-44)', () => {
  it('tells each real type', async () => {
    expect(await detect(pdf())).toBe(PDF);
    expect(await detect(png())).toBe(PNG);
    expect(await detect(jpeg())).toBe(JPEG);
    expect(await detect(await docx())).toBe(DOCX);
    expect(await detect(await xlsx())).toBe(XLSX);
  });

  it('tells a DOCX from an XLSX by the ZIP file list, though both start with the same bytes', async () => {
    const d = await docx();
    const x = await xlsx();
    expect(Array.from(d.slice(0, 4))).toEqual(Array.from(x.slice(0, 4)));
    expect(await detect(d)).not.toBe(await detect(x));
  });

  it('does not look at the name: a file renamed to another allowed type is still what its bytes say', async () => {
    // The function is given bytes only; a "report.docx" that holds a PDF is a PDF.
    expect(await detect(pdf())).toBe(PDF);
    expect(await detect(await xlsx())).toBe(XLSX);
  });

  it('finds nothing in a renamed program, a plain ZIP, text, or a ZIP that is not an Office file', async () => {
    expect(await detect(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 4, 0]))).toBeNull(); // MZ: a Windows program
    expect(await detect(await zip({ 'readme.txt': 'hello', 'data/one.csv': 'a,b' }))).toBeNull();
    expect(await detect(new TextEncoder().encode('just some text, no signature at all'))).toBeNull();
    expect(await detect(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]))).toBeNull(); // ELF
  });

  it('finds nothing in a file that is cut short', async () => {
    expect(await detect(png().slice(0, 5))).toBeNull(); // not even the whole signature
    expect(await detect(jpeg().slice(0, 2))).toBeNull();
    expect(await detect(pdf().slice(0, 4))).toBeNull(); // "%PDF" with no dash
    const d = await docx();
    expect(await detect(d.slice(0, d.length - 30))).toBeNull(); // the end of a ZIP, with its file list, is gone
    expect(await detect(d.slice(0, 40))).toBeNull();
  });

  it('finds nothing in an empty file', async () => {
    expect(await detect(new Uint8Array(0))).toBeNull();
  });

  it('reads the file list of a ZIP that has a comment after the end record', async () => {
    const d = await docx();
    const comment = new TextEncoder().encode('a comment after the directory');
    const withComment = new Uint8Array(d.length + comment.length);
    withComment.set(d);
    withComment.set(comment, d.length);
    // The comment length field of the end record must say so, or the record is not valid; a reader that only looks for the
    // record's signature near the end still finds the entries.
    expect(await zipEntryNames(bytesSource(withComment))).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']));
  });

  it('reads only the ends of the file: the first 8 bytes, the tail, and the file list', async () => {
    const d = await docx();
    const reads: Array<[number, number]> = [];
    await detectFileType({
      size: d.length,
      read: async (start, end) => {
        reads.push([start, end]);
        return d.subarray(start, Math.min(end, d.length));
      },
    });
    expect(reads).toHaveLength(3);
    expect(reads[0]).toEqual([0, 8]);
    expect(reads.every(([s, e]) => e - s <= 66_000)).toBe(true);
  });

  it('gives up on a ZIP64 record, which an Office file does not need', async () => {
    const d = await docx();
    const patched = Uint8Array.from(d);
    const at = patched.length - 22; // the end record (no comment)
    patched.set([0xff, 0xff, 0xff, 0xff], at + 16); // the directory offset: "see the ZIP64 record"
    expect(await detect(patched)).toBeNull();
  });

  it('does not ask for a range of no length: an empty ZIP (just the end record) reads nothing more and is no Office file', async () => {
    const empty = Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    const reads: Array<[number, number]> = [];
    const found = await detectFileType({
      size: empty.length,
      read: async (start, end) => {
        reads.push([start, end]);
        return empty.subarray(start, Math.min(end, empty.length));
      },
    });
    expect(found).toBeNull();
    expect(reads.every(([s, e]) => e > s)).toBe(true);
  });

  it('names the types the way the page does', () => {
    expect(labelOfType(PDF)).toBe('PDF');
    expect(labelOfType(JPEG)).toBe('JPG');
    expect(labelOfType(DOCX)).toBe('DOCX');
    expect(labelOfType('text/plain')).toBeNull();
  });
});
