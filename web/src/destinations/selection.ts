/** A distribution can have at most 20 destinations (blueprint, TDD "Submission checks"). */
export const MAX_DESTINATIONS = 20;

export interface Destination {
  binderId: string;
  /** null = the top level of the binder. */
  folderId: string | null;
  /** For example "Cardio / CARDIO-301 Regulatory / Protocol amendments". */
  path: string;
}

export const destinationKey = (d: Pick<Destination, 'binderId' | 'folderId'>): string => `${d.binderId}:${d.folderId ?? ''}`;

export interface Toggled {
  selected: Destination[];
  /** True when a new tick was refused because 20 are already chosen. */
  refused: boolean;
}

export function toggle(selected: Destination[], destination: Destination, limit = MAX_DESTINATIONS): Toggled {
  const key = destinationKey(destination);
  if (selected.some((d) => destinationKey(d) === key)) {
    return { selected: selected.filter((d) => destinationKey(d) !== key), refused: false };
  }
  if (selected.length >= limit) return { selected, refused: true };
  return { selected: [...selected, destination], refused: false };
}
