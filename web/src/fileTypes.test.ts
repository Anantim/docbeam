import { describe, expect, it } from 'vitest';
import { contrast, TYPE_COLOURS } from './fileTypes.js';

describe('file type badge colours', () => {
  it('colours PDF red, DOCX blue, XLSX green, PNG and JPG purple', () => {
    expect(Object.fromEntries(Object.entries(TYPE_COLOURS).map(([k, v]) => [k, v.name]))).toEqual({
      PDF: 'red',
      DOCX: 'blue',
      XLSX: 'green',
      PNG: 'purple',
      JPG: 'purple',
    });
  });

  it('keeps every pair readable: contrast of at least 4.5 to 1', () => {
    for (const [type, c] of Object.entries(TYPE_COLOURS)) {
      expect(contrast(c.fg, c.bg), type).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('measures contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});
