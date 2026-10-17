import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type FileLink } from './api.js';
import type { LinkBanner } from './links.js';

export interface Viewing {
  link: FileLink;
}

/** Saves a file from its link. The link answers with `Content-Disposition: attachment`, so the page stays where it is. */
function save(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Preview and Download of one delivered file (flow 4). Each click asks the DocBeam API for a new 2-minute link;
 * the bytes then come straight from the Object Store. Not allowed and expired files turn into the banner's text.
 */
export function useFileLink() {
  const [banner, setBanner] = useState<LinkBanner | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** How many links have been issued. The Audit tab reads again when it grows, so it shows the new event. */
  const [issued, setIssued] = useState(0);

  // Tick once a second while a link is counting down.
  const counting = banner?.kind === 'live' && banner.expiresAt > now;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  const ask = useCallback(async (fileId: string, file: string, mode: 'download' | 'preview'): Promise<FileLink | null> => {
    try {
      const link = await trackingApi.download(fileId, mode);
      setIssued((n) => n + 1);
      return link;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 410) setBanner({ kind: 'gone', file });
      else if (e instanceof ApiFailure && e.status === 404) setBanner({ kind: 'denied', file });
      else setBanner({ kind: 'failed', file, message: e instanceof ApiFailure ? e.message : 'The link could not be made. Try again.' });
      return null;
    }
  }, []);

  const download = useCallback(
    async (fileId: string, file: string) => {
      const link = await ask(fileId, file, 'download');
      if (!link) return;
      setNow(Date.now());
      setBanner({ kind: 'live', file, expiresAt: Date.parse(link.expiresAt) });
      save(link.url);
    },
    [ask],
  );

  const preview = useCallback(
    async (fileId: string, file: string) => {
      const link = await ask(fileId, file, 'preview');
      if (!link) return;
      setBanner(null);
      setViewing({ link });
    },
    [ask],
  );

  return {
    banner,
    issued,
    now,
    viewing,
    download,
    preview,
    dismiss: useCallback(() => setBanner(null), []),
    closePreview: useCallback(() => setViewing(null), []),
  };
}
