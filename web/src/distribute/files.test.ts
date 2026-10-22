import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { acceptFiles, formatSize } from './files.js';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const zip = async (entries: Record<string, string>): Promise<Uint8Array> => {
  const z = new JSZip();
  for (const [name, body] of Object.entries(entries)) z.file(name, body);
  return z.generateAsync({ type: 'uint8array' });
};
const PDF = text('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
const docx = () => zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' });
const xlsx = () => zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });

const file = (name: string, bytes: Uint8Array, size = bytes.length): File => {
  const f = new File([new Uint8Array(bytes)], name);
  if (size !== bytes.length) Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('acceptFiles', () => {
  it('accepts the five allowed types by extension, in any case, when the contents agree', async () => {
    const picked = [file('a.pdf', PDF), file('b.DOCX', await docx()), file('c.xlsx', await xlsx()), file('d.png', PNG), file('e.JPG', JPEG), file('f.jpeg', JPEG)];
    const { accepted, rejected } = await acceptFiles([],picked);
    expect(accepted.map((a) => a.file.name)).toEqual(['a.pdf', 'b.DOCX', 'c.xlsx', 'd.png', 'e.JPG', 'f.jpeg']);
    expect(rejected).toEqual([]);
    expect(accepted[1]?.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('refuses other types, empty files and files over 1 GB, each with a reason', async () => {
    const { accepted, rejected } = await acceptFiles([],[file('setup.exe', EXE), file('empty.pdf', new Uint8Array(0)), file('huge.pdf', PDF, 1024 ** 3 + 1), file('ok.pdf', PDF, 1024 ** 3)]);
    expect(accepted.map((a) => a.file.name)).toEqual(['ok.pdf']);
    expect(rejected.map((r) => r.name)).toEqual(['setup.exe', 'empty.pdf', 'huge.pdf']);
    expect(rejected[0]?.reason).toContain('not allowed');
    expect(rejected[1]?.reason).toBe('The file is empty.'); // the existing message, not a "not a real PDF"
    expect(rejected[2]?.reason).toContain('1 GB');
  });

  it('stops at 100 files counting the ones already on the page', async () => {
    const picked = Array.from({ length: 5 }, (_, i) => file(`f${i}.pdf`, PDF));
    const { accepted, rejected } = await acceptFiles(Array.from({ length: 97 }, (_, i) => ({ name: `old${i}.pdf`, sizeBytes: 1, lastModified: i })), picked);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.reason).toContain('at most 100 files');
  });

  describe('the contents must be what the name says (D-F1-44)', () => {
    it('refuses a file renamed to another allowed type, and says what it really is', async () => {
      const { accepted, rejected } = await acceptFiles([],[file('report.docx', PDF), file('table.pdf', await xlsx()), file('photo.png', JPEG), file('scan.jpg', PNG), file('letter.xlsx', await docx()), file('memo.pdf', await docx())]);
      expect(accepted).toEqual([]);
      expect(rejected.map((r) => r.reason)).toEqual([
        'The contents are a PDF, but the name says .docx.',
        'The contents are an XLSX, but the name says .pdf.',
        'The contents are a JPG, but the name says .png.',
        'The contents are a PNG, but the name says .jpg.',
        'The contents are a DOCX, but the name says .xlsx.',
        'The contents are a DOCX, but the name says .pdf.',
      ]);
    });

    it('refuses content that is no allowed type at all: a renamed program, text, a plain ZIP', async () => {
      const { accepted, rejected } = await acceptFiles([],[file('setup.pdf', EXE), file('notes.docx', text('plain text')), file('data.xlsx', await zip({ 'a.csv': '1,2' })), file('fake.png', text('not a picture'))]);
      expect(accepted).toEqual([]);
      expect(rejected.map((r) => r.reason)).toEqual([
        "This isn't a real PDF file.",
        "This isn't a real DOCX file.",
        "This isn't a real XLSX file.",
        "This isn't a real PNG file.",
      ]);
    });

    it('refuses a truncated file', async () => {
      const d = await docx();
      const { rejected } = await acceptFiles([],[file('cut.png', PNG.slice(0, 4)), file('cut.docx', d.slice(0, d.length - 30)), file('cut.pdf', PDF.slice(0, 3))]);
      expect(rejected.map((r) => r.reason)).toEqual(["This isn't a real PNG file.", "This isn't a real DOCX file.", "This isn't a real PDF file."]);
    });

    it('keeps the message "The file is empty." for an empty file of any allowed name', async () => {
      const { rejected } = await acceptFiles([],[file('a.pdf', new Uint8Array(0)), file('b.docx', new Uint8Array(0))]);
      expect(rejected.map((r) => r.reason)).toEqual(['The file is empty.', 'The file is empty.']);
    });

    it('reads ranges, not the whole file: the size can be a gigabyte while only the ends are read', async () => {
      let read = 0;
      const big = file('big.pdf', PDF, 1024 ** 3);
      const slice = big.slice.bind(big);
      big.slice = (start?: number, end?: number) => {
        read += (end ?? 0) - (start ?? 0);
        return slice(start, end);
      };
      const { accepted } = await acceptFiles([],[big]);
      expect(accepted).toHaveLength(1);
      expect(read).toBeLessThanOrEqual(8);
    });
  });
});

describe('acceptFiles: the same file again, and long names (D-F1-81)', () => {
  const at = (name: string, modified: number, bytes = PDF): File => new File([new Uint8Array(bytes)], name, { lastModified: modified });

  it('does not add a file that is already in the list (same name, size and time), with the shared sentence', async () => {
    const { accepted, rejected } = await acceptFiles([{ name: 'a.pdf', sizeBytes: PDF.length, lastModified: 5 }], [at('a.pdf', 5), at('a.pdf', 6)]);
    expect(rejected).toEqual([{ name: 'a.pdf', reason: 'This file is already in the list.' }]);
    expect(accepted.map((a) => a.file.lastModified)).toEqual([6]); // a different time is a different file
  });

  it('does not add the same file twice in one pick', async () => {
    const { accepted, rejected } = await acceptFiles([], [at('a.pdf', 5), at('a.pdf', 5)]);
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => r.reason)).toEqual(['This file is already in the list.']);
  });

  it('allows the same name with different contents', async () => {
    const other = text('%PDF-1.7\n2 0 obj\n<<>>\nendobj\n%%EOF\n%more\n');
    const { accepted, rejected } = await acceptFiles([], [at('a.pdf', 5), at('a.pdf', 5, other)]);
    expect(accepted).toHaveLength(2);
    expect(rejected).toEqual([]);
  });

  it('refuses a name longer than 255 characters, and takes one of exactly 255', async () => {
    const ok = `${'a'.repeat(251)}.pdf`;
    const long = `${'a'.repeat(252)}.pdf`;
    const { accepted, rejected } = await acceptFiles([], [at(ok, 1), at(long, 2)]);
    expect(accepted.map((a) => a.file.name)).toEqual([ok]);
    expect(rejected).toEqual([{ name: long, reason: 'The name is longer than 255 characters.' }]);
  });
});

describe('formatSize', () => {
  it('uses KB, MB and GB with 1,024 steps', () => {
    expect(formatSize(0)).toBe('0 KB');
    expect(formatSize(300)).toBe('1 KB');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1.5 * 1024 ** 2)).toBe('1.5 MB');
    expect(formatSize(120 * 1024 ** 2)).toBe('120 MB');
    expect(formatSize(1024 ** 3)).toBe('1.0 GB');
  });
});
