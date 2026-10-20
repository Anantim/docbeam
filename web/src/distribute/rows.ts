/**
 * How a click on a file row changes the selection (D-F1-8, D-F1-36):
 *  - a plain click toggles that row and leaves the others alone (no Ctrl needed); so does Space on the focused row;
 *  - Ctrl or Cmd does the same;
 *  - Shift selects the range from the last row clicked to this one.
 * `order` is the rows as shown. The anchor is the row the next Shift range starts from.
 */
export interface Pick {
  selected: ReadonlySet<string>;
  anchor: string | null;
}

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
}

export function pickRow(current: Pick, order: readonly string[], id: string, mods: Modifiers): Pick {
  if (mods.shift && current.anchor !== null && order.includes(current.anchor)) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(id);
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const range = order.slice(lo, hi + 1);
    // Ctrl and Shift together add the range to what is selected; Shift alone replaces it.
    return { selected: new Set(mods.ctrl ? [...current.selected, ...range] : range), anchor: current.anchor };
  }
  // A plain click (or Space on the focused row) toggles that file and leaves the others as they are; Ctrl or Cmd does the same.
  const next = new Set(current.selected);
  if (!next.delete(id)) next.add(id);
  return { selected: next, anchor: id };
}

/** The rows that are still on the page: a removed file leaves the selection. */
export function keepSelected(selected: ReadonlySet<string>, order: readonly string[]): Set<string> {
  const here = new Set(order);
  return new Set([...selected].filter((id) => here.has(id)));
}
