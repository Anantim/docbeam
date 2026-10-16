import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createClamdScanner, createClamscanScanner, parseClamReply } from './scanner.js';

describe('parseClamReply', () => {
  it('reads clean, infected and error replies', () => {
    expect(parseClamReply('stream: OK\0')).toEqual({ status: 'clean' });
    expect(parseClamReply('stream: Eicar-Test-Signature FOUND\0')).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
    expect(() => parseClamReply('INSTREAM size limit exceeded. ERROR\0')).toThrow('ClamAV could not scan');
    expect(() => parseClamReply('')).toThrow('no reply');
  });
});

/** A stand-in for clamd: records what it receives and answers with `reply`. */
async function fakeClamd(reply: string): Promise<{ port: number; received: () => Buffer; close: () => void }> {
  const chunks: Buffer[] = [];
  const server = net.createServer((socket) => {
    socket.on('data', (d) => {
      chunks.push(d);
      // The stream ends with four zero bytes.
      const all = Buffer.concat(chunks);
      if (all.length >= 4 && all.subarray(all.length - 4).equals(Buffer.alloc(4))) socket.end(reply);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as net.AddressInfo).port,
    received: () => Buffer.concat(chunks),
    close: () => server.close(),
  };
}

describe('clamd scanner (INSTREAM)', () => {
  it('frames the bytes as length-prefixed chunks and ends with a zero chunk', async () => {
    const clamd = await fakeClamd('stream: OK\0');
    try {
      const result = await createClamdScanner({ host: '127.0.0.1', port: clamd.port }).scan(Readable.from([Buffer.from('hello world')]));
      expect(result).toEqual({ status: 'clean' });
      const got = clamd.received();
      expect(got.subarray(0, 10).toString()).toBe('zINSTREAM\0');
      expect(got.readUInt32BE(10)).toBe(11);
      expect(got.subarray(14, 25).toString()).toBe('hello world');
      expect(got.subarray(25)).toEqual(Buffer.alloc(4));
    } finally {
      clamd.close();
    }
  });

  it('reports the signature when ClamAV finds something', async () => {
    const clamd = await fakeClamd('stream: Win.Test.EICAR_HDB-1 FOUND\0');
    try {
      const result = await createClamdScanner({ host: '127.0.0.1', port: clamd.port }).scan(Readable.from([Buffer.from('x')]));
      expect(result).toEqual({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
    } finally {
      clamd.close();
    }
  });

  it('fails, not clean, when ClamAV answers with an error', async () => {
    const clamd = await fakeClamd('INSTREAM size limit exceeded. ERROR\0');
    try {
      await expect(
        createClamdScanner({ host: '127.0.0.1', port: clamd.port }).scan(Readable.from([Buffer.from('x')])),
      ).rejects.toThrow('could not scan');
    } finally {
      clamd.close();
    }
  });

  it('fails when ClamAV cannot be reached', async () => {
    await expect(createClamdScanner({ host: '127.0.0.1', port: 1 }).scan(Readable.from([Buffer.from('x')]))).rejects.toThrow();
  });
});

describe('clamscan scanner', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  /** A fake `clamscan`: logs its arguments and behaves as the script says. */
  async function fake(script: string): Promise<{ command: string; tmpDir: string; args: () => Promise<string> }> {
    const dir = await mkdtemp(join(tmpdir(), 'clamscan-test-'));
    dirs.push(dir);
    const command = join(dir, 'clamscan');
    await writeFile(command, `#!/bin/sh\necho "$@" > "${dir}/args"\n${script}\n`);
    await chmod(command, 0o755);
    return { command, tmpDir: dir, args: () => readFile(join(dir, 'args'), 'utf8') };
  }

  it('is clean on exit code 0, passes the limits, and removes its temporary file', async () => {
    const clam = await fake('exit 0');
    const result = await createClamscanScanner({ command: clam.command, tmpDir: clam.tmpDir }).scan(Readable.from([Buffer.from('data')]));
    expect(result).toEqual({ status: 'clean' });
    const args = await clam.args();
    expect(args).toContain('--max-filesize=1100M');
    expect(args).toContain('--max-scansize=1100M');
    // Over a limit must read as found, never as clean.
    expect(args).toContain('--alert-exceeds-max=yes');
    expect((await readdir(clam.tmpDir)).filter((f) => f.startsWith('scan-'))).toEqual([]);
  });

  it('is infected on exit code 1, with the signature', async () => {
    const clam = await fake('echo "$(for a; do :; done; echo $a): Eicar-Test-Signature FOUND"; exit 1');
    const result = await createClamscanScanner({ command: clam.command, tmpDir: clam.tmpDir }).scan(Readable.from([Buffer.from('data')]));
    expect(result).toEqual({ status: 'infected', signature: 'Eicar-Test-Signature' });
  });

  it('fails on exit code 2, and still removes the file', async () => {
    const clam = await fake('echo "ERROR: Can not open database" >&2; exit 2');
    await expect(
      createClamscanScanner({ command: clam.command, tmpDir: clam.tmpDir }).scan(Readable.from([Buffer.from('data')])),
    ).rejects.toThrow('code 2');
    expect((await readdir(clam.tmpDir)).filter((f) => f.startsWith('scan-'))).toEqual([]);
  });
});
