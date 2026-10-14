import { describe, expect, it } from 'vitest';
import { destinationKey, MAX_DESTINATIONS } from './selection.js';

// Ticking, unticking and the 21st-destination refusal are tested with the mapping in `distribute/mapping.test.ts`.
describe('destination selection', () => {
  it('allows 20 destinations, the limit of the API', () => {
    expect(MAX_DESTINATIONS).toBe(20);
  });

  it('keys a binder top level apart from a folder', () => {
    expect(destinationKey({ binderId: 'b', folderId: null })).not.toBe(destinationKey({ binderId: 'b', folderId: 'f' }));
  });
});
