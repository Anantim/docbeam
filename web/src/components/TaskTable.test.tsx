// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient, LiveMessage } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { TaskPage, TaskRow } from '../tracking/api.js';
import { tooltipOf } from '../testing/tooltip.js';
import { attemptNote, ROW_HEIGHT, TaskTable } from './TaskTable.js';

const api = vi.hoisted(() => ({ tasks: vi.fn() }));
vi.mock('../tracking/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  trackingApi: { tasks: api.tasks },
}));

const files = { onPreview: vi.fn(), onDownload: vi.fn() };

const TOTAL = 2_000;
const name = (i: number) => `file-${String(i).padStart(4, '0')}.pdf`;
const row = (i: number, over: Partial<TaskRow> = {}): TaskRow => ({
  taskId: `t${i}`,
  fileId: `f${i}`,
  fileName: name(i),
  fileType: 'application/pdf',
  destinationPath: 'Cardio / Regulatory',
  teamId: 'team',
  status: 'pending',
  attemptCount: 0,
  failureCode: null,
  failureReason: null,
  updatedAt: '2026-10-16T10:00:00.000Z',
  fileExpired: false,
  ...over,
});
const pageOf = (page: number, over: (i: number) => Partial<TaskRow> = () => ({})): TaskPage => ({
  page,
  limit: 100,
  total: TOTAL,
  tasks: Array.from({ length: 100 }, (_, k) => row((page - 1) * 100 + k, over((page - 1) * 100 + k))),
});

function fakeLive() {
  const listeners = new Set<(m: LiveMessage) => void>();
  const live = { onMessage: (l: (m: LiveMessage) => void) => (listeners.add(l), () => listeners.delete(l)) } as unknown as LiveClient;
  return { live, push: (m: LiveMessage) => act(() => listeners.forEach((l) => l(m))) };
}
const counts = { pending: 0, in_progress: 0, completed: 0, failed: 1, cancelled: 0 };
const failedPush = (i: number, updatedAt: string): LiveMessage => ({
  type: 'task_update',
  jobId: 'job',
  taskId: `t${i}`,
  status: 'failed',
  failureCode: 'RETRIES_EXHAUSTED',
  failureReason: `${name(i)} to Cardio / Regulatory: the platform did not answer`,
  updatedAt,
  counts,
});

beforeEach(() => {
  // Braces matter: a function returned from beforeEach would be run as a teardown.
  api.tasks.mockImplementation(async (_job: string, page: number) => pageOf(page));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskTable at the size the side panel gives it (D-F1-15)', () => {
  const six = (): TaskPage => ({ page: 1, limit: 100, total: 6, tasks: Array.from({ length: 6 }, (_, i) => row(i, { status: 'completed' })) });

  it('draws all 6 deliveries of a distribution of 6 (the old 320 px box drew 5 and hid the sixth), with no scroll note', async () => {
    api.tasks.mockImplementation(async () => six());
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={640} />);
    await screen.findByText(name(5));
    for (let i = 0; i < 6; i += 1) expect(screen.getByText(name(i))).toBeTruthy();
    expect(screen.getAllByRole('row').length - 1).toBe(6);
    expect(screen.queryByText(/scroll the list/)).toBeNull();
    expect(screen.getByRole('table', { name: 'Deliveries, 6' })).toBeTruthy(); // the count is in the table's accessible name
  });

  it('says that the list scrolls when it does not fit, with the number of deliveries', async () => {
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={640} />);
    await screen.findByText(name(0));
    expect(screen.getByRole('table', { name: 'Deliveries, 2000' })).toBeTruthy(); // the count is in the accessible name (D-F1-30)
    expect(screen.getByRole('region', { name: 'Delivery rows, scrolls' })).toBeTruthy();
  });

  it('when the box is 5 rows tall, the sixth sits below the edge: the size hides it, not the data', async () => {
    api.tasks.mockImplementation(async () => six());
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={5 * ROW_HEIGHT} />);
    await screen.findByText(name(0));
    expect((screen.getByRole('region', { name: 'Delivery rows, scrolls' }) as HTMLElement).style.height).toBe(`${5 * ROW_HEIGHT}px`); // 5 rows of 52 px
    expect(screen.queryByText(/scroll the list/)).toBeNull(); // no line says it any more: the fade and the shadow do (D-F1-30)
    expect(document.querySelector('.tbody-wrap')?.className).toContain('more-below');
  });
});

// The box itself is on the panel's Deliveries row (StatusPage.test.tsx); the table narrows the rows it has loaded by `query`.
it('ROW_HEIGHT is the stylesheet\'s --row-h, so the two cannot drift apart (D-F1-56)', () => {
  const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
  expect(css).toContain(`--row-h: ${ROW_HEIGHT}px;`);
});

describe('the table narrowed by the Filter… text (D-F1-41, D-F1-46)', () => {
  const some = (n: number, dests: (i: number) => string = () => 'Cardio / Regulatory'): TaskPage => ({ page: 1, limit: 100, total: n, tasks: Array.from({ length: n }, (_, i) => row(i, { destinationPath: dests(i), status: 'completed' })) });
  const table = (query: string, onClearFilter = vi.fn(), status: 'all' | 'completed' = 'all') => {
    const { live } = fakeLive();
    return render(<TaskTable jobId="job" status={status} query={query} onClearFilter={onClearFilter} reloadKey={0} live={live} {...files} viewportHeight={640} />);
  };

  it('matches the file name or the folder path, in any case and anywhere in it, and lists only those rows', async () => {
    api.tasks.mockImplementation(async () => some(30, (i) => (i % 10 === 0 ? 'Oncology / ONC-118 / Imaging' : 'Cardio / Regulatory')));
    const view = table('');
    await screen.findByText(name(0));
    view.rerender(<TaskTable jobId="job" status="all" query="FILE-0007" reloadKey={0} live={fakeLive().live} {...files} viewportHeight={640} />);
    expect(screen.getByText(name(7))).toBeTruthy();
    expect(screen.queryByText(name(8))).toBeNull();
    expect(screen.getByRole('table', { name: 'Deliveries, 30' })).toBeTruthy(); // the count in the name is the whole distribution
    view.rerender(<TaskTable jobId="job" status="all" query="imaging" reloadKey={0} live={fakeLive().live} {...files} viewportHeight={640} />);
    expect(screen.getAllByRole('row').length - 1).toBe(3); // 0, 10 and 20
    view.rerender(<TaskTable jobId="job" status="all" query="" reloadKey={0} live={fakeLive().live} {...files} viewportHeight={640} />);
    expect(screen.getByText(name(8))).toBeTruthy();
  });

  it('says "No matches" with a "Clear filter" link that asks the panel to empty its box (D-F1-45)', async () => {
    api.tasks.mockImplementation(async () => some(30));
    const clear = vi.fn();
    table('zzz', clear);
    await screen.findByText('No matches');
    const none = document.querySelector('.no-matches') as HTMLElement;
    expect(none.textContent).toBe('No matchesClear filter');
    fireEvent.click(none.querySelector('button') as HTMLElement);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('keeps the text when the status choice changes, and only the loaded rows of that status match', async () => {
    api.tasks.mockImplementation(async (_j: string, page: number, status?: string) => (status === 'completed' ? some(20) : { ...some(40), page }));
    const { live } = fakeLive();
    const view = render(<TaskTable jobId="job" status="all" query="file-001" reloadKey={0} live={live} {...files} viewportHeight={640} />);
    await screen.findByText(name(10));
    expect(screen.getAllByRole('row').length - 1).toBe(10); // 0010 to 0019
    view.rerender(<TaskTable jobId="job" status="completed" query="file-001" reloadKey={0} live={live} {...files} viewportHeight={640} />);
    await waitFor(() => expect(api.tasks).toHaveBeenLastCalledWith('job', 1, 'completed'));
    await screen.findByText(name(10));
    expect(screen.getAllByRole('row').length - 1).toBe(10);
  });
});

describe('the type tag in the deliveries table (D-F1-44)', () => {
  it('shows a neutral tag with the type the server found in the file, not one worked out from the name', async () => {
    api.tasks.mockImplementation(async () => ({
      page: 1,
      limit: 100,
      total: 2,
      tasks: [
        // The name says .pdf, the bytes were a DOCX (a file stored before the name check existed would look like this).
        row(0, { fileName: 'report.pdf', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'completed' }),
        row(1, { fileName: 'photo.png', fileType: 'image/png', status: 'completed' }),
      ],
    }));
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={640} />);
    await screen.findByText('report.pdf');
    const tags = [...document.querySelectorAll('.tfile-line .typetile')];
    expect(tags.map((t) => t.textContent)).toEqual(['DOCX', 'PNG']);
    expect(tags.every((t) => !/\b(ok|bad|warn|busy)\b/.test(t.getAttribute('data-tone') ?? ''))).toBe(true); // neutral: no tone attribute
    expect(tags.every((t) => t.className === 'typetile')).toBe(true); // the one grey tag, no colour class
  });
});

describe('the attempts note under the status chip (D-F1-50)', () => {
  it('says "Attempt N of 5" while a delivery is trying again, "Failed after N attempts" on a failure, and nothing for a first-try success', () => {
    expect(attemptNote({ attemptCount: 1 }, 'completed')).toBeNull(); // went through the first time
    expect(attemptNote({ attemptCount: 3 }, 'completed')).toBeNull(); // done: the history is not repeated
    expect(attemptNote({ attemptCount: 0 }, 'pending')).toBeNull();
    expect(attemptNote({ attemptCount: 1 }, 'in_progress')).toBeNull(); // the first try
    expect(attemptNote({ attemptCount: 2 }, 'in_progress')).toBe('Attempt 2 of 5');
    expect(attemptNote({ attemptCount: 3 }, 'pending')).toBe('Attempt 3 of 5'); // waiting for its next try
    expect(attemptNote({ attemptCount: 5 }, 'failed')).toBe('Failed after 5 attempts');
    expect(attemptNote({ attemptCount: 1 }, 'failed')).toBe('Failed after 1 attempt');
    expect(attemptNote({ attemptCount: 0 }, 'failed')).toBeNull();
    expect(attemptNote({ attemptCount: 2 }, 'cancelled')).toBeNull();
  });

  it('shows the note in the row, in small muted text under the chip, with no Attempts column', async () => {
    api.tasks.mockImplementation(async () => ({
      page: 1,
      limit: 100,
      total: 4,
      tasks: [
        row(0, { status: 'completed', attemptCount: 1 }),
        row(1, { status: 'in_progress', attemptCount: 3 }),
        row(2, { status: 'failed', attemptCount: 5, failureCode: 'RETRIES_EXHAUSTED', failureReason: 'x' }),
        row(3, { status: 'completed', attemptCount: 2 }),
      ],
    }));
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={640} />);
    await screen.findByText(name(3));
    const notes = [...document.querySelectorAll('.tattempt-note')].map((n) => n.textContent);
    expect(notes).toEqual(['Attempt 3 of 5', 'Failed after 5 attempts']);
    expect(document.querySelector('.tattempts')).toBeNull();
    expect(document.querySelector('.tattempt-note')?.closest('.tstatus')?.querySelector('.status-chip')).not.toBeNull();
  });
});

describe('TaskTable while it loads (D-F1-22)', () => {
  it('keeps the real header and shows rows of bars the shape of a delivery, with aria-busy', () => {
    api.tasks.mockImplementation(() => new Promise(() => undefined));
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    expect(screen.getByRole('columnheader', { name: 'Deliveries' })).toBeTruthy(); // the first column is "Deliveries" (D-F1-50)
    expect(screen.queryByRole('columnheader', { name: 'Attempts' })).toBeNull(); // and there is no Attempts column
    const busy = screen.getByRole('status', { name: 'Loading deliveries' });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    const rows = busy.querySelectorAll('.trow');
    expect(rows.length).toBe(4);
    for (const cls of ['.sk-file', '.sk-path', '.sk-chip']) expect(rows[0]?.querySelector(cls)).not.toBeNull();
  });
});

describe('the pulse of every loading bar', () => {
  it('is a gentle opacity pulse, and reduced motion stops it and every movement (D-F1-47)', () => {
    const css = readFileSync('web/src/styles.css', 'utf8'); // tests run from the repository root
    expect(css).toMatch(/\.skeleton, \.sk \{[^}]*animation: pulse/);
    expect(css).toMatch(/@keyframes pulse \{ 50% \{ opacity: 0\.45; \} \}/);
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([^@]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/\.skeleton, \.sk \{ animation: none; \}/); // the endless pulse stops
    expect(reduced).toMatch(/--lift: 0px; --lift-toast: 0px; --slide-panel: 0px; --scale-from: 1;/); // nothing moves
  });
});

describe('TaskTable in the panel: fade and focus (D-F1-26)', () => {
  const done = (i: number): Partial<TaskRow> => ({ status: 'completed', attemptCount: 1, fileName: name(i) });

  it('fades the bottom edge while more rows are below, and not at the end or when everything fits', async () => {
    const { live } = fakeLive();
    api.tasks.mockImplementation(async (_j: string, page: number) => pageOf(page));
    const many = render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} fill />);
    await screen.findByText(name(0));
    expect(many.container.querySelector('.tbody-wrap')?.className).toContain('more-below');
    fireEvent.scroll(screen.getByLabelText('Delivery rows, scrolls'), { target: { scrollTop: TOTAL * ROW_HEIGHT - 320 } }); // the very end
    await waitFor(() => expect(many.container.querySelector('.tbody-wrap')?.className).not.toContain('more-below'));
    many.unmount();

    api.tasks.mockImplementation(async () => ({ page: 1, limit: 100, total: 3, tasks: Array.from({ length: 3 }, (_, i) => row(i)) }));
    const few = render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} fill />);
    await screen.findByText(name(0));
    expect(few.container.querySelector('.tbody-wrap')?.className).not.toContain('more-below'); // 3 rows fit
  });

  it('scrolls a row into the box when keyboard focus moves into it from below, and keeps it clear of the fade', async () => {
    const { live } = fakeLive();
    api.tasks.mockImplementation(async (_j: string, page: number) => pageOf(page, done));
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} fill />);
    await screen.findByText(name(0));
    const box = screen.getByLabelText('Delivery rows, scrolls');
    expect(box.scrollTop).toBe(0);
    // Row 7 is drawn (a little beyond the box) but its top, 7 rows down, is below the 320 px box. A mouse click moves nothing.
    fireEvent.pointerDown(box);
    fireEvent.focusIn(screen.getByRole('button', { name: `Preview ${name(7)}` }));
    expect(box.scrollTop).toBe(0);
    fireEvent.keyDown(box, { key: 'Tab' }); // keyboard focus does
    fireEvent.focusIn(screen.getByRole('button', { name: `Preview ${name(7)}` }));
    expect(box.scrollTop).toBe(7 * ROW_HEIGHT + ROW_HEIGHT + 24 - 320); // its bottom plus the room kept under it, at the box's bottom
    // And back up: focus in a row above the box scrolls up to it.
    fireEvent.scroll(box, { target: { scrollTop: 720 } });
    await screen.findByText(name(15));
    fireEvent.focusIn(screen.getByRole('button', { name: `Preview ${name(12)}` }));
    expect(box.scrollTop).toBe(12 * ROW_HEIGHT);
  });
});

describe('TaskTable', () => {
  it('draws only the rows in view out of 2,000', async () => {
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(0));
    expect(screen.getByRole('table', { name: `Deliveries, ${TOTAL}` }).getAttribute('aria-rowcount')).toBe(String(TOTAL + 1));
    const drawn = screen.getAllByRole('row').length - 1; // minus the header
    expect(drawn).toBeGreaterThan(4);
    expect(drawn).toBeLessThan(30);
    expect(screen.queryByText(name(1500))).toBeNull();
    expect(api.tasks).toHaveBeenCalledTimes(1);
  });

  it('loads the page of the rows it scrolls to, 100 at a time', async () => {
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(0));
    fireEvent.scroll(screen.getByLabelText('Delivery rows, scrolls'), { target: { scrollTop: 1500 * ROW_HEIGHT } });
    await screen.findByText(name(1500));
    expect(api.tasks).toHaveBeenCalledWith('job', 16, undefined);
    // Page 1 stays loaded. Page 15 holds the few rows drawn above the window; nothing else in between was fetched.
    expect(api.tasks.mock.calls.map((c) => c[1])).toEqual([1, 15, 16]);
  });

  it('changes a row in place for a live push, with the reason inline', async () => {
    const { live, push } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(2));
    push(failedPush(2, '2026-10-16T10:00:05.000Z'));
    const code = await screen.findByText('RETRIES_EXHAUSTED');
    expect(screen.getByText(/the platform did not answer/)).toBeTruthy();
    // The code and the status chip each carry a one-line meaning (D-M3-10).
    expect(tooltipOf(code)).toBe('Tried 5 times over about 17 minutes; the platform did not accept it.');
    expect(tooltipOf(screen.getByText('Failed').closest('.status-chip') as Element)).toContain('This delivery ended with a failure. The reason is shown.');
    // Cut-short text shows in full.
    expect(tooltipOf(screen.getByText(name(2)))).toBe(name(2));
    expect(api.tasks).toHaveBeenCalledTimes(1); // no fetch for a push
  });

  it('ignores a push that is older than the row', async () => {
    api.tasks.mockImplementation(async (_j: string, page: number) =>
      pageOf(page, (i) => (i === 2 ? { status: 'completed', attemptCount: 1, updatedAt: '2026-10-16T10:00:09.000Z' } : {})),
    );
    const { live, push } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(2));
    push(failedPush(2, '2026-10-16T10:00:03.000Z'));
    expect(screen.queryByText('RETRIES_EXHAUSTED')).toBeNull();
  });

  it('loads again after a reload, keeping the rows on screen meanwhile', async () => {
    const { live } = fakeLive();
    const view = render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(0));
    let release: (p: TaskPage) => void = () => undefined;
    api.tasks.mockImplementationOnce(() => new Promise<TaskPage>((resolve) => (release = resolve)));
    view.rerender(<TaskTable jobId="job" status="all" reloadKey={1} live={live} {...files} viewportHeight={320} />);
    expect(screen.getByText(name(0))).toBeTruthy(); // still there while the answer is awaited
    await act(async () => release(pageOf(1, (i) => (i === 0 ? { status: 'completed', attemptCount: 1 } : {}))));
    await waitFor(() => expect(screen.getAllByText('Completed').length).toBeGreaterThan(0));
    expect(api.tasks).toHaveBeenCalledTimes(2);
  });

  it('asks for the status filter and starts again when it changes', async () => {
    const { live } = fakeLive();
    const view = render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(0));
    api.tasks.mockImplementation(async (_j: string, page: number, status?: string) => ({
      page,
      limit: 100,
      total: 1,
      tasks: [row(7, { status: status as TaskRow['status'], failureCode: 'CHECKSUM_MISMATCH', failureReason: 'x', fileName: 'only-failed.pdf' })],
    }));
    view.rerender(<TaskTable jobId="job" status="failed" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText('only-failed.pdf');
    expect(api.tasks).toHaveBeenLastCalledWith('job', 1, 'failed');
    expect(screen.queryByText(name(0))).toBeNull();
  });

  it('says so when no delivery has the status', async () => {
    api.tasks.mockResolvedValue({ page: 1, limit: 100, total: 0, tasks: [] });
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="failed" reloadKey={0} live={live} {...files} />);
    await screen.findByText('No deliveries with this status.');
  });

  it('shows the expired-file message instead of the buttons, and live Preview and Download on a delivered file', async () => {
    const delivered = row(1, { status: 'completed', attemptCount: 1 });
    api.tasks.mockResolvedValue({
      page: 1,
      limit: 100,
      total: 3,
      tasks: [row(0, { status: 'completed', attemptCount: 1, fileExpired: true }), delivered, row(2, { status: 'pending' })],
    });
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} />);
    await screen.findByText('File expired');

    const download = screen.getByRole('button', { name: `Download ${name(1)}` }) as HTMLButtonElement;
    const preview = screen.getByRole('button', { name: `Preview ${name(1)}` }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
    expect(preview.disabled).toBe(false);
    expect(tooltipOf(download)).toBe(`Download ${name(1)}`);

    fireEvent.click(preview);
    fireEvent.click(download);
    expect(files.onPreview).toHaveBeenCalledWith(delivered);
    expect(files.onDownload).toHaveBeenCalledWith(delivered);

    // An expired file and a delivery that is not done have no buttons.
    expect(screen.queryByRole('button', { name: new RegExp(`(Download|Preview) ${name(0)}`) })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`(Download|Preview) ${name(2)}`) })).toBeNull();
  });

  it('shows an error when the deliveries cannot be loaded', async () => {
    api.tasks.mockRejectedValue(new Error('boom'));
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} />);
    expect((await screen.findByRole('alert')).textContent).toBe('The deliveries could not be loaded.');
  });
});
