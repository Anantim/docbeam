import { act, fireEvent } from '@testing-library/react';

/**
 * The text of the tooltip an element shows, or null when it shows none. Keyboard focus shows a tooltip at once (a hover waits
 * 300 ms), so this presses Tab, focuses the element, reads the one `role="tooltip"` in the page, and moves the focus away again
 * (D-F1-47). A focus the app moves, with no key before it, shows nothing (D-F1-81).
 */
export function tooltipOf(element: Element): string | null {
  act(() => {
    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.focusIn(element);
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? null;
  act(() => {
    fireEvent.focusOut(element);
  });
  return text;
}
