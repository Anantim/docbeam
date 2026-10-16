// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient, LiveMessage } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { JobDetail, JobSummary } from '../tracking/api.js';
import { StatusPage } from './StatusPage.js';

const api = vi.hoisted(() => ({ job: vi.fn(), jobs: vi.fn(), tasks: vi.fn(), cancel: vi.fn(), retry: vi.fn(), audit: vi.fn() }));
vi.mock('../tracking/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  trackingApi: api,
}));

const JOB = '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90';
const counts = (c: Partial<JobDetail['counts']> = {}) => ({ pending: 0, in_progress: 0, completed: 0, failed: 0, ...c });

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

const mine = (jobs: JobSummary[] | null = []) => ({ jobs, error: '', refresh: vi.fn(async () => undefined) });
const notify = vi.fn();

function renderPage(over: { jobId?: string | null; onOpen?: (id: string | null) => void; live?: LiveClient; mine?: ReturnType<typeof mine> } = {}) {
  const f = fakeLive();
  const utils = render(
    <StatusPage jobId={'jobId' in over ? (over.jobId ?? null) : JOB} onOpen={over.onOpen ?? vi.fn()} mine={over.mine ?? mine()} notify={notify} live={over.live ?? f.live} />,
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

describe('opening a distribution: subscribe first, fetch after', () => {
  it('does not fetch until the live connection has answered, then fetches the job and its deliveries', async () => {
    const page = renderPage();
    expect(page.order).toEqual([`watch ${JOB}`]);
    await act(async () => undefined);
    expect(api.job).not.toHaveBeenCalled(); // the subscription is not confirmed yet
    expect(api.tasks).not.toHaveBeenCalled();

    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    expect(page.order).toEqual([`watch ${JOB}`, 'subscribed']);
    expect(api.job).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.tasks).toHaveBeenCalledTimes(1));
  });

  it('stops watching when the distribution is closed', async () => {
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    page.unmount();
    expect(page.spy.unwatch).toHaveBeenCalled();
  });

  it('fetches again exactly once after a reconnect has subscribed again', async () => {
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    await waitFor(() => expect(api.tasks).toHaveBeenCalledTimes(1));
    await page.resync(JOB);
    await waitFor(() => expect(api.job).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.tasks).toHaveBeenCalledTimes(2));
    await page.resync('some-other-job');
    expect(api.job).toHaveBeenCalledTimes(2);
  });

  it('shows the not-found card, the same for a missing and a hidden distribution', async () => {
    const { ApiFailure } = await import('../auth/session.js');
    api.job.mockRejectedValue(new ApiFailure(404, 'That distribution was not found.', 'NOT_FOUND'));
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('Distribution not found');
  });
});

describe('live counts', () => {
  it('moves the counts, the bar and the chip when a push arrives', async () => {
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    const counts4 = () => within(screen.getByLabelText('Counts')).getAllByText(/^\d+$/).map((e) => e.textContent);
    expect(counts4()).toEqual(['4', '0', '1', '5']);

    await page.push({
      type: 'task_update',
      jobId: JOB,
      taskId: 't1',
      status: 'completed',
      updatedAt: '2026-10-16T10:05:10.000Z',
      counts: counts({ completed: 10 }),
    });
    expect(counts4()).toEqual(['10', '0', '0', '0']);
    expect(screen.getByRole('status').textContent).toBe('Completed');
  });

  it('ignores a push older than what is shown', async () => {
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T10:04:00.000Z', counts: counts({ completed: 10 }) });
    expect(within(screen.getByLabelText('Counts')).getAllByText(/^\d+$/).map((e) => e.textContent)).toEqual(['4', '0', '1', '5']);
  });

  it('reads the detail again after pushes go quiet, so the buttons follow the state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const page = renderPage();
      await act(async () => page.release());
      await screen.findByText('3f1c2a9e');
      api.job.mockResolvedValue(detail({ counts: counts({ completed: 8, failed: 2 }), status: 'completed_with_errors', retry: { open: true, retryable: 2 }, cancel: { open: false, waiting: 0 } }));
      await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'failed', failureCode: 'RETRIES_EXHAUSTED', updatedAt: '2026-10-16T10:06:00.000Z', counts: counts({ completed: 8, failed: 2 }) });
      await act(async () => {
        vi.advanceTimersByTime(1_600);
      });
      await screen.findByRole('button', { name: 'Retry failed deliveries' });
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

  it('keeps the distribution going when the dialog is answered no or closed with Esc', async () => {
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    await user.click(await screen.findByRole('button', { name: 'Cancel distribution' }));
    await user.click(screen.getByRole('button', { name: 'Keep it going' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel distribution' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('offers Retry only to the sender, with the reason it is allowed', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 7, failed: 3 }), status: 'completed_with_errors', retry: { open: true, retryable: 2 }, cancel: { open: false, waiting: 0 } }));
    api.retry.mockResolvedValue({ retried: 2 });
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    await user.click(await screen.findByRole('button', { name: 'Retry failed deliveries' }));
    // The distribution has finished, so there is no Cancel at all.
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith(JOB));
    expect(notify).toHaveBeenCalledWith('3f1c2a9e: 2 deliveries queued again.');
  });

  it('explains the retry banner: what a retry can and cannot fix', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 6, failed: 4 }), status: 'completed_with_errors', retry: { open: true, retryable: 3 }, cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText(/3 deliveries failed for a reason a retry can fix/);
    expect(screen.getByText(/1 failed for a reason a retry cannot fix/)).toBeTruthy();
  });

  it('shows neither button to a team viewer, who sees only their deliveries and why', async () => {
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
    await screen.findByText(/You see 2 deliveries, the ones to Cardio/);
    expect(screen.getByText(/Deliveries to other teams are hidden from you/)).toBeTruthy();
    expect(screen.getByText(/Only Priya Shah, who sent this distribution, can retry/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel distribution|Retry failed/ })).toBeNull();
  });

  it('turns Retry off for a cancelled distribution and says why', async () => {
    api.job.mockResolvedValue(
      detail({ counts: counts({ completed: 4, failed: 6 }), status: 'cancelled', cancelledAt: '2026-10-16T10:06:00Z', retry: { open: false, retryable: 0, reason: 'JOB_CANCELLED' }, cancel: { open: false, waiting: 0 } }),
    );
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText(/This distribution was cancelled, so Retry is off/);
    expect(screen.getByRole('status').textContent).toBe('Cancelled');
    expect(screen.getByRole('status').getAttribute('title')).toBe('The sender cancelled it and nothing is still running.');
    const retry = screen.getByRole('button', { name: 'Retry failed deliveries' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe('A cancelled distribution cannot be retried');
    // A cancelled distribution has no Cancel button.
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
  });

  it('shows Cancel, off with its reason, while deliveries run but none is waiting', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 8, in_progress: 2 }), status: 'in_progress', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await act(async () => page.release());
    const cancel = (await screen.findByRole('button', { name: 'Cancel distribution' })) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(cancel.title).toBe('Nothing is waiting to be delivered');
  });

  it('has no Cancel button on a completed distribution', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 10 }), status: 'completed', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    expect(screen.getByRole('status').textContent).toBe('Completed');
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
  });

  it('says why Retry is off when the window has closed', async () => {
    api.job.mockResolvedValue(
      detail({ counts: counts({ completed: 7, failed: 3 }), status: 'completed_with_errors', retry: { open: false, retryable: 3, reason: 'RETRY_WINDOW_CLOSED' }, cancel: { open: false, waiting: 0 } }),
    );
    const page = renderPage();
    await act(async () => page.release());
    const retry = (await screen.findByRole('button', { name: 'Retry failed deliveries' })) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toContain('The retry window closed');
  });

  it('does not show Retry when nothing failed', async () => {
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText('3f1c2a9e');
    expect(screen.queryByRole('button', { name: 'Retry failed deliveries' })).toBeNull();
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

describe('the list and Open by ID', () => {
  it('opens a distribution from a pasted link and rejects the short id', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    expect(screen.getByText(/Pick a distribution from the list/)).toBeTruthy();
    await user.type(screen.getByLabelText('Open by ID'), '3f1c2a9e');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toContain('full distribution id');
    expect(onOpen).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Open by ID'));
    await user.type(screen.getByLabelText('Open by ID'), `https://x.cloudfront.net/#/status/${JOB.toUpperCase()}`);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(JOB);
  });

  it('lists my distributions, then the team ones when My teams is picked', async () => {
    const job = (jobId: string, name: string): JobSummary => ({
      jobId,
      submittedBy: { userId: 'u', name },
      createdAt: '2026-10-16T10:00:00Z',
      taskCount: 3,
      counts: counts({ completed: 3 }),
      status: 'completed',
    });
    api.jobs.mockResolvedValue([job('aaaaaaaa-0000-4000-8000-000000000000', 'Priya Shah')]);
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPage({ jobId: null, onOpen, mine: mine([job('bbbbbbbb-0000-4000-8000-000000000000', 'Priya Shah')]) });
    expect(screen.getByText('bbbbbbbb')).toBeTruthy();
    expect(screen.queryByText('aaaaaaaa')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'My teams' }));
    await screen.findByText('aaaaaaaa');
    expect(api.jobs).toHaveBeenCalledWith('team');
    expect(screen.getByText(/Priya Shah, .*3 deliveries to your teams/)).toBeTruthy();
    await user.click(screen.getByText('aaaaaaaa'));
    expect(onOpen).toHaveBeenCalledWith('aaaaaaaa-0000-4000-8000-000000000000');
  });

  it('keeps the open distribution\'s card in step with its live counts, and leaves the others alone', async () => {
    const job = (jobId: string): JobSummary => ({
      jobId,
      submittedBy: { userId: 'u', name: 'Priya Shah' },
      createdAt: '2026-10-16T10:00:00Z',
      taskCount: 10,
      counts: counts({ pending: 10 }),
      status: 'pending',
    });
    const other = 'bbbbbbbb-0000-4000-8000-000000000000';
    const page = renderPage({ mine: mine([job(JOB), job(other)]) });
    await act(async () => page.release());
    await screen.findByRole('heading', { name: '3f1c2a9e' });
    const card = (id: string) => screen.getByText(id.slice(0, 8), { selector: '.jid' }).closest('.jcard') as HTMLElement;
    // The list says Pending for both, but the open one follows the detail it is showing (4 delivered, 1 running).
    expect(card(JOB).textContent).toContain('In progress');
    expect(card(other).textContent).toContain('Pending');

    await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T10:05:10.000Z', counts: counts({ completed: 10 }) });
    expect(card(JOB).textContent).toContain('Completed');
    expect(card(other).textContent).toContain('Pending');
  });

  it('says so when there is nothing to list', async () => {
    renderPage({ jobId: null, mine: mine([]) });
    expect(screen.getByText(/You have not sent a distribution yet/)).toBeTruthy();
  });
});
