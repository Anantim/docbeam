import { useEffect, useState } from 'react';

/** True from 1024 px up, where Status is a fixed screen with the list and the panel side by side (D-F1-29). */
const QUERY = '(min-width: 1024px)';

export function useWide(): boolean {
  const [wide, setWide] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(QUERY);
    const onChange = (): void => setWide(media.matches);
    media.addEventListener('change', onChange);
    onChange();
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide;
}
