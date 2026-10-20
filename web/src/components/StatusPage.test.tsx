// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient, LiveMessage } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { JobDetail, JobSummary } from '../tracking/api.js';
import type { usePagedJobs } from '../tracking/usePagedJobs.js';
import { StatusPage } from './StatusPage.js';

const api = vi.hoisted(() => ({ job: vi.fn(), jobs: vi.fn(), tasks: vi.fn(), cancel: vi.fn(), retry: vi.fn(), audit: vi.fn() }));
vi.mock('../tracking/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  trackingApi: api,
}));

const JOB = '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90';
const counts = (c: Partial<JobDetail['counts']> = {}) => ({ pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0, ...c });

const detail = (over: Partial<JobDetail> = {}): JobDetail => ({
  jobId: JOB,
  submittedBy: { userId: 'u1', name: 'Priya Shah' },
  createdAt: '2026-10-16T10:00:00Z',
  asOf: '2026-10-16T10:05:00.000Z',
  taskCount: 10,
  counts: counts({ completed: 4, in_progress: 1, pending: 5 }),
  status: 'in_progress',
  isSender: true,
  completedAt: null,
  cancelledAt: null,
  destinations: ['Cardio / CARDIO-301 / Protocol amendments', 'Oncology / ONC-100 / Imaging'],
  fileCount: 5,
  retry: { open: false, retryable: 0, reason: 'NOTHING_TO_RETRY' },
  cancel: { open: true, waiting: 5 },
  ...over,
});

function fakeLive() {
  const messages = new Set<(m: LiveMessage) => void>();
  const resyncs = new Set<(id: string) => void>();
  const order: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const live = {
    watch: vi.fn(async (id: string) => {
      order.push(`watch ${id}`);
      await gate;
      order.push('subscribed');
      return 'subscribed';
    }),
    unwatch: vi.fn(),
    onMessage: (l: (m: LiveMessage) => void) => (messages.add(l), () => messages.delete(l)),
    onResync: (l: (id: string) => void) => (resyncs.add(l), () => resyncs.delete(l)),
  };
  return {
    live: live as unknown as LiveClient,
    spy: live,
    order,
    release,
    push: (m: LiveMessage) => act(() => messages.forEach((l) => l(m))),
    resync: (id: string) => act(() => resyncs.forEach((l) => l(id))),
  };
}

const mine = (jobs: JobSummary[] | null = [], over: Partial<ReturnType<typeof usePagedJobs>> = {}) => ({
  jobs,
  error: '',
  hasMore: false,
  loadingMore: false,
  moreFailed: false,
  refresh: vi.fn(async () => undefined),
  loadMore: vi.fn(async () => undefined),
  ...over,
});
const notify = vi.fn();

function renderPage(over: { jobId?: string | null; uploads?: boolean; onOpen?: (id: string | null) => void; onOpenUploads?: () => void; live?: LiveClient; mine?: ReturnType<typeof mine> } = {}) {
  const f = fakeLive();
  const utils = render(
    <StatusPage
      meId="u"
      jobId={'jobId' in over ? (over.jobId ?? null) : JOB}
      uploads={over.uploads ?? false}
      onOpen={over.onOpen ?? vi.fn()}
      onOpenUploads={over.onOpenUploads ?? vi.fn()}
      mine={over.mine ?? mine()}
      notify={notify}
      live={over.live ?? f.live}
    />,
  );
  return { ...f, ...utils };
}

beforeEach(() => {
  api.job.mockResolvedValue(detail());
  api.jobs.mockResolvedValue([]);
  api.tasks.mockResolvedValue({ page: 1, limit: 100, total: 0, tasks: [] });
  api.audit.mockResolvedValue({ page: 1, limit: 50, hasMore: false, events: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const filterCounts = () =>
  Object.fromEntries(
    within(screen.getByRole('group', { name: 'Filter deliveries by status' }))
      .getAllByRole('button')
      .map((b) => {
        const m = /^(.+), (\d+) deliver/.exec(b.getAttribute('aria-label') ?? '');
        return [m?.[1], Number(m?.[2])];
      }),
  );

const opened = async (page: ReturnType<typeof renderPage>) => {
  await act(async () => page.release());
  await screen.findByRole('heading', { name: '3f1c2a9e' });
};

describe('opening a distribution: subscribe first, fetch after', () => {
  it('does not fetch until the live connection has answered, then fetches the job and its deliveries', async () => {
    const page = renderPage();
    expect(page.order).toEqual([`watch ${JOB}`]);
    await act(async () => undefined);
    expect(api.job).not.toHaveBeenCalled(); // the subscription is not confirmed yet
    expect(api.tasks).not.toHaveBeenCalled();

    await opened(page);
    expect(page.order).toEqual([`watch ${JOB}`, 'subscribed']);
    expect(api.job).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.tasks).toHaveBeenCalledTimes(1));
  });

  it('stops watching when the panel is closed', async () => {
    const page = renderPage();
    await opened(page);
    page.unmount();
    expect(page.spy.unwatch).toHaveBeenCalled();
  });

  it('fetches again exactly once after a reconnect has subscribed again', async () => {
    const page = renderPage();
    await opened(page);
    await waitFor(() => expect(api.tasks).toHaveBeenCalledTimes(1));
    await page.resync(JOB);
    await waitFor(() => expect(api.job).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.tasks).toHaveBeenCalledTimes(2));
    await page.resync('some-other-job');
    expect(api.job).toHaveBeenCalledTimes(2);
  });

  it('shows the not-found panel, the same for a missing and a hidden distribution', async () => {
    const { ApiFailure } = await import('../auth/session.js');
    api.job.mockRejectedValue(new ApiFailure(404, 'That distribution was not found.', 'NOT_FOUND'));
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('Distribution not found');
  });

  it('shows deliveries first, then the history of the same distribution, in one panel', async () => {
    api.audit.mockResolvedValue({
      page: 1,
      limit: 50,
      hasMore: false,
      events: [{ id: 1, occurredAt: '2026-10-16T10:00:00Z', action: 'job.submitted', actorId: 'u1', jobId: JOB, taskId: null, teamId: null, detail: { actorName: 'Priya Shah', fileCount: 5, destinationCount: 2, taskCount: 10 } }],
    });
    const page = renderPage();
    await opened(page);
    const panel = screen.getByRole('complementary', { name: 'Distribution 3f1c2a9e' });
    expect(within(panel).getByRole('region', { name: 'Deliveries' })).toBeTruthy();
    // The history is closed until it is opened, and is not read before.
    expect(api.audit).not.toHaveBeenCalled();
    await userEvent.setup().click(within(panel).getByText('History'));
    await within(panel).findByText('Distribution sent');
    expect(api.audit).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB }));
  });

  it('closes with the Close button and with Escape', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const page = renderPage({ onOpen });
    await opened(page);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpen).toHaveBeenCalledWith(null);
    onOpen.mockClear();
    screen.getByRole('button', { name: 'Close' }).focus();
    await user.keyboard('{Escape}');
    expect(onOpen).toHaveBeenCalledWith(null);
  });
});

describe('live counts', () => {
  it('moves the filter numbers, the bar and the chip when a push arrives', async () => {
    const page = renderPage();
    await opened(page);
    expect(filterCounts()).toEqual({ All: 10, Completed: 4, Failed: 0, 'In progress': 1, Pending: 5 });

    await page.push({
      type: 'task_update',
      jobId: JOB,
      taskId: 't1',
      status: 'completed',
      updatedAt: '2026-10-16T10:05:10.000Z',
      counts: counts({ completed: 10 }),
    });
    expect(filterCounts()).toEqual({ All: 10, Completed: 10, Failed: 0, 'In progress': 0, Pending: 0 });
    expect((screen.getByRole('complementary').querySelector('.status-chip.big') as HTMLElement).textContent).toBe('Completed');
  });

  it('shows cancelled deliveries as their own grey bar segment and filter, not as failed', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 3, cancelled: 5 }), taskCount: 8, status: 'cancelled', cancelledAt: '2026-10-16T10:04:00Z', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await opened(page);
    expect(filterCounts()).toMatchObject({ Completed: 3, Failed: 0, Cancelled: 5 });
    const segments = [...document.querySelectorAll('.jbar > div')] as HTMLElement[];
    expect(segments.find((s) => s.getAttribute('data-tone') === 'bad')?.style.width).toBe('0%'); // no red
    expect(segments.find((s) => s.getAttribute('data-tone') === 'idle')?.style.width).toBe('62.5%');
  });

  it('shows no Cancelled filter when nothing was cancelled', async () => {
    const page = renderPage();
    await opened(page);
    expect(screen.queryByRole('button', { name: /^Cancelled,/ })).toBeNull();
  });

  it('ignores a push older than what is shown', async () => {
    const page = renderPage();
    await opened(page);
    await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T10:04:00.000Z', counts: counts({ completed: 10 }) });
    expect(filterCounts()).toMatchObject({ Completed: 4, Pending: 5 });
  });

  it('reads the detail again after pushes go quiet, so the buttons follow the state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const page = renderPage();
      await opened(page);
      api.job.mockResolvedValue(detail({ counts: counts({ completed: 8, failed: 2 }), status: 'completed_with_errors', retry: { open: true, retryable: 2 }, cancel: { open: false, waiting: 0 } }));
      await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'failed', failureCode: 'RETRIES_EXHAUSTED', updatedAt: '2026-10-16T10:06:00.000Z', counts: counts({ completed: 8, failed: 2 }) });
      await act(async () => {
        vi.advanceTimersByTime(1_600);
      });
      await screen.findByRole('button', { name: 'Retry failed' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Cancel and Retry', () => {
  it('lets the sender cancel the waiting deliveries after a confirmation', async () => {
    api.cancel.mockResolvedValue({ cancelled: 5 });
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    await user.click(await screen.findByRole('button', { name: 'Cancel distribution' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this distribution?' });
    expect(dialog.textContent).toContain('5 deliveries still waiting');
    expect(api.cancel).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel distribution' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(JOB));
    expect(notify).toHaveBeenCalledWith('3f1c2a9e: 5 deliveries cancelled.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the distribution going when the dialog is answered no or closed with Esc, and Esc does not close the panel', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const page = renderPage({ onOpen });
    await act(async () => page.release());
    await user.click(await screen.findByRole('button', { name: 'Cancel distribution' }));
    await user.click(screen.getByRole('button', { name: 'Keep it going' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel distribution' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.cancel).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers Retry only to the sender', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 7, failed: 3 }), status: 'completed_with_errors', retry: { open: true, retryable: 2 }, cancel: { open: false, waiting: 0 } }));
    api.retry.mockResolvedValue({ retried: 2 });
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    await user.click(await screen.findByRole('button', { name: 'Retry failed' }));
    // The distribution has finished, so there is no Cancel at all.
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith(JOB));
    expect(notify).toHaveBeenCalledWith('3f1c2a9e: 2 deliveries queued again.');
  });

  it('shows neither button to a team viewer, who is told they see only their teams\' deliveries', async () => {
    api.job.mockResolvedValue(
      detail({
        isSender: false,
        taskCount: 2,
        counts: counts({ completed: 1, failed: 1 }),
        status: 'completed_with_errors',
        destinations: ['Cardio / CARDIO-301 / Protocol amendments'],
        fileCount: undefined,
        retry: undefined,
        cancel: undefined,
      }),
    );
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText(/Priya Shah, 16 Oct .*Only the deliveries to your teams are shown/);
    expect(screen.queryByRole('button', { name: /Cancel distribution|Retry failed/ })).toBeNull();
  });

  it('turns Retry off for a cancelled distribution and says why in its title', async () => {
    api.job.mockResolvedValue(
      detail({ counts: counts({ completed: 4, failed: 6 }), status: 'cancelled', cancelledAt: '2026-10-16T10:06:00Z', retry: { open: false, retryable: 0, reason: 'JOB_CANCELLED' }, cancel: { open: false, waiting: 0 } }),
    );
    const page = renderPage();
    await act(async () => page.release());
    const retry = (await screen.findByRole('button', { name: 'Retry failed' })) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe('A cancelled distribution cannot be retried');
    const chip = (screen.getByRole('complementary').querySelector('.status-chip.big') as HTMLElement);
    expect(chip.textContent).toBe('Cancelled');
    expect(chip.getAttribute('title')).toBe('The sender cancelled it and nothing is still running.');
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull(); // a cancelled one has no Cancel
  });

  it('shows Cancel, off with its reason, while deliveries run but none is waiting', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 8, in_progress: 2 }), status: 'in_progress', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await act(async () => page.release());
    const cancel = (await screen.findByRole('button', { name: 'Cancel distribution' })) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(cancel.title).toBe('Nothing is waiting to be delivered');
  });

  it('has no Cancel button on a completed distribution, and no Retry when nothing failed', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 10 }), status: 'completed', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await opened(page);
    expect((screen.getByRole('complementary').querySelector('.status-chip.big') as HTMLElement).textContent).toBe('Completed');
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
  });

  it('says why Retry is off when the window has closed', async () => {
    api.job.mockResolvedValue(
      detail({ counts: counts({ completed: 7, failed: 3 }), status: 'completed_with_errors', retry: { open: false, retryable: 3, reason: 'RETRY_WINDOW_CLOSED' }, cancel: { open: false, waiting: 0 } }),
    );
    const page = renderPage();
    await act(async () => page.release());
    const retry = (await screen.findByRole('button', { name: 'Retry failed' })) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toContain('The retry window closed');
  });

  it('shows the error when the server refuses, and reads the state again', async () => {
    const { ApiFailure } = await import('../auth/session.js');
    api.cancel.mockRejectedValue(new ApiFailure(409, 'No delivery is waiting, so there is nothing to cancel.', 'NOTHING_TO_CANCEL'));
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    await user.click(await screen.findByRole('button', { name: 'Cancel distribution' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel distribution' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No delivery is waiting, so there is nothing to cancel.', 'error'));
    await waitFor(() => expect(api.job).toHaveBeenCalledTimes(2));
  });
});

const summary = (jobId: string, name = 'Priya Shah', over: Partial<JobSummary> = {}): JobSummary => ({
  jobId,
  submittedBy: { userId: name === 'Priya Shah' ? 'u' : 'r', name },
  createdAt: '2026-10-16T10:00:00Z',
  taskCount: 3,
  fileCount: 3,
  destinationCount: 1,
  counts: counts({ completed: 3 }),
  status: 'completed',
  ...over,
});

describe('the list and Open by ID', () => {
  it('opens a distribution from a pasted link and rejects the short id', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    await user.type(screen.getByLabelText('Open by ID'), '3f1c2a9e');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toContain('full distribution id');
    expect(onOpen).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Open by ID'));
    await user.type(screen.getByLabelText('Open by ID'), `https://x.cloudfront.net/#/status/${JOB.toUpperCase()}`);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(JOB);
  });

  it('keeps Open off while the box is empty or only spaces, and clears the note when typing or a new Open starts', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    const open = screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.title).toBe('Paste a distribution id or link first');
    await user.type(screen.getByLabelText('Open by ID'), '   ');
    expect(open.disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(screen.getByLabelText('Open by ID'));
    await user.type(screen.getByLabelText('Open by ID'), '3f1c2a9e');
    await user.click(open);
    expect((await screen.findByRole('alert')).textContent).toContain('full distribution id');
    await user.type(screen.getByLabelText('Open by ID'), 'x');
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(screen.getByLabelText('Open by ID'));
    await user.type(screen.getByLabelText('Open by ID'), JOB);
    await user.click(open);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onOpen).toHaveBeenCalledWith(JOB);
  });

  it('lists my distributions as a table: id, sent, sender, files, destinations, status', async () => {
    renderPage({ jobId: null, mine: mine([summary('bbbbbbbb-0000-4000-8000-000000000000', 'Priya Shah', { fileCount: 7, destinationCount: 4 })]) });
    const table = screen.getByRole('table', { name: 'Distributions' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ID', 'Sent', 'Sender', 'Files', 'Folders', 'Status']);
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['bbbbbbbb', '16 Oct 10:00'.replace('10:00', new Date('2026-10-16T10:00:00Z').toTimeString().slice(0, 5)), 'You', '7', '4', 'Completed']);
  });

  it('lists the team ones, with the sender\'s name, when My teams is picked, and a click opens the panel', async () => {
    api.jobs.mockResolvedValue([summary('aaaaaaaa-0000-4000-8000-000000000000', 'Raj Mehta')]);
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPage({ jobId: null, onOpen, mine: mine([summary('bbbbbbbb-0000-4000-8000-000000000000')]) });
    expect(screen.getByText('bbbbbbbb')).toBeTruthy();
    expect(screen.queryByText('aaaaaaaa')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'My teams' }));
    await screen.findByText('aaaaaaaa');
    expect(api.jobs).toHaveBeenCalledWith('team', 1, 20, undefined);
    expect(screen.getByText('Raj Mehta')).toBeTruthy();
    await user.click(screen.getByText('Raj Mehta')); // the whole row is the target
    expect(onOpen).toHaveBeenCalledWith('aaaaaaaa-0000-4000-8000-000000000000');
  });

  it('keeps the open distribution\'s row in step with its live counts, and leaves the others alone', async () => {
    const pending = (id: string) => summary(id, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' });
    const other = 'bbbbbbbb-0000-4000-8000-000000000000';
    const page = renderPage({ mine: mine([pending(JOB), pending(other)]) });
    await opened(page);
    const row = (id: string) => screen.getByRole('button', { name: `Open distribution ${id.slice(0, 8)}` }).closest('tr') as HTMLElement;
    // The list says Pending for both, but the open one follows the detail it is showing (4 delivered, 1 running).
    expect(row(JOB).textContent).toContain('In progress');
    expect(row(other).textContent).toContain('Pending');

    await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T10:05:10.000Z', counts: counts({ completed: 10 }) });
    expect(row(JOB).textContent).toContain('Completed');
    expect(row(other).textContent).toContain('Pending');
  });

  it('has a designed empty state, a loading state and an error state with a retry', async () => {
    const { unmount } = renderPage({ jobId: null, mine: mine([]) });
    expect(screen.getByText('You have not sent a distribution yet')).toBeTruthy();
    unmount();
    const loading = renderPage({ jobId: null, mine: mine(null) });
    expect(screen.getByLabelText('Loading distributions').getAttribute('aria-busy')).toBe('true');
    loading.unmount();
    const m = mine(null, { error: 'The list could not be loaded.' });
    renderPage({ jobId: null, mine: m });
    expect(screen.getByRole('alert').textContent).toContain('The list could not be loaded.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it('loads the next page when the end of the list scrolls into view, and says so while it loads', async () => {
    let fire: () => void = () => {};
    class FakeObserver {
      constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
        fire = () => cb([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    try {
      const m = mine([summary('bbbbbbbb-0000-4000-8000-000000000000')], { hasMore: true });
      const { rerender } = renderPage({ jobId: null, mine: m });
      expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
      fire();
      expect(m.loadMore).toHaveBeenCalledTimes(1);
      const loading = mine(m.jobs, { hasMore: true, loadingMore: true });
      rerender(<StatusPage meId="u" jobId={null} onOpen={vi.fn()} onOpenUploads={vi.fn()} mine={loading} notify={notify} />);
      expect(screen.getByText('Loading more…')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('upload events', () => {
  it('opens a panel of the events that belong to no distribution', async () => {
    api.audit.mockResolvedValue({
      page: 1,
      limit: 50,
      hasMore: false,
      events: [{ id: 9, occurredAt: '2026-10-16T10:00:00Z', action: 'file.refused', actorId: 'u1', jobId: null, taskId: null, teamId: null, detail: { actorName: 'Priya Shah', fileName: 'eicar.pdf', reason: 'malware found by the scan' } }],
    });
    const onOpenUploads = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderPage({ jobId: null, onOpenUploads });
    await user.click(screen.getByRole('button', { name: 'Upload events' }));
    expect(onOpenUploads).toHaveBeenCalled();
    unmount();

    renderPage({ jobId: null, uploads: true });
    const panel = await screen.findByRole('complementary', { name: 'Upload events' });
    await within(panel).findByText('File refused');
    expect(api.audit).toHaveBeenCalledWith(expect.objectContaining({ actions: ['file.refused'] }));
  });
});
