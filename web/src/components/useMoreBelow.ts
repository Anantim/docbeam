import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Tells whether a scrolling area has more content below what is shown (D-F1-39), for the soft fade and thin shadow along
 * its bottom edge (`.fadewrap.more-below`). It looks again after every render, when the box changes size and when it is
 * scrolled, and sets the state only when the answer changes. An area that does not scroll (the stacked layout under
 * 1024 px) is never "more below".
 */
export function useMoreBelow<T extends HTMLElement>(): { ref: RefObject<T | null>; more: boolean; recheck: () => void } {
  const ref = useRef<T | null>(null);
  const [more, setMore] = useState(false);

  const recheck = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight > el.clientHeight + 1 && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);

  // Content changes (a level opens, a file is added) re-draw the component, so a check after each draw sees them.
  useLayoutEffect(recheck);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', recheck, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(recheck);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', recheck);
      observer?.disconnect();
    };
  }, [recheck]);

  return { ref, more, recheck };
}
