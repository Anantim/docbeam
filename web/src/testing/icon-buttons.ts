// A test helper for the tooltip rule (D-M3-10): a button that shows only a symbol (a cross, an eye, an arrow)
// has an aria-label, and a title with the same text. A checkbox drawn as a button needs the aria-label only,
// because its title may instead say why it is off ("Add a file first").

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
    if (b.getAttribute('title') !== label) out.push(`button "${label}" needs a title with the same text (title is ${JSON.stringify(b.getAttribute('title'))})`);
  }
  return out;
}
