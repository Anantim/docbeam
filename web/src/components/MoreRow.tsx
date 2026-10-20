import { useEffect, useRef, type CSSProperties } from 'react';

interface Props {
  busy: boolean;
  failed: boolean;
  onMore: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The end of a paged list. It loads the next page when it scrolls into view (a scroll box around it, or the page)
 * and has a button for browsers or people that cannot scroll to it. While the page loads it says so; if the load
 * fails it offers a retry (D-F1-6).
 */
export function MoreRow({ busy, failed, onMore, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const request = useRef(onMore);
  request.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || busy || failed || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) request.current();
      },
      { root: el.closest('.tree'), rootMargin: '0px 0px 120px 0px' },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [busy, failed]);
  return (
    <div ref={ref} className={className} style={style}>
      {busy ? (
        <span role="status">Loading more…</span>
      ) : failed ? (
        <>
          Could not load more.{' '}
          <button className="link" type="button" onClick={onMore}>
            Try again
          </button>
        </>
      ) : (
        <button className="link" type="button" onClick={onMore}>
          Show more
        </button>
      )}
    </div>
  );
}
