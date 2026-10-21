/** True when the person asked for less motion (or the environment cannot say, as in the unit tests): code that would wait for an animation to end does not wait. */
export function prefersReducedMotion(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long the side panel takes to slide out (`--t-200`), for the moment it stays on screen while it does (D-F1-47). */
export const PANEL_OUT_MS = 200;
