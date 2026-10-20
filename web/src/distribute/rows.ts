/**
 * How a click on a file row changes the selection (D-F1-8):
 *  - a plain click selects that row only (a click on the only selected row clears it);
 *  - Ctrl or Cmd adds or removes that row;
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
  if (mods.ctrl) {
    const next = new Set(current.selected);
    if (!next.delete(id)) next.add(id);
    return { selected: next, anchor: id };
  }
  if (current.selected.size === 1 && current.selected.has(id)) return { selected: new Set(), anchor: id };
  return { selected: new Set([id]), anchor: id };
}

/** The rows that are still on the page: a removed file leaves the selection. */
export function keepSelected(selected: ReadonlySet<string>, order: readonly string[]): Set<string> {
  const here = new Set(order);
  return new Set([...selected].filter((id) => here.has(id)));
}
