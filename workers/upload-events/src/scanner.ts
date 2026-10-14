import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string };

/**
 * One scanner interface (ADR-016, D-M2-12). Locally the bytes go to the `clamav` container over clamd's
 * INSTREAM protocol; in the Lambda image they go to a file in /tmp that `clamscan` reads.
 * A scan that could not finish throws: it is never reported as clean.
 */
export interface Scanner {
  scan(body: Readable): Promise<ScanResult>;
}

/** The scan limits are a little above the 1 GiB hard size limit, so no valid file reaches them. */
export const SCAN_LIMIT_MB = 1100;

const CHUNK_BYTES = 256 * 1024;

/** `stream: Eicar-Test-Signature FOUND` gives the signature; `stream: OK` is clean; anything else is an error. */
export function parseClamReply(reply: string): ScanResult {
  const text = reply.replaceAll('\0', '').trim();
  if (/\bOK$/.test(text)) return { status: 'clean' };
  const found = /^(?:stream|.+?):\s+(.+?)\s+FOUND$/.exec(text);
  if (found?.[1]) return { status: 'infected', signature: found[1] };
  throw new Error(`ClamAV could not scan the file: ${text || 'no reply'}`);
}

export interface ClamdOptions {
  host: string;
  port?: number;
  /** Give up on a scan after this long. Default 10 minutes, the Lambda's own timeout. */
  timeoutMs?: number;
}

export function createClamdScanner({ host, port = 3310, timeoutMs = 600_000 }: ClamdOptions): Scanner {
  return {
    scan(body) {
      return new Promise<ScanResult>((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        let reply = '';
        let settled = false;
        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          body.destroy();
          fn();
        };
        const timer = setTimeout(() => finish(() => reject(new Error('ClamAV did not answer in time.'))), timeoutMs);
        timer.unref?.();

        socket.on('data', (d: Buffer) => {
          reply += d.toString('latin1');
        });
        socket.on('error', (error) => {
          // clamd answers and closes when it refuses the stream (for example too long): use its words if it said any.
          if (reply.includes('\0') || /ERROR|FOUND|OK/.test(reply)) return;
          finish(() => reject(error));
        });
        socket.on('close', () => {
          finish(() => {
            try {
              resolve(parseClamReply(reply));
            } catch (error) {
              reject(error as Error);
            }
          });
        });

        void (async () => {
          try {
            socket.write('zINSTREAM\0');
            for await (const chunk of body as AsyncIterable<Buffer>) {
              for (let at = 0; at < chunk.length; at += CHUNK_BYTES) {
                const slice = chunk.subarray(at, at + CHUNK_BYTES);
                const frame = Buffer.allocUnsafe(4 + slice.length);
                frame.writeUInt32BE(slice.length, 0);
                slice.copy(frame, 4);
                if (!socket.write(frame)) await new Promise<void>((r) => socket.once('drain', r));
              }
            }
            socket.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
          } catch (error) {
            finish(() => reject(error as Error));
          }
        })();
      });
    },
  };
}

export interface ClamscanOptions {
  /** The binary. Default `clamscan`. */
  command?: string;
  /** Where the file is written for the scan. Default `/tmp`, the only writable place in a Lambda. */
  tmpDir?: string;
}

export function createClamscanScanner({ command = 'clamscan', tmpDir = '/tmp' }: ClamscanOptions = {}): Scanner {
  return {
    async scan(body) {
      const path = join(tmpDir, `scan-${randomUUID()}`);
      try {
        await pipeline(body, createWriteStream(path));
        const { code, stdout, stderr } = await run(command, [
          '--no-summary',
          '--stdout',
          `--max-filesize=${SCAN_LIMIT_MB}M`,
          `--max-scansize=${SCAN_LIMIT_MB}M`,
          // A file or archive over a limit is reported as found, never silently skipped as clean.
          '--alert-exceeds-max=yes',
          path,
        ]);
        if (code === 0) return { status: 'clean' };
        if (code === 1) {
          const found = /:\s+(.+?)\s+FOUND\s*$/m.exec(stdout);
          return { status: 'infected', signature: found?.[1] ?? 'unknown' };
        }
        throw new Error(`clamscan failed with code ${code}: ${(stderr || stdout).slice(0, 500)}`);
      } finally {
        await rm(path, { force: true });
      }
    },
  };
}

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Local runs use clamd when CLAMD_HOST is set; the Lambda image has only clamscan. */
export function scannerFromEnv(env: NodeJS.ProcessEnv): Scanner {
  if (env.CLAMD_HOST) return createClamdScanner({ host: env.CLAMD_HOST, port: Number(env.CLAMD_PORT ?? 3310) });
  return createClamscanScanner();
}
