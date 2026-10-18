import { describe, expect, it } from 'vitest';
import { arrayLiteral } from './sql.js';

describe('arrayLiteral', () => {
  it('quotes every element and writes null as NULL', () => {
    expect(arrayLiteral(['a', 'b', null, 3])).toBe('{"a","b",NULL,"3"}');
  });

  it('keeps commas, braces, spaces and quotes inside their element', () => {
    expect(arrayLiteral(['Cardio / CARDIO-301, "v2" {draft}', 'back\\slash'])).toBe('{"Cardio / CARDIO-301, \\"v2\\" {draft}","back\\\\slash"}');
  });

  it('writes an empty array', () => {
    expect(arrayLiteral([])).toBe('{}');
  });
});
