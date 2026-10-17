// What the Status page says about a download or preview link (D-M4-5, the mockup's banner).

export type LinkBanner =
  | { kind: 'live'; file: string; expiresAt: number }
  /** The 410 answer: the staged file is past its 33 days. */
  | { kind: 'gone'; file: string }
  /** The 404 answer: not the sender and not in a team the file went to, or no such file. */
  | { kind: 'denied'; file: string }
  /** The link could not be asked for (network, server). */
  | { kind: 'failed'; file: string; message: string };

/** Minutes and seconds left, for example "1:42". */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** True while a live link still works. After that the banner reads as an ended link. */
export const isLive = (b: LinkBanner, now: number): boolean => b.kind === 'live' && b.expiresAt > now;

export function bannerText(b: LinkBanner, now: number): string {
  switch (b.kind) {
    case 'live':
      return b.expiresAt > now
        ? `${b.file} is downloading. Its link works for this one file for another ${mmss(b.expiresAt - now)}.`
        : `The link for ${b.file} has expired and storage now refuses it. Click Download for a fresh one.`;
    case 'gone':
      return `${b.file} is no longer available: it was uploaded more than 33 days ago and storage has deleted it. The delivered copy is still in each destination folder.`;
    case 'denied':
      return 'That file is not available to you.';
    case 'failed':
      return b.message;
  }
}
