// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient, LiveMessage } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { TaskPage, TaskRow } from '../tracking/api.js';
import { columnsFor, TaskTable } from './TaskTable.js';

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

describe('columnsFor: columns size to their content (D-M3-12)', () => {
  const r = (fileName: string, status: TaskRow['status'] = 'completed', fileExpired = false) => ({ fileName, status, fileExpired });

  it('sizes the file column to the longest file name, and gives the destination the room that is left', () => {
    const cols = columnsFor([r('a.pdf'), r('quarterly-update.pdf')]);
    expect(cols).toBe('minmax(96px, 156px) minmax(96px, 1fr) 116px 104px 104px');
  });

  it('keeps the details column narrow until a failure reason or the expired note is loaded', () => {
    expect(columnsFor([r('a.pdf', 'completed'), r('b.pdf', 'pending')])).toMatch(/ 104px$/);
    expect(columnsFor([r('a.pdf'), r('b.pdf', 'failed')])).toMatch(/ 280px$/);
    expect(columnsFor([r('a.pdf', 'completed', true)])).toMatch(/ 280px$/);
  });

  it('caps the file column at 280 px and gives it a floor', () => {
    expect(columnsFor([r('x'.repeat(200))])).toMatch(/^minmax\(96px, 280px\) /);
    expect(columnsFor([])).toMatch(/^minmax\(96px, 96px\) /);
  });
});

describe('TaskTable', () => {
  it('draws only the rows in view out of 2,000', async () => {
    const { live } = fakeLive();
    render(<TaskTable jobId="job" status="all" reloadKey={0} live={live} {...files} viewportHeight={320} />);
    await screen.findByText(name(0));
    expect(screen.getByRole('table', { name: 'Deliveries' }).getAttribute('aria-rowcount')).toBe(String(TOTAL + 1));
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
    fireEvent.scroll(screen.getByLabelText('Deliveries list, scrolls'), { target: { scrollTop: 1500 * 64 } });
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
    expect(code.getAttribute('title')).toBe('Tried 5 times over about 17 minutes; the platform did not accept it.');
    expect(screen.getByText('Failed').closest('.status-chip')?.getAttribute('title')).toBe('This delivery ended with a failure. The reason is shown.');
    // Cut-short text shows in full.
    expect(screen.getByText(name(2)).getAttribute('title')).toBe(name(2));
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
    await waitFor(() => expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0));
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
    await screen.findByText(/more than 33 days old/);

    const download = screen.getByRole('button', { name: `Download ${name(1)}` }) as HTMLButtonElement;
    const preview = screen.getByRole('button', { name: `Preview ${name(1)}` }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
    expect(preview.disabled).toBe(false);
    expect(download.title).toBe(`Download ${name(1)}`);

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
