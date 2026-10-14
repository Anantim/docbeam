import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createObjectStore } from './s3.js';

const sha = createHash('sha256').update('hello').digest();
const sha256Hex = sha.toString('hex');

function store() {
  return createObjectStore({
    OBJECT_STORE_BUCKET: 'docbeam-test-object-store',
    AWS_REGION: 'ap-southeast-2',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    S3_PUBLIC_ENDPOINT: 'http://localhost:4566',
  });
}

describe('object store signing (ADR-002, ADR-004)', () => {
  beforeAll(() => {
    // Signing is local; it only needs some credentials to sign with.
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'test');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test');
  });

  it('signs a POST policy that fixes the size range, the exact type and the SHA-256', async () => {
    const post = await store().presignPost({
      key: 'staging/user-1/file-1',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256Hex,
    });

    // The link names the address the browser can reach, not the internal one.
    expect(post.url).toContain('localhost:4566');
    expect(post.fields['key']).toBe('staging/user-1/file-1');
    expect(post.fields['Content-Type']).toBe('application/pdf');
    expect(post.fields['x-amz-checksum-sha256']).toBe(sha.toString('base64'));

    const policy = JSON.parse(Buffer.from(post.fields['Policy'] ?? '', 'base64').toString('utf8')) as {
      expiration: string;
      conditions: unknown[];
    };
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 2048]);
    expect(policy.conditions).toContainEqual({ 'Content-Type': 'application/pdf' });
    expect(policy.conditions).toContainEqual({ 'x-amz-checksum-sha256': sha.toString('base64') });
    expect(policy.conditions).toContainEqual({ bucket: 'docbeam-test-object-store' });

    // 15 minutes.
    const minutes = (Date.parse(policy.expiration) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('signs a part link for one part, with its checksum as a signed header and a 15-minute expiry', async () => {
    const url = new URL(
      await store().presignPart({ key: 'staging/user-1/file-2', uploadId: 'upload-1', partNumber: 3, sha256Hex }),
    );
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('uploadId')).toBe('upload-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-checksum-sha256');
    // The header is signed, not moved into the query string, so S3 compares it with the bytes it receives.
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false);
  });

  it('signs the abort link for that upload only', async () => {
    const url = new URL(await store().presignAbort({ key: 'staging/user-1/file-2', uploadId: 'upload-1' }));
    expect(url.searchParams.get('uploadId')).toBe('upload-1');
    expect(url.pathname).toContain('staging/user-1/file-2');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });
});
