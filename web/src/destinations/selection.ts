import { LIMITS } from '@docbeam/shared/browser';

/** A distribution can have at most 20 destinations (blueprint, TDD "Submission checks"). */
export const MAX_DESTINATIONS = LIMITS.maxDestinationsPerJob;

export interface Destination {
  binderId: string;
  /** A destination is always a folder (D-F1-3). */
  folderId: string;
  /** For example "Cardio / CARDIO-301 Regulatory / Protocol amendments". */
  path: string;
}

export const destinationKey = (d: Pick<Destination, 'binderId' | 'folderId'>): string => `${d.binderId}:${d.folderId}`;
