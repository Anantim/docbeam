// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient, LiveMessage } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { JobDetail, JobSummary } from '../tracking/api.js';
import type { usePagedJobs } from '../tracking/usePagedJobs.js';
import { tooltipOf } from '../testing/tooltip.js';
import { formatWhen } from '../tracking/format.js';
import { DistributionPanel } from './DistributionPanel.js';
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
  // By default the row is "in the list" as far as the page knows: nothing is read and nothing is pinned.
  loadUntil: vi.fn(async () => true),
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
    // The same header as the panel's other states (the short ID as the heading, and Close), with the answer as a note under it (D-F1-78).
    const note = await screen.findByRole('alert');
    expect(within(note).getByText('Distribution not found.')).toBeTruthy();
    expect(note.textContent).toContain('You can see a distribution if you sent it');
    expect(note.classList.contains('notice')).toBe(true);
    const heading = screen.getByRole('heading', { name: '3f1c2a9e' });
    expect(heading.tabIndex).toBe(-1); // focusable like the others
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' })).toBeTruthy();
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

  it('slides in when it opens and out when it closes: the same panel stays 200 ms with a leaving class, then goes; with reduced motion it goes at once (D-F1-47)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    try {
      const f = fakeLive();
      const props = { meId: 'u', filters: {}, onFilters: vi.fn(), onOpen: vi.fn(), all: mine(), notify, live: f.live };
      const view = render(<StatusPage {...props} jobId={null} />);
      expect(document.querySelector('.panel-slot')).toBeNull();
      view.rerender(<StatusPage {...props} jobId={JOB} />);
      const slot = document.querySelector('.panel-slot') as HTMLElement;
      expect(slot.classList.contains('entering')).toBe(true); // it slides in from the right
      const panel = slot.querySelector('.panel');
      await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
      expect(document.querySelector('.panel-slot')?.classList.contains('entering')).toBe(false);

      view.rerender(<StatusPage {...props} jobId={null} />);
      expect(document.querySelector('.panel-slot.leaving .panel')).toBe(panel); // still there, the same element, sliding out
      expect(document.querySelector('.status-layout')?.classList.contains('open')).toBe(true);
      await act(async () => void (await vi.advanceTimersByTimeAsync(250)));
      expect(document.querySelector('.panel-slot')).toBeNull();
      expect(document.querySelector('.status-layout')?.classList.contains('open')).toBe(false);

      // Reduced motion: no waiting.
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
      view.rerender(<StatusPage {...props} jobId={JOB} />);
      expect(document.querySelector('.panel-slot')?.classList.contains('entering')).toBe(false);
      view.rerender(<StatusPage {...props} jobId={null} />);
      expect(document.querySelector('.panel-slot')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('closes with Escape when the focus is still on the list, where the click left it', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const page = renderPage({ onOpen, mine: mine([summary(JOB, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' })]) });
    await opened(page);
    screen.getByRole('button', { name: `Open distribution ${JOB.slice(0, 8)}` }).focus();
    await user.keyboard('{Escape}'); // closes the tooltip the focus brought and the panel (D-F1-47)
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onOpen).toHaveBeenCalledWith(null);
  });
});

describe('the status tabs of the panel (D-F1-77)', () => {
  const group = () => within(screen.getByRole('group', { name: 'Filter deliveries by status' }));
  const tabNames = () => group().getAllByRole('button').map((b) => /^(.+), \d+ deliver/.exec(b.getAttribute('aria-label') ?? '')?.[1]);
  const selectedTab = () => group().getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => /^(.+), \d+ deliver/.exec(b.getAttribute('aria-label') ?? '')?.[1]);
  const show = async (c: Partial<ReturnType<typeof counts>>, status: JobDetail['status'] = 'in_progress') => {
    api.job.mockResolvedValue(detail({ counts: counts(c), taskCount: Object.values(c).reduce((a, b) => a + b, 0), status }));
    const page = renderPage();
    await opened(page);
    return page;
  };

  it('running with every status: All, Completed, Failed, In progress, Pending, Cancelled, in that order, All selected', async () => {
    await show({ completed: 2, failed: 1, in_progress: 1, pending: 3, cancelled: 1 });
    expect(tabNames()).toEqual(['All', 'Completed', 'Failed', 'In progress', 'Pending', 'Cancelled']);
    expect(selectedTab()).toEqual(['All']);
  });

  it('just started, Completed 0: All, Completed (0) and Pending; the rest are not there', async () => {
    await show({ pending: 10 }, 'pending');
    expect(tabNames()).toEqual(['All', 'Completed', 'Pending']);
    expect(filterCounts()).toEqual({ All: 10, Completed: 0, Pending: 10 });
    expect(selectedTab()).toEqual(['All']);
  });

  it('finished, all completed: only the Completed tab, selected, and no All', async () => {
    await show({ completed: 10 }, 'completed');
    expect(tabNames()).toEqual(['Completed']);
    expect(selectedTab()).toEqual(['Completed']);
  });

  it('finished with errors: All, Completed and Failed', async () => {
    await show({ completed: 7, failed: 3 }, 'completed_with_errors');
    expect(tabNames()).toEqual(['All', 'Completed', 'Failed']);
    expect(selectedTab()).toEqual(['All']);
  });

  it('a tab that is selected stays when its count drops to 0 during live updates, until another is picked', async () => {
    const user = userEvent.setup();
    const page = await show({ completed: 4, in_progress: 1, pending: 5 });
    await user.click(screen.getByRole('button', { name: 'In progress, 1 delivery' }));
    expect(selectedTab()).toEqual(['In progress']);
    await page.push({ type: 'task_update', jobId: JOB, taskId: 't1', status: 'completed', updatedAt: '2026-10-16T10:05:10.000Z', counts: counts({ completed: 5, pending: 5 }) });
    expect(filterCounts()).toEqual({ All: 10, Completed: 5, 'In progress': 0, Pending: 5 }); // still there, showing 0
    expect(selectedTab()).toEqual(['In progress']);
    await user.click(screen.getByRole('button', { name: 'Pending, 5 deliveries' }));
    expect(tabNames()).toEqual(['All', 'Completed', 'Pending']); // now it can go
  });

  it('a tab asked for by a link that would be hidden is shown, selected, with its count', async () => {
    const f = fakeLive();
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 7, pending: 3 }), status: 'in_progress' }));
    render(<DistributionPanel jobId={JOB} live={f.live} notify={notify} onClose={() => undefined} onChanged={() => undefined} initialTab="failed" />);
    await act(async () => f.release());
    await screen.findByRole('heading', { name: '3f1c2a9e' });
    expect(tabNames()).toEqual(['All', 'Completed', 'Failed', 'Pending']);
    expect(selectedTab()).toEqual(['Failed']);
    expect(filterCounts()).toMatchObject({ Failed: 0 });
  });
});

describe('live counts', () => {
  it('moves the filter numbers, the bar and the chip when a push arrives', async () => {
    const page = renderPage();
    await opened(page);
    expect(filterCounts()).toEqual({ All: 10, Completed: 4, 'In progress': 1, Pending: 5 }); // Failed has none: no tab (D-F1-77)

    await page.push({
      type: 'task_update',
      jobId: JOB,
      taskId: 't1',
      status: 'completed',
      updatedAt: '2026-10-16T10:05:10.000Z',
      counts: counts({ completed: 10 }),
    });
    expect(filterCounts()).toEqual({ Completed: 10 }); // all completed: only the Completed tab, and it is the selected one
    expect(screen.getByRole('button', { name: 'Completed, 10 deliveries' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('complementary').querySelector('.status-chip.big') as HTMLElement).textContent).toBe('Completed');
  });

  it('shows cancelled deliveries as their own grey bar segment and filter, not as failed', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 3, cancelled: 5 }), taskCount: 8, status: 'cancelled', cancelledAt: '2026-10-16T10:04:00Z', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await opened(page);
    expect(filterCounts()).toEqual({ All: 8, Completed: 3, Cancelled: 5 }); // no Failed tab: red means failed only
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
    expect(dialog.textContent).toContain('The deliveries still waiting will stop. Deliveries already running finish. This can\'t be undone.');
    expect(dialog.textContent).not.toMatch(/CANCELLED|\d deliveries/); // no raw code, no count (D-F1-72)
    expect(api.cancel).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel distribution' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith(JOB));
    expect(notify).toHaveBeenCalledWith('3f1c2a9e: 5 deliveries cancelled.');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('gives the focus back to the Cancel icon when its question closes, however it is answered (D-F1-78)', async () => {
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    const cancel = await screen.findByRole('button', { name: 'Cancel distribution' });
    await user.click(cancel);
    await user.click(screen.getByRole('button', { name: 'Keep it going' }));
    expect(document.activeElement).toBe(cancel);
    await user.click(cancel);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(cancel);
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

  it('has Cancel and Retry as icons just left of Close, then a divider; the full names are the tooltip and the accessible name (D-F1-77)', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 4, failed: 1, pending: 5 }), retry: { open: true, retryable: 1 }, cancel: { open: true, waiting: 5 } }));
    const user = userEvent.setup();
    const page = renderPage();
    await act(async () => page.release());
    const cancel = await screen.findByRole('button', { name: 'Cancel distribution' });
    const retry = screen.getByRole('button', { name: 'Retry failed deliveries' });
    expect(tooltipOf(cancel)).toBe('Cancel distribution');
    expect(tooltipOf(retry)).toBe('Retry failed deliveries');
    // On the first row, in the order Cancel, Retry, divider, Close; icons with no text; the old row of text buttons is gone.
    const tools = document.querySelector('.panel-top .panel-tools') as HTMLElement;
    const order = [...tools.children].map((el) => el.querySelector('button')?.getAttribute('aria-label') ?? el.className);
    expect(order).toEqual(['Cancel distribution', 'Retry failed deliveries', 'panel-divider', 'Close']);
    expect(cancel.textContent).toBe('');
    expect(cancel.className).toBe('icon');
    expect(cancel.querySelector('circle')).not.toBeNull(); // the stop icon: a circle with a square in it
    expect(cancel.querySelector('rect')).not.toBeNull();
    expect(document.querySelector('.panel-actions')).toBeNull();
    expect(screen.queryByText('Retry failed')).toBeNull();
    const bar = screen.getByRole('complementary').querySelector('.jbar') as HTMLElement; // the panel's bar is a Tab stop with the tooltip
    expect(bar.getAttribute('tabindex')).toBe('0');
    expect(tooltipOf(bar)).toBe(bar.getAttribute('aria-label'));
    expect(tooltipOf(bar)).toBe('10 deliveries: 1 failed, 4 completed, 5 pending');
    await user.hover(retry);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Retry failed deliveries');
  });

  it('hides the divider when neither icon shows, and leaves only Close', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 10 }), status: 'completed', retry: { open: false, retryable: 0, reason: 'NOTHING_TO_RETRY' }, cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await opened(page);
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry failed deliveries' })).toBeNull();
    expect(document.querySelector('.panel-divider')).toBeNull();
    expect([...(document.querySelector('.panel-top .panel-tools') as HTMLElement).children].map((el) => el.querySelector('button')?.getAttribute('aria-label'))).toEqual(['Close']);
  });

  it('shows the divider with Retry alone (finished with errors) and with Cancel alone (running, nothing failed)', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 7, failed: 3 }), status: 'completed_with_errors', retry: { open: true, retryable: 2 }, cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await opened(page);
    expect(screen.getByRole('button', { name: 'Retry failed deliveries' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
    expect(document.querySelector('.panel-divider')).not.toBeNull();
    cleanup();
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 4, in_progress: 1, pending: 5 }), retry: { open: false, retryable: 0, reason: 'NOTHING_TO_RETRY' }, cancel: { open: true, waiting: 5 } }));
    const second = renderPage();
    await opened(second);
    expect(screen.getByRole('button', { name: 'Cancel distribution' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry failed deliveries' })).toBeNull();
    expect(document.querySelector('.panel-divider')).not.toBeNull();
  });

  it('offers Retry only to the sender', async () => {
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
    await waitFor(() => expect(document.querySelector('.panel-lead')?.textContent).toMatch(/^Sent by Priya Shah · 16 Oct( 2026)?, \d\d:\d\d$/));
    expect(document.querySelector('.panel-lead')?.textContent).not.toContain('(you)'); // someone else's distribution: no "(you)"
    expect(screen.getByText('Showing only deliveries to Cardio')).toBeTruthy(); // what a screen reader gets
    expect(screen.queryByRole('button', { name: /Cancel distribution|Retry failed deliveries/ })).toBeNull();
    expect(document.querySelector('.panel-divider')).toBeNull(); // no icons, so no divider
  });

  describe('the team note on the "Sent by" line (D-F1-52)', () => {
    // A team member's view: the folders the distribution lists are the ones they may see, so their teams are the first part of each path.
    const asMember = (teams: string[]) =>
      api.job.mockResolvedValue(
        detail({ isSender: false, taskCount: teams.length, counts: counts({ completed: teams.length }), status: 'completed', destinations: teams.map((t) => `${t} / ${t.slice(0, 5)}-1 / Folder`), fileCount: undefined, retry: undefined, cancel: undefined }),
      );
    const chips = () => [...document.querySelectorAll('.panel-sub .team-chips .chip')] as HTMLElement[];
    const chipOf = (name: string) => chips().find((c) => c.textContent === name) as HTMLElement;
    const sentence = () => document.querySelector('.panel-sub .panel-note .sr')?.textContent;

    it('is not shown to the sender, who sees every delivery: no label and no chips', async () => {
      const page = renderPage(); // the default distribution is the sender's own
      await act(async () => page.release());
      await screen.findByText(/^Sent by/);
      expect(document.querySelector('.panel-note')).toBeNull();
      expect(chips()).toHaveLength(0);
      expect(document.querySelector('.panel-sub')?.textContent).not.toMatch(/Showing/);
    });

    it('the old sentence is gone, and no separate row holds a note (D-F1-77)', async () => {
      asMember(['Cardio']);
      const page = renderPage();
      await act(async () => page.release());
      await waitFor(() => expect(chips()).toHaveLength(1));
      expect(document.body.textContent).not.toMatch(/Showing deliveries to your/);
      expect(document.querySelectorAll('.panel-head > .panel-top, .panel-head > .panel-sub')).toHaveLength(2); // the id row and the sent-by row, nothing else
    });

    it('one team: one chip after " · Showing only deliveries to", on the same line as the time', async () => {
      asMember(['Cardio']);
      const page = renderPage();
      await act(async () => page.release());
      await waitFor(() => expect(chips().map((c) => c.textContent)).toEqual(['Cardio']));
      const sub = document.querySelector('.panel-sub') as HTMLElement;
      expect(sub.querySelector('.panel-lead')?.textContent).toMatch(/^Sent by Priya Shah · 16 Oct( 2026)?, \d\d:\d\d$/);
      expect(sub.querySelector('.panel-sep')?.textContent).toBe(' · ');
      expect(sub.querySelector('.panel-note-label')?.textContent).toBe('Showing only deliveries to');
      expect(sentence()).toBe('Showing only deliveries to Cardio');
    });

    it('3 teams: 3 chips sorted A to Z, no "+N"', async () => {
      asMember(['Oncology', 'Cardio', 'Neuro']);
      const page = renderPage();
      await act(async () => page.release());
      await waitFor(() => expect(chips()).toHaveLength(3));
      expect(chips().map((c) => c.textContent)).toEqual(['Cardio', 'Neuro', 'Oncology']);
      expect(document.querySelector('.panel-sub .team-chips .count-link')).toBeNull();
      expect(sentence()).toBe('Showing only deliveries to Cardio, Neuro and Oncology');
    });

    it('10 teams: the first 2 chips and "+8", which opens the shared popover listing all 10 in order; "+8" is a Tab stop (D-F1-78)', async () => {
      const ten = ['Oncology', 'Cardio', 'Neuro', 'Hepatology', 'Alpha', 'Zeta', 'Immunology', 'Renal', 'Delta', 'Pulmonary'];
      asMember(ten);
      const user = userEvent.setup();
      const page = renderPage();
      await act(async () => page.release());
      const sorted = [...ten].sort((a, b) => a.localeCompare(b));
      const more = (await screen.findByRole('button', { name: 'Show all 10 teams' })) as HTMLButtonElement;
      expect(chips().map((c) => c.textContent)).toEqual([sorted[0], sorted[1]]);
      expect(more.textContent).toBe('+8');
      expect(more.classList.contains('count-link')).toBe(true); // the same link as the "+N" of the Files column
      expect(more.tabIndex).toBe(0); // focusable
      expect(sentence()).toBe(`Showing only deliveries to ${sorted.slice(0, -1).join(', ')} and ${sorted[9]}`);
      // A list of names is the light popover, never a dark tooltip.
      await user.click(more);
      const popover = await screen.findByRole('dialog', { name: 'Teams' });
      expect([...popover.querySelectorAll('li')].map((li) => li.textContent)).toEqual(sorted);
      expect(screen.queryByRole('tooltip')).toBeNull();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Teams' })).toBeNull();
      expect(document.activeElement).toBe(more); // the focus goes back to the link
    });

    it('stays on one line: the line never wraps, and a team chip is the folder chip with a 100 px cap (D-F1-78)', () => {
      const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
      expect(css).toMatch(/\.panel-sub \{ display: flex; align-items: center; min-width: 0; overflow: hidden; white-space: nowrap;/);
      expect(css).toMatch(/\.team-chips \.chip \{ max-width: 100px; \}/);
      const chip = /^\.chip \{([^}]*)\}/m.exec(css)?.[1] ?? ''; // the one chip, the same as the folder chips of the Files column
      for (const part of ['background: var(--surface-2)', 'border-radius: var(--radius)', 'font-size: var(--fs-1)', 'text-overflow: ellipsis']) expect(chip).toContain(part);
      expect(css).not.toMatch(/\.team-chip\b/); // no pill and no outline of its own
    });

    it('a long team name is cut and shows in full on hover; a short one has no tooltip', async () => {
      const long = 'Cardiovascular Outcomes Research Network';
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return (this.textContent ?? '').length > 20 ? 300 : 40;
      });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 98);
      asMember([long, 'Cardio']);
      const page = renderPage();
      await act(async () => page.release());
      await waitFor(() => expect(chips()).toHaveLength(2));
      const [short, cut] = [chipOf('Cardio'), chipOf(long)];
      expect(tooltipOf(cut)).toBe(long);
      expect(tooltipOf(short)).toBeNull();
      vi.restoreAllMocks();
    });
  });

  it('shows the shape of the panel while it loads: the sent-by line and the deliveries under their real header', () => {
    api.job.mockReturnValue(new Promise(() => undefined)); // never answers
    renderPage();
    const busy = screen.getByLabelText('Loading the distribution');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('.panel-sub .sk')).not.toBeNull();
    expect(within(busy).getAllByText(/^(Deliveries|Status|Details)$/).length).toBe(3);
    expect(busy.querySelectorAll('.ttable .trow:not(.thead)').length).toBe(4);
  });

  it('says "Sent by <full name> (you) · date" under the header of my own distribution: a muted label, the name in normal weight (D-F1-22)', async () => {
    const page = renderPage();
    await act(async () => page.release());
    const lead = await screen.findByText((_, el) => el?.classList.contains('panel-sub') === true && /^Sent by Priya Shah \(you\) · 16 Oct( 2026)?, \d\d:\d\d$/.test(el.textContent ?? ''));
    expect(lead.querySelector('.sentby')?.textContent).toBe('Sent by');
    expect(lead.querySelector('.sender-name')?.textContent).toBe('Priya Shah (you)');
  });

  it('is dense (D-F1-46): the id, copy icon, status and Close on one line, the sent-by line under it, a 3 px progress line, and no folder chips', async () => {
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByText(/^Sent by/);
    const head = document.querySelector('.panel-head') as HTMLElement;
    const top = head.querySelector('.panel-top') as HTMLElement;
    expect(top.querySelector('h2')?.textContent).toBe(JOB.slice(0, 8));
    expect(top.querySelector('.copy-link')).not.toBeNull();
    expect(top.querySelector('.status-chip')).not.toBeNull();
    expect(within(top).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect([...head.children].map((c) => c.className.split(' ')[0])).toEqual(['panel-top', 'panel-sub', 'tip-wrap']); // (the bar is wrapped by its tooltip, D-F1-72) the bar is the last line of the header, under the sent-by line
    expect(document.querySelector('.jdest, .chip')).toBeNull(); // the folders are in the deliveries table, not here
    const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
    expect(css).toMatch(/\.panel-head \.jbar \{ height: 3px;/);
  });

  it('puts the status tabs and the "Filter…" box on one row; the box and "Clear filter" work (D-F1-46, D-F1-77)', async () => {
    const user = userEvent.setup();
    api.job.mockResolvedValue(detail({ taskCount: 20, counts: counts({ completed: 20 }), status: 'completed' }));
    api.tasks.mockImplementation(async () => ({ page: 1, limit: 100, total: 20, tasks: Array.from({ length: 20 }, (_, i) => ({ taskId: `t${i}`, fileId: `f${i}`, fileName: `File ${String(i).padStart(2, '0')}.pdf`, fileType: 'application/pdf', destinationPath: 'Cardio / A / B', teamId: 'x', status: 'completed', attemptCount: 1, failureCode: null, failureReason: null, updatedAt: '2026-10-16T10:00:00.000Z', fileExpired: false })) }));
    const page = renderPage();
    await act(async () => page.release());
    const section = await screen.findByRole('region', { name: 'Deliveries' });
    expect(within(section).queryByRole('heading', { name: 'Deliveries' })).toBeNull(); // no title above the table (D-F1-50)
    const row = section.querySelector('.panel-section-head') as HTMLElement;
    const box = await within(row).findByRole('textbox', { name: 'Filter deliveries' });
    expect([...row.children].map((c) => c.className.split(' ')[0])).toEqual(['tfilters', 'searchfield']); // the tabs, then the box, in one row
    const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
    expect(css).not.toMatch(/\.panel-section-head \.deliveries-filter \.field \{/); // no height of its own: the box is --control tall, like every control
    expect(css).toMatch(/\.tfilters \{[^}]*min-height: var\(--strip-h\)/);
    expect(box.getAttribute('placeholder')).toBe('Filter…');
    expect(document.querySelectorAll('.dfilter')).toHaveLength(0); // no separate filter row
    await user.type(box, 'zzz');
    await user.click(await screen.findByRole('button', { name: 'Clear filter' }));
    expect((box as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(box);
  });

  it('the "Filter…" box is there with any number of deliveries (no threshold), and off while the selected tab has none (D-F1-77)', async () => {
    api.job.mockResolvedValue(detail({ taskCount: 3, counts: counts({ completed: 3 }), status: 'completed' }));
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByRole('region', { name: 'Deliveries' });
    expect((screen.getByRole('textbox', { name: 'Filter deliveries' }) as HTMLInputElement).disabled).toBe(false);
    cleanup();
    api.job.mockResolvedValue(detail({ taskCount: 0, counts: counts(), status: 'pending' }));
    const empty = renderPage();
    await act(async () => empty.release());
    await screen.findByRole('region', { name: 'Deliveries' });
    expect((screen.getByRole('textbox', { name: 'Filter deliveries' }) as HTMLInputElement).disabled).toBe(true); // nothing to filter: still there, off
  });

  it('has no Retry for a cancelled distribution: it shows only when a failed delivery can be retried', async () => {
    api.job.mockResolvedValue(
      detail({ counts: counts({ completed: 4, failed: 6 }), status: 'cancelled', cancelledAt: '2026-10-16T10:06:00Z', retry: { open: false, retryable: 0, reason: 'JOB_CANCELLED' }, cancel: { open: false, waiting: 0 } }),
    );
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByRole('region', { name: 'Deliveries' });
    expect(screen.queryByRole('button', { name: 'Retry failed deliveries' })).toBeNull();
    const chip = (screen.getByRole('complementary').querySelector('.status-chip.big') as HTMLElement);
    expect(chip.textContent).toBe('Cancelled');
    expect(tooltipOf(chip)).toBe('The sender cancelled it and nothing is still running.');
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull(); // a cancelled one has no Cancel
  });

  it('shows Cancel, off with its reason, while deliveries run but none is waiting', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 8, in_progress: 2 }), status: 'in_progress', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await act(async () => page.release());
    const cancel = (await screen.findByRole('button', { name: 'Cancel distribution' })) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(tooltipOf(cancel)).toBe('Nothing is waiting to be delivered');
  });

  it('has no Cancel button on a completed distribution, and no Retry when nothing failed', async () => {
    api.job.mockResolvedValue(detail({ counts: counts({ completed: 10 }), status: 'completed', cancel: { open: false, waiting: 0 } }));
    const page = renderPage();
    await opened(page);
    expect((screen.getByRole('complementary').querySelector('.status-chip.big') as HTMLElement).textContent).toBe('Completed');
    expect(screen.queryByRole('button', { name: 'Cancel distribution' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry failed deliveries' })).toBeNull();
  });

  it('has no Retry when the window has closed', async () => {
    api.job.mockResolvedValue(
      detail({ counts: counts({ completed: 7, failed: 3 }), status: 'completed_with_errors', retry: { open: false, retryable: 3, reason: 'RETRY_WINDOW_CLOSED' }, cancel: { open: false, waiting: 0 } }),
    );
    const page = renderPage();
    await act(async () => page.release());
    await screen.findByRole('region', { name: 'Deliveries' });
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

const summary = (jobId: string, name = 'Priya Shah', over: Partial<JobSummary> = {}): JobSummary => ({
  jobId,
  submittedBy: { userId: name === 'Priya Shah' ? 'u' : 'r', name },
  createdAt: '2026-10-16T10:00:00Z',
  taskCount: 3,
  fileCount: 3,
  destinationCount: 1,
  fileNames: ['Consent form.pdf', 'Lab results.pdf', 'Visit notes.pdf'],
  destinations: ['Cardio / CARDIO-301 Regulatory / IRB approvals'],
  counts: counts({ completed: 3 }),
  status: 'completed',
  ...over,
});

describe('the list and Open by ID', () => {
  const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Open by ID' }));
    return screen.getByLabelText('Distribution ID or link');
  };

  it('the field and the Open button are --control tall (36 px), like every other control (D-F1-77)', async () => {
    const user = userEvent.setup();
    renderPage({ jobId: null });
    const field = await openCard(user);
    const open = screen.getByRole('button', { name: 'Open' });
    expect(field.className).toBe('field'); // min-height: var(--control)
    expect(open.className).toBe('btn'); // min-height: var(--control); there is no small button class any more
    const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
    expect(css).toMatch(/\.field \{ width: 100%; min-height: var\(--control\)/);
    expect(css).toMatch(/\.btn \{[^}]*min-height: var\(--control\)/);
  });

  it('the Open by ID card gives the focus back to its icon when it closes: after Esc, after a click outside, and after it opens a distribution (D-F1-78)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPage({ jobId: null, onOpen });
    const button = screen.getByRole('button', { name: 'Open by ID' });
    await openCard(user);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(button);
    const field = await openCard(user);
    await user.type(field, `${JOB}{Enter}`);
    expect(onOpen).toHaveBeenCalledWith(JOB);
    expect(screen.queryByRole('form', { name: 'Open a distribution by ID' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closing the panel with Close gives the focus back to the row that opened it', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const page = renderPage({ onOpen, mine: mine([summary(JOB)]) });
    await opened(page);
    await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Close' }));
    expect(onOpen).toHaveBeenCalledWith(null);
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('data-job-id')).toBe(JOB));
  });

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

  it('Open by ID on the distribution that is already open closes the card, brings its row into view and highlights it for a second (D-F1-51)', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPage({ jobId: JOB, onOpen, mine: mine([summary(JOB, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' })]) });
    const field = await openCard(user);
    await user.type(field, `${JOB}{Enter}`);
    expect(onOpen).not.toHaveBeenCalled(); // nothing to open: it is open
    expect(screen.queryByRole('form', { name: 'Open a distribution by ID' })).toBeNull(); // the card is closed
    const row = screen.getByRole('button', { name: `Open distribution ${JOB.slice(0, 8)}` }).closest('tr') as HTMLElement;
    await vi.waitFor(() => expect(row.classList.contains('fresh')).toBe(true)); // the same highlight as a just-sent row
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' }); // and the row is brought into view
    await vi.waitFor(() => expect(row.classList.contains('fresh')).toBe(false), { timeout: 2500 }); // it fades out after a second
  });

  describe('Open by ID and a link bring the row into view and highlight it (D-F1-74)', () => {
    const OTHER = '8a7b6c5d-0000-4000-8000-000000000002';
    const FAR = '9b8c7d6e-0000-4000-8000-000000000009';
    const rowOf = (id: string) => screen.getByRole('button', { name: `Open distribution ${id.slice(0, 8)}` }).closest('tr') as HTMLElement;

    it('another distribution in the list: the list is asked for it, its row is scrolled into view and highlighted', async () => {
      const scrolled = vi.fn();
      Element.prototype.scrollIntoView = scrolled;
      const user = userEvent.setup();
      const onOpen = vi.fn();
      const all = mine([summary(JOB), summary(OTHER, 'Raj Mehta')]);
      renderPage({ jobId: JOB, onOpen, mine: all });
      await user.type(await openCard(user), `${OTHER}{Enter}`);
      expect(onOpen).toHaveBeenCalledWith(OTHER);
      expect(all.loadUntil).toHaveBeenCalledWith(OTHER, 5);
      await vi.waitFor(() => expect(rowOf(OTHER).classList.contains('fresh')).toBe(true));
      expect(scrolled).toHaveBeenCalledWith({ block: 'center' });
      expect(rowOf(OTHER).classList.contains('pinned')).toBe(false); // it is a loaded row: nothing is pinned
    });

    it('a row that is not loaded yet and cannot be reached: it is the first row, pinned, highlighted and selected', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const user = userEvent.setup();
      api.byIdPrefix.mockResolvedValue([summary(FAR, 'Raj Mehta')]); // asked once for the address and once for Open by ID
      const all = mine([summary(JOB), summary(OTHER, 'Raj Mehta')], { loadUntil: vi.fn(async () => false) });
      renderPage({ jobId: FAR, mine: all });
      await user.type(await openCard(user), `${FAR}{Enter}`);
      await vi.waitFor(() => expect(rowOf(FAR).classList.contains('pinned')).toBe(true));
      expect(api.byIdPrefix).toHaveBeenCalledWith(FAR.slice(0, 8));
      const rows = [...document.querySelectorAll('.dist-table tbody tr')];
      expect(rows[0]).toBe(rowOf(FAR)); // at the top, above the loaded rows
      await vi.waitFor(() => expect(rowOf(FAR).classList.contains('fresh')).toBe(true));
      expect(rowOf(FAR).classList.contains('on')).toBe(true);
      expect(rows).toHaveLength(3);
    });

    it('a row that is in the list after reading pages is not pinned', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const user = userEvent.setup();
      const all = mine([summary(JOB), summary(FAR, 'Raj Mehta')]); // loadUntil says true: the pages brought it in
      renderPage({ jobId: FAR, mine: all });
      await user.type(await openCard(user), `${FAR}{Enter}`);
      expect(all.loadUntil).toHaveBeenCalledWith(FAR, 5);
      await vi.waitFor(() => expect(rowOf(FAR).classList.contains('fresh')).toBe(true));
      expect(api.byIdPrefix).not.toHaveBeenCalled();
      expect(rowOf(FAR).classList.contains('pinned')).toBe(false);
    });

    it('a link: a distribution that the address opens is revealed too, and a click on a row is not', async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const user = userEvent.setup();
      const all = mine([summary(JOB), summary(OTHER, 'Raj Mehta')]);
      renderPage({ jobId: OTHER, mine: all });
      await vi.waitFor(() => expect(all.loadUntil).toHaveBeenCalledWith(OTHER, 5)); // opened by the address
      await vi.waitFor(() => expect(rowOf(OTHER).classList.contains('fresh')).toBe(true));
      vi.mocked(all.loadUntil).mockClear();
      await user.click(rowOf(JOB));
      expect(all.loadUntil).not.toHaveBeenCalled(); // a click is on a row that is already in view
    });
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
    expect(rows.map((r) => r.textContent?.replace(/(Today|Yesterday|\d{1,2} \w{3}( \d{4})?), \d\d:\d\d/, '<date>'))).toEqual(['3f1c2a9e<date>You', '3f1c2a9e<date>Raj Mehta']);
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
    expect(tooltipOf(open)).toBe('Enter a distribution ID or link first');
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

  it('lists my distributions as a table: id (sender below), status, sent, and (when there is room) the first file and the first two folders with "+N" (D-F1-40)', async () => {
    const paths = ['Cardio / CARDIO-301 Regulatory / IRB approvals', 'Cardio / CARDIO-301 Regulatory / Protocol amendments', 'Oncology / ONC-118 / Imaging', 'Neuro / NEU-207 / Site approvals'];
    renderPage({ jobId: null, mine: mine([summary('bbbbbbbb-0000-4000-8000-000000000000', 'Priya Shah', { fileCount: 3, destinationCount: 4, fileNames: ['Consent form.pdf', 'Lab results.pdf', 'Visit notes.pdf'], destinations: paths })]) });
    const table = screen.getByRole('table', { name: 'Distributions' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ID', 'Status', 'Sent', 'Files', 'Destinations']); // no Sender column (D-F1-33)
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    const sent = formatWhen('2026-10-16T10:00:00Z'); // "16 Oct, 15:30" in the viewer's zone (with the year once it is another year)
    // The sender is on every row, small and muted under the ID, in every state of the list.
    expect(within(row).getAllByRole('cell').map((c) => c.textContent)).toEqual(['bbbbbbbbYou', 'Completed', sent, 'Consent form.pdf+2', 'IRB approvals, Protocol amendments+2']);
    expect(row.querySelector('.dist-sender')?.textContent).toBe('You');
    // Each is one line with an ellipsis (the text part is cut, the "+N" is not), and the count links list the rest.
    expect(row.querySelectorAll('.cell-text')).toHaveLength(2);
    const more = within(row).getAllByRole('button', { name: /^Show \d+ more/ });
    expect(more.map((b) => b.textContent)).toEqual(['+2', '+2']);
    expect(more.every((b) => b.classList.contains('count-link'))).toBe(true);
  });

  it('lists the other files and folders in the popover of the "+N", with full paths, and a click on it does not open the row', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const paths = ['Cardio / A / One', 'Cardio / A / Two', 'Oncology / B / Three', 'Neuro / C / Four'];
    renderPage({ jobId: null, onOpen, mine: mine([summary('bbbbbbbb-0000-4000-8000-000000000000', 'Priya Shah', { fileNames: ['a.pdf', 'b.pdf', 'c.pdf'], destinations: paths })]) });
    await user.click(screen.getByRole('button', { name: /^Show 2 more folders of/ }));
    const panel = screen.getByRole('dialog', { name: /^More folders of/ });
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Oncology / B / Three', 'Neuro / C / Four']);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Show 2 more files of/ }));
    expect([...screen.getByRole('dialog', { name: /^More files of/ }).querySelectorAll('li')].map((li) => li.textContent)).toEqual(['b.pdf', 'c.pdf']);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a distribution with one file and two folders shows no "+N"', () => {
    renderPage({ jobId: null, mine: mine([summary('bbbbbbbb-0000-4000-8000-000000000000', 'Priya Shah', { fileNames: ['only.pdf'], destinations: ['Cardio / A / One', 'Cardio / A / Two'] })]) });
    const row = within(screen.getByRole('table', { name: 'Distributions' })).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).queryByRole('button', { name: /^Show \d+ more/ })).toBeNull();
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
    expect(within(busy).getAllByRole('columnheader', { hidden: true }).map((h) => h.textContent).filter(Boolean)).toEqual(['ID', 'Status', 'Sent', 'Files', 'Destinations']);
    const rows = busy.querySelectorAll('tbody tr');
    expect(rows.length).toBe(5);
    for (const cls of ['.sk-id', '.sk-sender', '.sk-chip', '.sk-date']) expect(rows[0]?.querySelector(cls)).not.toBeNull();
    loading.unmount();
    const m = mine(null, { error: "The list couldn't be loaded." });
    renderPage({ jobId: null, mine: m });
    expect(screen.getByRole('alert').textContent).toContain("The list couldn't be loaded.");
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(m.refresh).toHaveBeenCalled();
  });

  // The list loads on scroll (D-F1-49, which replaces "Show more" of D-F1-18): a sentinel at the end of its scroll area is watched.
  const stubObserver = () => {
    const watchers: Array<{ options: { rootMargin?: string }; fire: () => void; disconnected: boolean }> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        entry: { fire: () => void; options: { rootMargin?: string }; disconnected: boolean };
        constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void, options: { rootMargin?: string }) {
          this.entry = { options, fire: () => cb([{ isIntersecting: true }]), disconnected: false };
          watchers.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    return watchers;
  };
  const two = [summary('bbbbbbbb-0000-4000-8000-000000000000'), summary('cccccccc-0000-4000-8000-000000000000')];
  const again = (rerender: (ui: React.ReactElement) => void, all: ReturnType<typeof mine>) =>
    rerender(<StatusPage meId="u" jobId={null} filters={{}} onFilters={vi.fn()} onOpen={vi.fn()} all={all} notify={notify} />);

  it('has no "Show more" and no "Showing N": the next page is asked for when the end of the scroll area comes within about five rows, once', async () => {
    const watchers = stubObserver();
    try {
      const m = mine(two, { hasMore: true });
      renderPage({ jobId: null, mine: m });
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
      expect(screen.queryByText(/^Showing \d+/)).toBeNull();
      expect(watchers).toHaveLength(1);
      expect(watchers[0]?.options.rootMargin).toBe('0px 0px 280px 0px'); // 5 rows of 56 px (the look-ahead is its own number)
      expect(m.loadMore).not.toHaveBeenCalled();
      watchers[0]?.fire(); // the sentinel is within reach
      expect(m.loadMore).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says "Loading more…" in a polite live region while it loads, does not watch while it does (no second fetch), and ends with "That\'s everything"', () => {
    const watchers = stubObserver();
    try {
      const m = mine(two, { hasMore: true });
      const { rerender } = renderPage({ jobId: null, mine: m });
      again(rerender, mine(two, { hasMore: true, loadingMore: true }));
      const loading = screen.getByText('Loading more…');
      expect(loading.getAttribute('role')).toBe('status');
      expect(loading.getAttribute('aria-live')).toBe('polite');
      expect(watchers.at(-1)?.disconnected).toBe(true); // nothing watches the end while a page is on its way
      again(rerender, mine(two, { hasMore: false }));
      expect(screen.getByText("That's everything")).toBeTruthy();
      expect(screen.queryByText('Loading more…')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows "Couldn\'t load more · Try again" in the last row on a failure, and Try again asks again', async () => {
    const watchers = stubObserver();
    try {
      const user = userEvent.setup();
      const m = mine(two, { hasMore: true, moreFailed: true });
      renderPage({ jobId: null, mine: m });
      expect(screen.getByText("Couldn't load more.")).toBeTruthy();
      expect(watchers.every((w) => w.disconnected) || watchers.length === 0).toBe(true); // a failed page is not asked for again by scrolling
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(m.loadMore).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks for the next page when Down (or End) is pressed on the last row, and not on a row above it', async () => {
    stubObserver();
    try {
      const user = userEvent.setup();
      const m = mine(two, { hasMore: true });
      renderPage({ jobId: null, mine: m });
      const first = screen.getByRole('button', { name: 'Open distribution bbbbbbbb' });
      first.focus();
      await user.keyboard('{ArrowDown}'); // from the first row to the last: not the last yet
      expect(m.loadMore).not.toHaveBeenCalled();
      await user.keyboard('{ArrowDown}'); // Down on the last row
      expect(m.loadMore).toHaveBeenCalledTimes(1);
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
    for (const icon of icons) expect(tooltipOf(icon)).toBe('Copy link');
    expect(icons.every((i) => i.textContent === '')).toBe(true); // an icon, not a text button
    onOpen.mockClear();
    await user.click(icons[0] as HTMLElement); // the row's icon
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/#/status/${JOB}`); // user-event's clipboard
    expect(onOpen).not.toHaveBeenCalled(); // a click on it does not open or close the panel
    await user.click(icons[1] as HTMLElement); // the panel's
    expect(onOpen).not.toHaveBeenCalled();
    // No toast for a good copy (D-F1-43) and no visible label (D-F1-51): the icon cross-fades to a green tick for 2 seconds, and
    // a polite live region says "Link copied" for a screen reader; then it goes back.
    expect(notify).not.toHaveBeenCalled();
    const first = icons[0] as HTMLElement;
    const wrap = first.closest('.copy-wrap') as HTMLElement;
    expect(first.classList.contains('copied')).toBe(true);
    expect(wrap.querySelector('.copy-icons')?.classList.contains('on')).toBe(true);
    expect(wrap.querySelector('.copied-label')).toBeNull();
    expect(wrap.textContent).toBe('Link copied'); // only the hidden announcement: nothing else is written there
    const live = wrap.querySelector('[role="status"]') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Link copied');
    await vi.waitFor(() => expect(first.classList.contains('copied')).toBe(false), { timeout: 3500 });
    expect(wrap.querySelector('.copy-icons')?.classList.contains('on')).toBe(false);
    expect(live.textContent).toBe('');
  });

  it('says so in a toast only when the copy fails', async () => {
    const user = userEvent.setup();
    const page = renderPage({ onOpen: vi.fn(), mine: mine([summary(JOB, 'Priya Shah', { taskCount: 10, counts: counts({ pending: 10 }), status: 'pending' })]) });
    await opened(page);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getAllByRole('button', { name: 'Copy link' })[0] as HTMLElement);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("The link couldn't be copied.", 'error'));
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
    await screen.findByText('No matches'); // one wording for every filter result, with a "Clear filters" link (D-F1-78)
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
