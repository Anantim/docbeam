// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../auth/errors.js';

const api = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('./api.js', () => ({ trackingApi: { download: api.download } }));

const { useFileLink } = await import('./useFileLink.js');

const link = (secs = 120) => ({
  url: 'https://store.example/file?sig=1',
  expiresAt: new Date(Date.now() + secs * 1000).toISOString(),
  fileName: 'Protocol.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useFileLink', () => {
  it('Download asks for a download link, saves it through a hidden anchor and starts the countdown', async () => {
    api.download.mockResolvedValue(link());
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { result } = renderHook(() => useFileLink());
    await act(() => result.current.download('f1', 'Protocol.pdf'));

    expect(api.download).toHaveBeenCalledWith('f1', 'download');
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(result.current.banner).toMatchObject({ kind: 'live', file: 'Protocol.pdf' });
    expect(result.current.issued).toBe(1); // the Audit tab reads again
    expect(document.querySelector('a[href^="https://store.example"]')).toBeNull(); // the anchor is removed again
    clicked.mockRestore();
  });

  it('Preview asks for a preview link and opens the viewer without a banner', async () => {
    api.download.mockResolvedValue(link());
    const { result } = renderHook(() => useFileLink());
    await act(() => result.current.preview('f1', 'Protocol.pdf'));
    expect(api.download).toHaveBeenCalledWith('f1', 'preview');
    expect(result.current.viewing?.link.fileName).toBe('Protocol.pdf');
    expect(result.current.banner).toBeNull();
    act(() => result.current.closePreview());
    expect(result.current.viewing).toBeNull();
  });

  it('turns a 410 into the gone banner, a 404 into the denied banner, and opens nothing', async () => {
    const { result } = renderHook(() => useFileLink());
    api.download.mockRejectedValueOnce(new ApiFailure(410, 'gone', 'FILE_EXPIRED'));
    await act(() => result.current.preview('f1', 'a.pdf'));
    expect(result.current.banner).toEqual({ kind: 'gone', file: 'a.pdf' });
    api.download.mockRejectedValueOnce(new ApiFailure(404, 'nope', 'NOT_FOUND'));
    await act(() => result.current.download('f2', 'b.pdf'));
    expect(result.current.banner).toEqual({ kind: 'denied', file: 'b.pdf' });
    expect(result.current.viewing).toBeNull();
  });

  it('shows a message for any other failure, and Dismiss clears the banner', async () => {
    api.download.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useFileLink());
    await act(() => result.current.download('f1', 'a.pdf'));
    expect(result.current.banner).toMatchObject({ kind: 'failed', file: 'a.pdf' });
    act(() => result.current.dismiss());
    expect(result.current.banner).toBeNull();
  });
});
