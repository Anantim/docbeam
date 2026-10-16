import { describe, expect, it } from 'vitest';
import { escapeHtml, sheetHtml, srcdocFor } from './render.js';

describe('escapeHtml', () => {
  it('turns markup into text', () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;');
  });
});

describe('sheetHtml', () => {
  it('writes column letters, row numbers and escaped cells', () => {
    const html = sheetHtml({ name: 'S', rows: [['Site', '<b>Open</b>'], ['Mumbai']], rowCount: 2, columnCount: 2 });
    expect(html).toContain('<th>A</th><th>B</th>');
    expect(html).toContain('<td class="n">2</td><td>Mumbai</td><td></td>');
    expect(html).toContain('&lt;b&gt;Open&lt;/b&gt;');
    expect(html).not.toContain('<b>Open</b>');
  });

  it('says when it cut the sheet', () => {
    const html = sheetHtml({ name: 'S', rows: [['a']], rowCount: 900, columnCount: 3 });
    expect(html).toContain('Showing the first 1 rows and 1 columns of 900 rows and 3 columns.');
  });

  it('names columns past Z', () => {
    const row = Array.from({ length: 28 }, () => 'x');
    expect(sheetHtml({ name: 'S', rows: [row], rowCount: 1, columnCount: 28 })).toContain('<th>AB</th>');
  });
});

describe('srcdocFor', () => {
  it('is a whole document', () => {
    expect(srcdocFor('<p>Hi</p>')).toMatch(/^<!doctype html><html>.*<body><p>Hi<\/p><\/body><\/html>$/);
  });
});
