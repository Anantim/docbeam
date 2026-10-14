// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('docx-preview', () => ({
  renderAsync: async (_file: Blob, element: HTMLElement) => {
    element.innerHTML = '<p>Protocol amendment</p><script>alert(1)</script>';
  },
}));

vi.mock('exceljs', () => {
  const cell = (text: string) => ({ text });
  class Workbook {
    xlsx = { load: async () => undefined };
    worksheets = [
      {
        name: 'Sites',
        rowCount: 2,
        columnCount: 2,
        getRow: (r: number) => ({ getCell: (c: number) => cell(r === 1 ? ['Site', 'Status'][c - 1] ?? '' : ['Mumbai', '<b>Open</b>'][c - 1] ?? '') }),
      },
      { name: 'Notes', rowCount: 1, columnCount: 1, getRow: () => ({ getCell: () => cell('Second sheet') }) },
    ];
  }
  return { default: { Workbook } };
});

const { Preview, OFFICE_PREVIEW_MAX_BYTES } = await import('./Preview.js');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test-1');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const show = (props: Partial<Parameters<typeof Preview>[0]> & { contentType: string; name: string }) =>
  render(
    <Preview
      sizeBytes={1000}
      blob={new Blob(['x'])}
      meta="not sent yet"
      note="Shown from the copy in your browser. Nothing has been sent yet."
      onClose={() => {}}
      {...props}
    />,
  );

describe('Preview', () => {
  it('shows a DOCX in an iframe with an empty sandbox, through srcdoc', async () => {
    show({ name: 'amendment.docx', contentType: DOCX });
    const frame = await screen.findByTitle('Preview of amendment.docx');
    expect(frame.tagName).toBe('IFRAME');
    // `sandbox=""` is the strictest setting: no scripts, no same origin, no forms, no popups.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toBeNull();
    expect(frame.getAttribute('srcdoc')).toContain('Protocol amendment');
  });

  it('shows an XLSX sheet the same way, with the cells as escaped text', async () => {
    const user = userEvent.setup();
    show({ name: 'sites.xlsx', contentType: XLSX });
    const frame = await screen.findByTitle('Preview of sites.xlsx');
    expect(frame.getAttribute('sandbox')).toBe('');
    const html = frame.getAttribute('srcdoc') ?? '';
    expect(html).toContain('Mumbai');
    expect(html).toContain('&lt;b&gt;Open&lt;/b&gt;');

    await user.selectOptions(screen.getByLabelText('Sheet'), 'Notes');
    expect((await screen.findByTitle('Preview of sites.xlsx')).getAttribute('srcdoc')).toContain('Second sheet');
    expect(screen.getByTitle('Preview of sites.xlsx').getAttribute('sandbox')).toBe('');
  });

  it('opens a PDF from an object URL and revokes it on close', async () => {
    const { unmount } = show({ name: 'consent.pdf', contentType: 'application/pdf' });
    const frame = await screen.findByTitle('Preview of consent.pdf');
    expect(frame.getAttribute('src')).toBe('blob:test-1');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
  });

  it('shows a PNG as an image', async () => {
    show({ name: 'scan.png', contentType: 'image/png' });
    const img = await screen.findByAltText('scan.png');
    expect(img.getAttribute('src')).toBe('blob:test-1');
  });

  it('does not render a DOCX or XLSX over 50 MB', async () => {
    show({ name: 'big.xlsx', contentType: XLSX, sizeBytes: OFFICE_PREVIEW_MAX_BYTES + 1 });
    expect(await screen.findByText(/too large to show in the page/)).toBeTruthy();
    expect(screen.queryByTitle('Preview of big.xlsx')).toBeNull();
  });

  it('closes with the cross and with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    show({ name: 'consent.pdf', contentType: 'application/pdf', onClose });
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
