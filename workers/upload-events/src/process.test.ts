import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@docbeam/shared';
import { checkAgainstRow, type Deps, type FileRow, processUpload, retryDelaySeconds } from './process.js';
import type { Scanner } from './scanner.js';

const bytes = Buffer.from('%PDF-1.7\nhello\n%%EOF\n');
const sha = createHash('sha256').update(bytes).digest('hex');
const b64 = createHash('sha256').update(bytes).digest('base64');
const object = { bucket: 'store', key: 'staging/u/f', fileId: 'f' };

const row = (over: Partial<FileRow> = {}): FileRow => ({
  id: 'f',
  ownerUserId: 'u',
  originalName: 'a.pdf',
  sizeBytes: bytes.length,
  checksumSha256: sha,
  s3Key: 'staging/u/f',
  s3Checksum: b64,
  scanStatus: 'pending',
  ...over,
});

const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Fakes for the database, S3 and the scanner. Every SQL text and every S3 command is recorded. */
function setup(opts: { row?: FileRow | null; body?: Buffer; head?: object | 'missing'; scan?: Scanner['scan'] } = {}) {
  const sql: string[] = [];
  const txn: string[] = [];
  const s3Calls: string[] = [];
  const found = opts.row === undefined ? row() : opts.row;
  const db = {
    query: vi.fn(async (text: string) => {
      sql.push(text);
      return { rows: found ? [found] : [], rowCount: 1 };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (text: string, params?: unknown[]) => {
        txn.push(params ? `${text.trim().split(/\s+/).slice(0, 3).join(' ')} ${JSON.stringify(params)}` : text);
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    })),
  };
  const s3 = {
    send: vi.fn(async (command: { constructor: { name: string } }) => {
      const name = command.constructor.name;
      s3Calls.push(name);
      if (name === 'HeadObjectCommand') {
        if (opts.head === 'missing') throw Object.assign(new Error('nf'), { name: 'NotFound' });
        return opts.head ?? { ContentLength: bytes.length, ChecksumSHA256: b64 };
      }
      if (name === 'GetObjectCommand') return { Body: Readable.from([opts.body ?? bytes]) };
      return {};
    }),
  };
  const scanner: Scanner = {
    scan:
      opts.scan ??
      (async (body) => {
        for await (const chunk of body) void chunk; // reads everything, like the real scanner
        return { status: 'clean' };
      }),
  };
  const deps = { db, s3, scanner, log } as unknown as Deps;
  return { deps, sql, txn, s3Calls };
}

describe('checkAgainstRow', () => {
  it('waits for a multipart file until the API recorded its checksum (D-G9)', () => {
    expect(checkAgainstRow({ sizeBytes: 10, s3Checksum: null }, { size: 10 })).toEqual({ kind: 'wait' });
  });
  it('accepts the declared size and checksum, and a missing reported checksum', () => {
    expect(checkAgainstRow({ sizeBytes: 10, s3Checksum: 'abc' }, { size: 10, checksum: 'abc' })).toEqual({ kind: 'ok' });
    expect(checkAgainstRow({ sizeBytes: 10, s3Checksum: 'abc' }, { size: 10 })).toEqual({ kind: 'ok' });
  });
  it('refuses a different size or checksum', () => {
    expect(checkAgainstRow({ sizeBytes: 10, s3Checksum: 'abc' }, { size: 9 })).toMatchObject({ kind: 'mismatch' });
    expect(checkAgainstRow({ sizeBytes: 10, s3Checksum: 'abc' }, { size: 10, checksum: 'xyz' })).toMatchObject({ kind: 'mismatch' });
  });
});

describe('retryDelaySeconds', () => {
  it('backs off 30 s, 1, 2 and 5 minutes, then stays at 5', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelaySeconds)).toEqual([30, 60, 120, 300, 300, 300]);
  });
});

describe('processUpload', () => {
  it('tags a clean file and then marks the row clean, once', async () => {
    const t = setup();
    expect(await processUpload(t.deps, object)).toBe('done');
    expect(t.s3Calls).toEqual(['HeadObjectCommand', 'GetObjectCommand', 'PutObjectTaggingCommand']);
    expect(t.sql.at(-1)).toContain("scan_status = 'clean'");
    expect(t.sql.at(-1)).toContain("scan_status = 'pending' AND uploaded_at IS NULL"); // the conditional update
  });

  it('refuses an infected file: marks it, writes file.refused with the signature, deletes the object', async () => {
    const t = setup({
      scan: async (body) => {
        for await (const chunk of body) void chunk;
        return { status: 'infected', signature: 'Eicar-Test-Signature' };
      },
    });
    expect(await processUpload(t.deps, object)).toBe('done');
    expect(t.txn[0]).toBe('BEGIN');
    expect(t.txn[1]).toContain('"infected"');
    expect(t.txn[2]).toContain('INSERT INTO audit_events');
    expect(t.txn[2]).toContain('MALWARE');
    expect(t.txn[2]).toContain('Eicar-Test-Signature');
    expect(t.txn.at(-1)).toBe('COMMIT');
    expect(t.s3Calls.at(-1)).toBe('DeleteObjectCommand');
    expect(t.s3Calls).not.toContain('PutObjectTaggingCommand');
  });

  it('does nothing for an event it has already handled', async () => {
    const t = setup({ row: row({ scanStatus: 'clean' }) });
    expect(await processUpload(t.deps, object)).toBe('done');
    expect(t.s3Calls).toEqual([]);
    expect(t.sql).toHaveLength(1); // only the SELECT
  });

  it('removes the object again for a refused file whose first delete failed', async () => {
    const t = setup({ row: row({ scanStatus: 'infected' }) });
    await processUpload(t.deps, object);
    expect(t.s3Calls).toEqual(['DeleteObjectCommand']);
  });

  it('refuses a stored size that differs from the declared one, without reading the file', async () => {
    const t = setup({ head: { ContentLength: bytes.length - 1, ChecksumSHA256: b64 } });
    await processUpload(t.deps, object);
    expect(t.s3Calls).not.toContain('GetObjectCommand');
    expect(t.txn[1]).toContain('"failed"');
    expect(t.txn[2]).toContain('MISMATCH');
  });

  it('refuses bytes whose SHA-256 differs from the declared one, even when storage reports nothing', async () => {
    const swapped = Buffer.from('%PDF-1.7\nHELLO\n%%EOF\n'); // same length
    const t = setup({ body: swapped, head: { ContentLength: swapped.length } });
    await processUpload(t.deps, object);
    expect(t.txn[1]).toContain('"failed"');
    expect(t.s3Calls).not.toContain('PutObjectTaggingCommand');
    expect(t.s3Calls.at(-1)).toBe('DeleteObjectCommand');
  });

  it('asks to wait when a multipart file has no recorded checksum yet', async () => {
    const t = setup({ row: row({ s3Checksum: null }) });
    expect(await processUpload(t.deps, object)).toBe('wait');
    expect(t.s3Calls).toEqual(['HeadObjectCommand']);
  });

  it('acknowledges an event for an object that is gone', async () => {
    const t = setup({ head: 'missing' });
    expect(await processUpload(t.deps, object)).toBe('done');
    expect(t.s3Calls).toEqual(['HeadObjectCommand']);
  });

  it('acknowledges an event for an unknown file', async () => {
    const t = setup({ row: null });
    expect(await processUpload(t.deps, object)).toBe('done');
    expect(t.s3Calls).toEqual([]);
  });

  it('never marks a file clean when the scan could not finish', async () => {
    const t = setup({
      scan: async () => {
        throw new Error('ClamAV could not scan the file');
      },
    });
    await expect(processUpload(t.deps, object)).rejects.toThrow('could not scan');
    expect(t.s3Calls).not.toContain('PutObjectTaggingCommand');
    expect(t.sql.some((s) => s.includes("'clean'"))).toBe(false);
  });
});
