import { describe, expect, it } from 'vitest';
import { bannerText, isLive, mmss, type LinkBanner } from './links.js';

describe('mmss', () => {
  it('counts down in minutes and seconds, rounding up', () => {
    expect(mmss(120_000)).toBe('2:00');
    expect(mmss(101_200)).toBe('1:42');
    expect(mmss(900)).toBe('0:01');
    expect(mmss(-5)).toBe('0:00');
  });
});

describe('bannerText', () => {
  const live: LinkBanner = { kind: 'live', file: 'Protocol.pdf', expiresAt: 1_000_000 + 102_000 };

  it('says the file is downloading and how long the link works', () => {
    expect(bannerText(live, 1_000_000)).toBe('Protocol.pdf is downloading. Its link works for this one file for another 1:42.');
    expect(isLive(live, 1_000_000)).toBe(true);
  });

  it('turns into the expired text once the 2 minutes are up', () => {
    const now = 1_000_000 + 102_000;
    expect(isLive(live, now)).toBe(false);
    expect(bannerText(live, now)).toBe('The link for Protocol.pdf has expired and storage now refuses it. Click Download for a fresh one.');
  });

  it('explains a 410 and a 404', () => {
    expect(bannerText({ kind: 'gone', file: 'a.pdf' }, 0)).toContain('a.pdf is no longer available: it was uploaded more than 33 days ago');
    expect(bannerText({ kind: 'denied', file: 'a.pdf' }, 0)).toBe('That file is not available to you.');
    expect(bannerText({ kind: 'failed', file: 'a.pdf', message: 'Try again.' }, 0)).toBe('Try again.');
  });
});
