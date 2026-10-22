import { describe, expect, it } from 'vitest';
import { parseUploadEvents } from './upload-events.js';

const owner = '11111111-1111-4111-8111-111111111111';
const file = '22222222-2222-4222-8222-222222222222';
const body = (key: string, eventName = 'ObjectCreated:Post') =>
  JSON.stringify({ Records: [{ eventName, s3: { bucket: { name: 'store' }, object: { key } } }] });

describe('parseUploadEvents', () => {
  it('reads the bucket, the key and the file id', () => {
    expect(parseUploadEvents(body(`staging/${owner}/${file}`))).toEqual([
      { bucket: 'store', key: `staging/${owner}/${file}`, fileId: file },
    ]);
  });

  it('reads a key that ends in the file name, and one with spaces and a plus sign (S3 sends the key URL-encoded)', () => {
    const key = `staging/${owner}/${file}/QA test A.pdf`;
    expect(parseUploadEvents(body(`staging/${owner}/${file}/QA+test+A.pdf`))).toEqual([{ bucket: 'store', key, fileId: file }]);
    expect(parseUploadEvents(body(`staging/${owner}/${file}/a%2Bb.pdf`))[0]?.key).toBe(`staging/${owner}/${file}/a+b.pdf`);
    expect(parseUploadEvents(body(`staging/${owner}/${file}/a/b.pdf`))).toEqual([]); // a name never holds a slash
  });

  it('accepts a multipart completion and a put', () => {
    expect(parseUploadEvents(body(`staging/${owner}/${file}`, 'ObjectCreated:CompleteMultipartUpload'))).toHaveLength(1);
    expect(parseUploadEvents(body(`staging/${owner}/${file}`, 'ObjectCreated:Put'))).toHaveLength(1);
  });

  it('ignores the S3 test event, other events and keys outside staging', () => {
    expect(parseUploadEvents(JSON.stringify({ Event: 's3:TestEvent', Bucket: 'store' }))).toEqual([]);
    expect(parseUploadEvents(body(`staging/${owner}/${file}`, 'ObjectRemoved:Delete'))).toEqual([]);
    expect(parseUploadEvents(body(`documents/${file}`))).toEqual([]);
    expect(parseUploadEvents(body(`staging/${owner}/not-a-uuid`))).toEqual([]);
  });

  it('ignores a body that is not JSON', () => {
    expect(parseUploadEvents('hello')).toEqual([]);
  });
});
