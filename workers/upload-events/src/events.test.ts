import { describe, expect, it } from 'vitest';
import { parseUploadEvents } from './events.js';

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
