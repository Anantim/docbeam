import { describe, expect, it } from 'vitest';
import { bannerParts, isLive, mmss, type LinkBanner } from './links.js';

describe('mmss', () => {
  it('counts down in minutes and seconds, rounding up', () => {
    expect(mmss(120_000)).toBe('2:00');
    expect(mmss(101_200)).toBe('1:42');
    expect(mmss(900)).toBe('0:01');
    expect(mmss(-5)).toBe('0:00');
  });
});

describe('bannerParts (a short first line and a detail, D-F1-78)', () => {
  const live: LinkBanner = { kind: 'live', file: 'Protocol.pdf', expiresAt: 1_000_000 + 102_000 };

  it('says the file is downloading and how long the link works', () => {
    expect(bannerParts(live, 1_000_000)).toEqual({ heading: 'Protocol.pdf is downloading.', detail: 'Its link works for this one file for another 1:42.' });
    expect(isLive(live, 1_000_000)).toBe(true);
  });

  it('turns into the expired text once the 2 minutes are up', () => {
    const now = 1_000_000 + 102_000;
    expect(isLive(live, now)).toBe(false);
    expect(bannerParts(live, now)).toEqual({ heading: 'The link for Protocol.pdf has expired.', detail: 'Storage now refuses it. Click Download for a fresh one.' });
  });

  it('explains a 410 and a 404', () => {
    expect(bannerParts({ kind: 'gone', file: 'a.pdf' }, 0)).toEqual({
      heading: 'a.pdf is no longer available.',
      detail: 'It was uploaded more than 33 days ago and storage has deleted it. The delivered copy is still in each destination folder.',
    });
    expect(bannerParts({ kind: 'denied', file: 'a.pdf' }, 0)).toEqual({ heading: "That file isn't available to you." });
    expect(bannerParts({ kind: 'failed', file: 'a.pdf', message: 'Try again.' }, 0)).toEqual({ heading: 'Try again.' });
  });
});
