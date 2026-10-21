import { useEffect, useRef } from 'react';

interface Props {
  /** The server gave a cursor for a next page. */
  hasMore: boolean;
  /** The next page is on its way. */
  busy: boolean;
  /** The request for the next page failed. */
  failed: boolean;
  onMore: () => void;
  /** How far before the end of the scroll area the next page is asked for, in px (about five rows). */
  lookAhead?: number;
}

/** The scroll area the foot sits in, when it really scrolls (from 1024 px up); otherwise the page itself scrolls. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  const root = el.closest<HTMLElement>('.dist-scroll');
  if (!root) return null;
  const overflow = getComputedStyle(root).overflowY;
  return overflow === 'auto' || overflow === 'scroll' ? root : null;
}

/**
 * The end of the list of distributions (D-F1-49, which replaces the "Show more" button of D-F1-18: the list has its own scroll
 * area now). A sentinel at the end asks for the next page, with the cursor the server gave, when the scroll area comes within
 * about five rows of its end. While it loads the row says "Loading more…" (a polite live region); on a failure it says
 * "Couldn't load more · Try again"; at the end of the data it says "That's everything". Down on the last row asks too (the list
 * handles that key). Asking twice for one page is prevented by the hook that loads it.
 */
export function ListFoot({ hasMore, busy, failed, onMore, lookAhead = 280 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const request = useRef(onMore);
  request.current = onMore;

  useEffect(() => {
    const el = ref.current;
    if (!hasMore || busy || failed || !el || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) request.current();
      },
      { root: scrollParent(el), rootMargin: `0px 0px ${lookAhead}px 0px` },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [hasMore, busy, failed, lookAhead]);

  if (busy) {
    return (
      <div ref={ref} className="state small list-foot" role="status" aria-live="polite">
        Loading more…
      </div>
    );
  }
  if (failed) {
    return (
      <div ref={ref} className="state small list-foot" role="status" aria-live="polite">
        <span>Couldn't load more</span>
        <span aria-hidden="true">·</span>
        <button className="link" type="button" onClick={onMore}>
          Try again
        </button>
      </div>
    );
  }
  if (hasMore) return <div ref={ref} className="list-sentinel" aria-hidden="true" />;
  return <div className="state small list-foot muted">That's everything</div>;
}
