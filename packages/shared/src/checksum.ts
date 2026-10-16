// SHA-256 values travel in two encodings (D-M2-7): hex in our API and in `files.checksum_sha256`,
// base64 in S3's `x-amz-checksum-sha256` and in `files.s3_checksum`. Pure code: no Node imports.

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** True for 64 lower-case hex characters. */
export function isSha256Hex(value: string): boolean {
  return HEX_SHA256.test(value);
}

export function hexToBase64(hex: string): string {
  if (!isSha256Hex(hex)) throw new Error('Not a SHA-256 in lower-case hex.');
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary);
}

export function base64ToHex(base64: string): string {
  const binary = atob(base64);
  let hex = '';
  for (let i = 0; i < binary.length; i += 1) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

/** True when S3 reported a combined checksum of parts: `<base64>-<part count>`. */
export function isMultipartChecksum(s3Checksum: string): boolean {
  return /^[A-Za-z0-9+/]+=*-\d+$/.test(s3Checksum);
}
