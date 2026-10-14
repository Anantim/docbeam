import { useEffect } from 'react';

/** While `active`, the browser asks before the page is closed or reloaded, so a running upload is not lost by accident. */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a return value to show the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
