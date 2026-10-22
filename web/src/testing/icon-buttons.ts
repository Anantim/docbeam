import { tooltipOf } from './tooltip.js';

// A test helper for the tooltip rule (D-M3-10, D-F1-47): a button that shows only a symbol (a cross, an eye, an arrow)
// has an aria-label, and a tooltip (the one Tooltip component, not a `title` attribute) with the same text. A checkbox
// drawn as a button needs the aria-label only, because its tooltip may instead say why it is off ("Add a file first").

const HAS_WORDS = /[\p{L}\p{N}]/u;

/** Buttons whose visible content has no letters or digits. */
export function iconOnlyButtons(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button')].filter((b) => !HAS_WORDS.test(b.textContent ?? ''));
}

/** One line per icon-only button that breaks the rule. Empty when all is well. */
export function iconButtonProblems(root: ParentNode): string[] {
  const out: string[] = [];
  for (const b of iconOnlyButtons(root)) {
    const label = b.getAttribute('aria-label')?.trim() ?? '';
    const shown = (b.textContent ?? '').trim() || '(empty)';
    if (!label) {
      out.push(`button "${shown}" has no aria-label`);
      continue;
    }
    if (b.getAttribute('role') === 'checkbox') continue;
    const tip = tooltipOf(b);
    // The tooltip is the short form of the name: a name may go on to say which one it is ("Remove a.pdf", "Close note: 1 file not added.", D-F1-81).
    if (tip === null || !label.startsWith(tip)) out.push(`button "${label}" needs a tooltip with the same text (the tooltip is ${JSON.stringify(tip)})`);
  }
  return out;
}
