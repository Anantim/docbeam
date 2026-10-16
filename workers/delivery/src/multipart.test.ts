import { describe, expect, it } from 'vitest';
import { buildMultipart } from './multipart.js';

async function collect(stream: AsyncIterable<Buffer | Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

describe('buildMultipart', () => {
  it('puts the text fields before the file and keeps the bytes intact', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0xff, 0x00]);
    async function* source() {
      yield bytes.subarray(0, 3);
      yield bytes.subarray(3);
    }
    const { body, contentType } = buildMultipart(
      [
        ['taskId', 't-1'],
        ['name', 'a.pdf'],
      ],
      { fieldName: 'file', fileName: 'a "b".pdf', contentType: 'application/pdf', stream: source() },
    );
    const boundary = /boundary=(.+)$/.exec(contentType)?.[1] as string;
    const out = await collect(body);
    const text = out.toString('latin1');

    expect(text.indexOf('name="taskId"')).toBeLessThan(text.indexOf('name="file"'));
    expect(text.indexOf('name="name"')).toBeLessThan(text.indexOf('name="file"'));
    expect(text).toContain('a _b_.pdf');
    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    const start = out.indexOf('\r\n\r\n', out.indexOf('name="file"')) + 4;
    expect(out.subarray(start, out.length - `\r\n--${boundary}--\r\n`.length).equals(bytes)).toBe(true);
  });
});
