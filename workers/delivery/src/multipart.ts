import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

export interface MultipartBody {
  body: Readable;
  contentType: string;
}

/** Text fields cannot contain these in a header value or a name. */
const clean = (value: string): string => value.replace(/[\r\n"]/g, '_');

/**
 * A multipart/form-data body that streams. The text fields come first, then the file (D-M1-6), so the
 * platform can check membership and the repeat before it reads a byte of a possible 1 GB file.
 */
export function buildMultipart(
  fields: Array<[string, string]>,
  file: { fieldName: string; fileName: string; contentType: string; stream: AsyncIterable<Uint8Array> },
): MultipartBody {
  const boundary = `----docbeam${randomBytes(12).toString('hex')}`;
  const head = fields
    .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${clean(name)}"\r\n\r\n${value}\r\n`)
    .join('');
  const fileHead =
    `--${boundary}\r\nContent-Disposition: form-data; name="${clean(file.fieldName)}"; filename="${clean(file.fileName)}"\r\n` +
    `Content-Type: ${clean(file.contentType)}\r\n\r\n`;

  const body = Readable.from(
    (async function* () {
      yield Buffer.from(head + fileHead);
      for await (const chunk of file.stream) yield chunk;
      yield Buffer.from(`\r\n--${boundary}--\r\n`);
    })(),
  );
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
