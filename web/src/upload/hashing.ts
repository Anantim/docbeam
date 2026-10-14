import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { LIMITS } from '@docbeam/shared/browser';

export interface HashResult {
  /** SHA-256 of the whole file, lower-case hex. */
  sha256: string;
  /** SHA-256 of each 16 MiB part, in order. Empty for a file that uploads in one piece. */
  parts: string[];
}

/**
 * Hashes a file in 16 MiB slices, so memory stays small for a 1 GB file. The same pass gives each part's hash
 * for a multipart file (D-M2-10: `crypto.subtle` cannot hash incrementally, so this uses @noble/hashes).
 */
export async function hashFile(
  file: Blob,
  multipart: boolean,
  onProgress: (fraction: number) => void = () => undefined,
): Promise<HashResult> {
  const whole = sha256.create();
  const parts: string[] = [];
  for (let offset = 0; offset < file.size; offset += LIMITS.partBytes) {
    const bytes = new Uint8Array(await file.slice(offset, offset + LIMITS.partBytes).arrayBuffer());
    whole.update(bytes);
    if (multipart) parts.push(bytesToHex(sha256(bytes)));
    onProgress(Math.min(1, (offset + bytes.length) / file.size));
  }
  return { sha256: bytesToHex(whole.digest()), parts };
}
