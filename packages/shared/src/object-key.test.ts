import { describe, expect, it } from 'vitest';
import { objectKey, safeKeyName } from './object-key.js';

describe('safeKeyName', () => {
  it('keeps an ordinary name as it is', () => {
    expect(safeKeyName('Protocol amendment 3.pdf')).toBe('Protocol amendment 3.pdf');
    expect(safeKeyName('Informed consent form (v2)-final_1.docx')).toBe('Informed consent form (v2)-final_1.docx');
  });

  it('takes out slashes, control characters, quotes and non-ASCII letters, and leading dots', () => {
    expect(safeKeyName('a/b\\c.pdf')).toBe('a_b_c.pdf');
    expect(safeKeyName('x\u0000y\nz.pdf')).toBe('x_y_z.pdf');
    expect(safeKeyName('say "hi".pdf')).toBe('say _hi_.pdf');
    expect(safeKeyName('Prüfbericht.pdf')).toBe('Pr_fbericht.pdf');
    expect(safeKeyName('../../secret.pdf')).toBe('_.._secret.pdf'); // a slash never stays, so a name cannot climb out of its folder
    expect(safeKeyName('.hidden.pdf')).toBe('hidden.pdf');
  });

  it('is never empty', () => {
    expect(safeKeyName('...')).toBe('file');
    expect(safeKeyName('   ')).toBe('file');
  });

  it('cuts a long name to 100 characters and keeps the extension', () => {
    const out = safeKeyName(`${'a'.repeat(240)}.pdf`);
    expect(out).toHaveLength(100);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('objectKey', () => {
  it('puts the owner, the file id and the safe name in the key', () => {
    expect(objectKey('u1', 'f1', 'Lab certification.pdf')).toBe('staging/u1/f1/Lab certification.pdf');
    expect(objectKey('u1', 'f1', '../x.pdf')).not.toContain('..');
  });
});
