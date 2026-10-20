// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient, LiveMessage } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { JobDetail, JobSummary } from '../tracking/api.js';
import type { usePagedJobs } from '../tracking/usePagedJobs.js';
import { StatusPage } from './StatusPage.js';

type StatusProps = Parameters<typeof StatusPage>[0];

const api = vi.hoisted(() => ({ job: vi.fn(), jobs: vi.fn(), tasks: vi.fn(), cancel: vi.fn(), retry: vi.fn(), members: vi.fn(), teams: vi.fn(), byIdPrefix: vi.fn() }));
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

function renderPage(
  over: { jobId?: string | null; onOpen?: (id: string | null) => void; onLive?: StatusProps['onLive']; live?: LiveClient; mine?: ReturnType<typeof mine>; filters?: StatusProps['filters']; onFilters?: StatusProps['onFilters'] } = {},
) {
  const f = fakeLive();
  const utils = render(
    <StatusPage
      meId="u"
      jobId={'jobId' in over ? (over.jobId ?? null) : JOB}
      filters={over.filters ?? {}}
      onFilters={over.onFilters ?? vi.fn()}
      onOpen={over.onOpen ?? vi.fn()}
      onLive={over.onLive}
      all={over.mine ?? mine()}
      notify={notify}
      live={over.live ?? f.live}
    />,
  );
  return { ...f, ...utils };
}

beforeEach(() => {
  api.job.mockResolvedValue(detail());
  api.jobs.mockResolvedValue({ items: [], nextCursor: null });
  api.members.mockResolvedValue([]);
  api.teams.mockResolvedValue([]);
  api.tasks.mockResolvedValue({ page: 1, limit: 100, total: 0, tasks: [] });
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

  it('shows the summary and the deliveries in the panel, and no audit history anywhere (D-F1-13)', async () => {
    const page = renderPage();
    await opened(page);
    const panel = screen.getByRole('complementary', { name: 'Distribution 3f1c2a9e' });
    expect(within(panel).getByRole('region', { name: 'Deliveries' })).toBeTruthy();
    expect(within(panel).queryByText('History')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload events' })).toBeNull();
    expect(Object.keys(api)).not.toContain('audit'); // the web app has no audit client
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

  it('closes with Escape when the focus is still on the list, where the click left it', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const page = renderPage({ onOpen, mine: mine([summary(JOB, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' })]) });
    await opened(page);
    screen.getByRole('button', { name: `Open distribution ${JOB.slice(0, 8)}` }).focus();
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
    const lead = await screen.findByText((_, el) => el?.classList.contains('lead') === true && /^Sent by Priya Shah · 16 Oct .*Only the deliveries to your teams are shown/.test(el.textContent ?? ''));
    expect(lead.textContent).not.toContain('(you)'); // someone else's distribution: no "(you)"
    expect(screen.queryByRole('button', { name: /Cancel distribution|Retry failed/ })).toBeNull();
  });

  it('shows the shape of the panel while it loads: the sent-by line, the progress bar and the deliveries under their real header', () => {
    api.job.mockReturnValue(new Promise(() => undefined)); // never answers
    renderPage();
    const busy = screen.getByLabelText('Loading the distribution');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.querySelector('.lead .sk')).not.toBeNull();
    expect(busy.querySelector('.sk-bar')).not.toBeNull();
    expect(within(busy).getAllByText(/File and folder|Status|Attempts|Details/).length).toBe(4);
    expect(busy.querySelectorAll('.ttable .trow:not(.thead)').length).toBe(4);
  });

  it('says "Sent by <full name> (you) · date" under the header of my own distribution: a muted label, the name in normal weight (D-F1-22)', async () => {
    const page = renderPage();
    await act(async () => page.release());
    const lead = await screen.findByText((_, el) => el?.classList.contains('lead') === true && /^Sent by Priya Shah \(you\) · 16 Oct \d\d:\d\d$/.test(el.textContent ?? ''));
    expect(lead.querySelector('.sentby')?.textContent).toBe('Sent by');
    expect(lead.querySelector('.sender-name')?.textContent).toBe('Priya Shah (you)');
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
  const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Open by ID' }));
    return screen.getByLabelText('Distribution ID or link');
  };

  it('Open by ID is a small icon button: no box on the page until it is pressed, then one field in a card', async () => {
    const user = userEvent.setup();
    renderPage({ jobId: null });
    expect(screen.queryByLabelText('Distribution ID or link')).toBeNull();
    expect(screen.queryByPlaceholderText(/Paste a distribution id/)).toBeNull();
    const button = screen.getByRole('button', { name: 'Open by ID' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const field = await openCard(user);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field);
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Distribution ID or link')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('opens a distribution from a pasted link or a full id, with the field named "Distribution ID or link"', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    const field = await openCard(user);
    expect(field.getAttribute('placeholder')).toBe('Distribution ID or link');
    await user.type(field, `https://x.cloudfront.net/#/status/${JOB.toUpperCase()}`);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith(JOB);
    expect(screen.queryByLabelText('Distribution ID or link')).toBeNull(); // the card closes
    expect(api.byIdPrefix).not.toHaveBeenCalled(); // a full id needs no look-up
  });

  it('drops a look-up that answers after the text was changed', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    const field = await openCard(user);
    let answer: (v: unknown[]) => void = () => undefined;
    api.byIdPrefix.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await user.type(field, '3f1c2a9e{Enter}');
    await user.clear(field); // the person changed their mind while it was running
    answer([summary(JOB)]);
    await new Promise((r) => setTimeout(r, 50));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('takes the 8 characters the list shows: one match opens it, several are listed to choose from, none says so, bad input says what to enter (D-F1-32)', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    const field = await openCard(user);

    api.byIdPrefix.mockResolvedValueOnce([summary(JOB)]);
    await user.type(field, '3F1C2A9E{Enter}');
    expect(api.byIdPrefix).toHaveBeenLastCalledWith('3f1c2a9e'); // lower-cased
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(JOB));

    onOpen.mockClear();
    const again = await openCard(user);
    api.byIdPrefix.mockResolvedValueOnce([summary('3f1c2a9e-0000-4000-8000-000000000001'), summary('3f1c2a9e-0000-4000-8000-000000000002', 'Raj Mehta')]);
    await user.type(again, '3f1c2a9e{Enter}');
    const list = await screen.findByRole('list', { name: 'Distributions with that ID' });
    expect(onOpen).not.toHaveBeenCalled(); // several: the person chooses
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent?.replace(/\d{1,2} \w{3} \d\d:\d\d/, '<date>'))).toEqual(['3f1c2a9e<date>You', '3f1c2a9e<date>Raj Mehta']);
    await user.click(rows[1] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith('3f1c2a9e-0000-4000-8000-000000000002');

    const third = await openCard(user);
    api.byIdPrefix.mockResolvedValueOnce([]);
    await user.type(third, 'abcdef01{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe('No distribution with that ID that you can see.');

    await user.clear(third);
    await user.type(third, '12345{Enter}'); // neither 8 characters, a full id nor a link
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the 8-character ID from the list, the full ID, or a link.');
    expect(api.byIdPrefix).toHaveBeenCalledTimes(3); // the bad input never reached the server
  });

  it('keeps Open off while the field is empty or only spaces, and clears the note when typing starts again', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderPage({ jobId: null, onOpen });
    const field = await openCard(user);
    const open = screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.title).toBe('Enter a distribution ID or link first');
    await user.type(field, '   ');
    expect(open.disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(field);
    await user.type(field, '3f1c2a');
    await user.click(open);
    expect((await screen.findByRole('alert')).textContent).toContain('8-character ID');
    await user.type(field, 'x');
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(field);
    await user.type(field, `${JOB}{Enter}`);
    expect(onOpen).toHaveBeenCalledWith(JOB);
  });

  it('lists my distributions as a table: id, status, sent, and (when there is room) sender, files, folders', async () => {
    renderPage({ jobId: null, mine: mine([summary('bbbbbbbb-0000-4000-8000-000000000000', 'Priya Shah', { fileCount: 7, destinationCount: 4 })]) });
    const table = screen.getByRole('table', { name: 'Distributions' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ID', 'Status', 'Sent', 'Files', 'Folders']); // no Sender column (D-F1-33)
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    const sent = '16 Oct 10:00'.replace('10:00', new Date('2026-10-16T10:00:00Z').toTimeString().slice(0, 5));
    // The sender is on every row, small and muted under the ID, in every state of the list.
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['bbbbbbbbYou', 'Completed', sent, '7', '4']);
    expect(row.querySelector('.dist-sender')?.textContent).toBe('You');
  });

  it('shows the sender\'s name on a row somebody else sent, and a click on the row opens it (everything I can see, D-F1-21)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPage({ jobId: null, onOpen, mine: mine([summary('aaaaaaaa-0000-4000-8000-000000000000', 'Raj Mehta'), summary('bbbbbbbb-0000-4000-8000-000000000000')]) });
    expect(screen.getAllByText('Raj Mehta').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'My teams' })).toBeNull(); // the switch is gone
    expect(screen.queryByRole('button', { name: 'Mine' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull(); // so is the status dropdown
    await user.click(screen.getAllByText('Raj Mehta')[0] as HTMLElement); // the whole row is the target
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
    expect(screen.getByText('No distributions yet')).toBeTruthy();
    unmount();
    const loading = renderPage({ jobId: null, mine: mine(null) });
    const busy = screen.getByLabelText('Loading distributions');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // The real header row, and in each placeholder row grey bars shaped like the ID, the sender line, the chip and the date (D-F1-22).
    expect(within(busy).getAllByRole('columnheader', { hidden: true }).map((h) => h.textContent).filter(Boolean)).toEqual(['ID', 'Status', 'Sent', 'Files', 'Folders']); // the last, empty column holds the spare width
    const rows = busy.querySelectorAll('tbody tr');
    expect(rows.length).toBe(5);
    for (const cls of ['.sk-id', '.sk-sender', '.sk-chip', '.sk-date']) expect(rows[0]?.querySelector(cls)).not.toBeNull();
    loading.unmount();
    const m = mine(null, { error: 'The list could not be loaded.' });
    renderPage({ jobId: null, mine: m });
    expect(screen.getByRole('alert').textContent).toContain('The list could not be loaded.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(m.refresh).toHaveBeenCalled();
  });

  it('loads the next page only when Show more is pressed (no infinite scroll), says "Showing N", and says so while it loads (D-F1-18)', async () => {
    let watched = 0;
    class FakeObserver {
      constructor() {
        watched += 1;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    try {
      const user = userEvent.setup();
      const m = mine([summary('bbbbbbbb-0000-4000-8000-000000000000'), summary('cccccccc-0000-4000-8000-000000000000')], { hasMore: true });
      const { rerender } = renderPage({ jobId: null, mine: m });
      expect(screen.getByText('Showing 2')).toBeTruthy();
      expect(watched).toBe(0); // nothing watches the end of the list
      expect(m.loadMore).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Show more' }));
      expect(m.loadMore).toHaveBeenCalledTimes(1);
      const loading = mine(m.jobs, { hasMore: true, loadingMore: true });
      rerender(<StatusPage meId="u" jobId={null} filters={{}} onFilters={vi.fn()} onOpen={vi.fn()} all={loading} notify={notify} />);
      expect(screen.getByText('Loading more…')).toBeTruthy();
      const last = mine(m.jobs, { hasMore: false });
      rerender(<StatusPage meId="u" jobId={null} filters={{}} onFilters={vi.fn()} onOpen={vi.fn()} all={last} notify={notify} />);
      expect(screen.getByText('Showing 2')).toBeTruthy(); // the count stays at the end, with no button
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the copy icon after a distribution id (D-F1-18)', () => {
  it('is in each row and in the panel header, has no "Copy link" text button, and copies the link without opening or closing anything', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const m = mine([summary(JOB, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' })]);
    const page = renderPage({ onOpen, mine: m });
    await opened(page);
    const icons = screen.getAllByRole('button', { name: 'Copy link' });
    expect(icons).toHaveLength(2); // the row and the panel header
    for (const icon of icons) expect(icon.getAttribute('title')).toBe('Copy link');
    expect(icons.every((i) => i.textContent === '')).toBe(true); // an icon, not a text button
    onOpen.mockClear();
    await user.click(icons[0] as HTMLElement); // the row's icon
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/#/status/${JOB}`); // user-event's clipboard
    expect(onOpen).not.toHaveBeenCalled(); // a click on it does not open or close the panel
    await user.click(icons[1] as HTMLElement); // the panel's
    expect(onOpen).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Link copied.'));
  });
});

describe('the panel of a distribution that was just sent (D-F1-31)', () => {
  it('takes the focus on its heading when it opens, and only for the one that was sent', async () => {
    const f = fakeLive();
    const { unmount } = render(<StatusPage meId="u" jobId={JOB} filters={{}} onFilters={vi.fn()} onOpen={vi.fn()} all={mine()} notify={notify} live={f.live} focusJobId={JOB} />);
    await act(async () => f.release());
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'));
    expect(document.activeElement?.textContent).toBe(JOB.slice(0, 8));
    unmount();
    const g = fakeLive();
    render(<StatusPage meId="u" jobId={JOB} filters={{}} onFilters={vi.fn()} onOpen={vi.fn()} all={mine()} notify={notify} live={g.live} focusJobId={null} />);
    await act(async () => g.release());
    await screen.findByText(/Sent by/);
    expect(document.activeElement?.tagName).not.toBe('H2'); // a panel opened by a click does not steal the focus
  });
});

describe('opening Status (D-F1-25)', () => {
  it('reads the list again once, so a distribution sent to my team meanwhile is there', () => {
    const all = mine([summary('bbbbbbbb-0000-4000-8000-000000000000')]);
    renderPage({ jobId: null, mine: all });
    expect(all.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the filter row (D-F1-21)', () => {
  const bar = () => within(screen.getByRole('group', { name: 'Filters' }));
  const twoTeams = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Cardio' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Oncology' },
  ];

  it('is one row of small buttons: Status, Sender, Sent; Team only for a person in more than one team', async () => {
    renderPage({ jobId: null });
    expect(bar().getAllByRole('button').map((b) => b.textContent)).toEqual(['Status', 'Sender', 'Sent']); // no team list yet, no "Clear filters"
    cleanup();
    api.teams.mockResolvedValue([twoTeams[0]]);
    renderPage({ jobId: null });
    await waitFor(() => expect(api.teams).toHaveBeenCalled());
    expect(bar().queryByRole('button', { name: 'Team' })).toBeNull(); // one team: no Team filter
    cleanup();
    api.teams.mockResolvedValue(twoTeams);
    renderPage({ jobId: null });
    expect(await bar().findByRole('button', { name: 'Team' })).toBeTruthy();
  });

  it('opens a short menu per filter with the choices of the design, and a choice sets the filter', async () => {
    const user = userEvent.setup();
    const onFilters = vi.fn();
    api.members.mockResolvedValue([
      { userId: 'u', name: 'Priya Shah' }, // me: listed as "Me", not twice
      { userId: '33333333-3333-4333-8333-333333333333', name: 'Raj Mehta' },
    ]);
    api.teams.mockResolvedValue(twoTeams);
    renderPage({ jobId: null, onFilters });
    await bar().findByRole('button', { name: 'Team' });
    await waitFor(() => expect(api.members).toHaveBeenCalled());
    const choices = async (name: string): Promise<string[]> => {
      await user.click(bar().getByRole('button', { name }));
      const labels = within(screen.getByRole('menu', { name })).getAllByRole('menuitemradio').map((i) => i.textContent);
      await user.keyboard('{Escape}');
      return labels;
    };
    expect(await choices('Status')).toEqual(['Any status', 'Pending', 'In progress', 'Completed', 'Completed with errors', 'Cancelled']);
    await waitFor(async () => expect(await choices('Sender')).toEqual(['Anyone', 'Me', 'Raj Mehta']));
    expect(await choices('Sent')).toEqual(['Any time', 'Today', 'Last 7 days', 'Last 30 days']);
    expect(await choices('Team')).toEqual(['Any team', 'Cardio', 'Oncology']);

    await user.click(bar().getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Completed with errors' }));
    expect(onFilters).toHaveBeenLastCalledWith({ status: 'completed_with_errors' });
    expect(screen.queryByRole('menu')).toBeNull(); // the menu closes on a choice
    await user.click(bar().getByRole('button', { name: 'Sender' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Raj Mehta' }));
    expect(onFilters).toHaveBeenLastCalledWith({ sender: '33333333-3333-4333-8333-333333333333' });
  });

  it('shows a set filter\'s value on its button in the accent style, and "Clear filters" only while one is set', async () => {
    const user = userEvent.setup();
    const onFilters = vi.fn();
    api.jobs.mockResolvedValue({ items: [], nextCursor: null });
    renderPage({ jobId: null, onFilters, filters: { sender: 'me', sent: '7d' } });
    const sender = bar().getByRole('button', { name: 'Sender: Me' });
    expect(sender.className).toContain('on');
    expect(bar().getByRole('button', { name: 'Sent: Last 7 days' }).className).toContain('on');
    expect(bar().getByRole('button', { name: 'Status' }).className).not.toContain('on');
    await user.click(bar().getByRole('button', { name: 'Clear filters' }));
    expect(onFilters).toHaveBeenCalledWith({});
  });

  it('reads the list again with the filters, from the server, while the app\'s unfiltered list stays untouched', async () => {
    api.jobs.mockResolvedValue({ items: [summary('aaaaaaaa-0000-4000-8000-000000000000', 'Raj Mehta')], nextCursor: null });
    const all = mine([summary('bbbbbbbb-0000-4000-8000-000000000000')]);
    renderPage({ jobId: null, mine: all, filters: { sender: 'me' } });
    await screen.findByText('aaaaaaaa');
    expect(screen.queryByText('bbbbbbbb')).toBeNull(); // the filtered list is its own
    expect(api.jobs).toHaveBeenCalledWith({ sender: 'me' }, null, 20);
  });

  it('says no distribution matches when filters leave nothing, and offers to clear them', async () => {
    const user = userEvent.setup();
    const onFilters = vi.fn();
    api.jobs.mockResolvedValue({ items: [], nextCursor: null });
    renderPage({ jobId: null, onFilters, filters: { status: 'cancelled' } });
    await screen.findByText('No distribution matches these filters');
    await user.click(within(document.querySelector('.state') as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    expect(onFilters).toHaveBeenCalledWith({});
  });

  it('Esc closes an open menu and does not close the panel behind it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPage({ onOpen });
    await user.click(bar().getByRole('button', { name: 'Status' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('the badge on the Status tab follows the open distribution (D-F1-15)', () => {
  it('tells the app the live counts, and reads my list again the moment the distribution finishes', async () => {
    const onLive = vi.fn();
    const m = mine([summary(JOB, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' })]);
    const page = renderPage({ mine: m, onLive });
    await opened(page);
    expect(onLive).toHaveBeenCalledWith(JOB, counts({ completed: 4, in_progress: 1, pending: 5 })); // the detail it shows
    expect(m.refresh).toHaveBeenCalledTimes(1); // only the read when Status opened; still running, so no other read
    vi.mocked(m.refresh).mockClear();

    await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T10:05:10.000Z', counts: counts({ completed: 10 }) });
    expect(onLive).toHaveBeenLastCalledWith(JOB, counts({ completed: 10 }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1)); // finished: read at once, once
  });
});
