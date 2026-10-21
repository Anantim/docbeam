import { act, fireEvent } from '@testing-library/react';

/**
 * The text of the tooltip an element shows, or null when it shows none. Keyboard focus shows a tooltip at once (a hover waits
 * 300 ms), so this focuses the element, reads the one `role="tooltip"` in the page, and moves the focus away again (D-F1-47).
 */
export function tooltipOf(element: Element): string | null {
  act(() => {
    fireEvent.focusIn(element);
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? null;
  act(() => {
    fireEvent.focusOut(element);
  });
  return text;
}
