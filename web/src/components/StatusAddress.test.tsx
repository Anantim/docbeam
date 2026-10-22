// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClient } from '../live/socket.js';
import type * as ApiModule from '../tracking/api.js';
import type { JobDetail, JobSummary } from '../tracking/api.js';
import type { Filters } from '../tracking/filters.js';
import { StatusPage } from './StatusPage.js';

// The filters of an address that do not apply to the person are dropped, and the retry notice of the panel (D-F1-81).

const api = vi.hoisted(() => ({ job: vi.fn(), jobs: vi.fn(), tasks: vi.fn(), cancel: vi.fn(), retry: vi.fn(), members: vi.fn(), teams: vi.fn(), byIdPrefix: vi.fn() }));
vi.mock('../tracking/api.js', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), trackingApi: api }));

const JOB = '3f1c2a9e-84d5-4b6a-9c11-0a5f6d7e8b90';
const CARDIO = 'c0000000-0000-4000-8000-000000000001';
const NEURO = 'c0000000-0000-4000-8000-000000000002';
const ONCOLOGY = 'c0000000-0000-4000-8000-000000000003';
const ANANTIM = 'a0000000-0000-4000-8000-000000000001';
const PRIYA = 'a0000000-0000-4000-8000-000000000002';
const STRANGER = 'a0000000-0000-4000-8000-0000000000ff';

const live = { watch: vi.fn(async () => 'subscribed'), unwatch: vi.fn(), onMessage: () => () => undefined, onResync: () => () => undefined } as unknown as LiveClient;
const jobsList = { jobs: [] as JobSummary[], error: '', hasMore: false, loadingMore: false, moreFailed: false, refresh: vi.fn(async () => undefined), loadMore: vi.fn(async () => undefined), loadUntil: vi.fn(async () => true) };
const counts = (c: Partial<JobDetail['counts']> = {}) => ({ pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0, ...c });

function page(meId: string, filters: Filters, jobId: string | null = null) {
  const onFilters = vi.fn();
  const onSanitise = vi.fn();
  render(<StatusPage meId={meId} jobId={jobId} filters={filters} onFilters={onFilters} onSanitise={onSanitise} onOpen={vi.fn()} all={jobsList} notify={vi.fn()} live={live} />);
  return { onFilters, onSanitise };
}
const bar = () => within(screen.getByRole('group', { name: 'Filters' }));

beforeEach(() => {
  api.jobs.mockResolvedValue({ items: [], nextCursor: null });
  api.tasks.mockResolvedValue({ page: 1, limit: 100, total: 0, tasks: [] });
  api.members.mockResolvedValue([]);
  api.teams.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('an address with filters that do not apply to the person', () => {
  it('drops a team the person is not in: the normal list, no Team button, no error, and the address is replaced', async () => {
    api.teams.mockResolvedValue([{ id: NEURO, name: 'Neuro' }]); // Sam is in Neuro only
    const { onSanitise, onFilters } = page(PRIYA, { team: CARDIO });
    await waitFor(() => expect(onSanitise).toHaveBeenCalledWith({}));
    expect(onFilters).not.toHaveBeenCalled(); // the address is replaced, no history entry is made
    expect(screen.queryByRole('button', { name: /^Team/ })).toBeNull();
    expect(screen.queryByText('The team must be one of your teams.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(api.jobs).not.toHaveBeenCalledWith(expect.objectContaining({ team: CARDIO }), expect.anything(), expect.anything());
  });

  it('shows the Team button only for a person in more than one team, with no exception for a team in the address', async () => {
    api.teams.mockResolvedValue([{ id: CARDIO, name: 'Cardio' }]); // one team, and it is the one in the address
    const { onSanitise } = page(PRIYA, { team: CARDIO });
    await waitFor(() => expect(onSanitise).toHaveBeenCalledWith({}));
    expect(screen.queryByRole('button', { name: /^Team/ })).toBeNull();
  });

  it('keeps a team that is one of several the person is in, and shows its name on the button', async () => {
    api.teams.mockResolvedValue([{ id: CARDIO, name: 'Cardio' }, { id: ONCOLOGY, name: 'Oncology' }]);
    const { onSanitise } = page(PRIYA, { team: ONCOLOGY });
    expect(await bar().findByRole('button', { name: 'Team: Oncology' })).toBeTruthy();
    expect(onSanitise).not.toHaveBeenCalled();
    expect(api.jobs).toHaveBeenCalledWith({ team: ONCOLOGY }, null, 20);
  });

  it('drops a sender who is not the person and not in their teams', async () => {
    api.members.mockResolvedValue([{ userId: PRIYA, name: 'Priya Shah' }]);
    const { onSanitise } = page(PRIYA, { sender: STRANGER });
    await waitFor(() => expect(onSanitise).toHaveBeenCalledWith({}));
    expect(screen.queryByText(/Sender: Someone/)).toBeNull();
    expect(bar().getByRole('button', { name: 'Sender' })).toBeTruthy(); // no value on the button
  });

  it('writes the filters the page does not know about out of the address too', async () => {
    // ?status=banana&sent=forever never reaches the page as a filter (the address parser leaves them out); with nothing left it is the plain list.
    const { onSanitise } = page(PRIYA, {});
    await act(async () => undefined);
    expect(onSanitise).not.toHaveBeenCalled();
    expect(bar().getByRole('button', { name: 'Status' })).toBeTruthy();
  });

  it('does not decide until the person\'s teams are in, so a slow read never drops a valid team, and the list waits', async () => {
    let giveTeams: (t: Array<{ id: string; name: string }>) => void = () => undefined;
    api.teams.mockReturnValue(new Promise((resolve) => (giveTeams = resolve)));
    const { onSanitise } = page(PRIYA, { team: ONCOLOGY });
    await act(async () => undefined);
    expect(onSanitise).not.toHaveBeenCalled();
    expect(api.jobs).not.toHaveBeenCalled(); // not even the wrong list is read while it waits
    await act(async () => giveTeams([{ id: CARDIO, name: 'Cardio' }, { id: ONCOLOGY, name: 'Oncology' }]));
    expect(await bar().findByRole('button', { name: 'Team: Oncology' })).toBeTruthy();
    expect(onSanitise).not.toHaveBeenCalled();
    expect(api.jobs).toHaveBeenCalledWith({ team: ONCOLOGY }, null, 20);
  });

  it('keeps the address as it is when the teams cannot be read', async () => {
    api.teams.mockRejectedValue(new Error('down'));
    const { onSanitise } = page(PRIYA, { team: CARDIO });
    await waitFor(() => expect(api.jobs).toHaveBeenCalledWith({ team: CARDIO }, null, 20));
    expect(onSanitise).not.toHaveBeenCalled();
  });
});

describe('a "Sender: Me" link (the address holds the person\'s id, never the word "me")', () => {
  const members = [{ userId: ANANTIM, name: 'Anantim Patil' }, { userId: PRIYA, name: 'Priya Shah' }];

  it('shows "Me" for the person whose id it is', async () => {
    api.members.mockResolvedValue(members);
    const { onSanitise } = page(ANANTIM, { sender: ANANTIM });
    expect(await bar().findByRole('button', { name: 'Sender: Me' })).toBeTruthy();
    expect(onSanitise).not.toHaveBeenCalled();
  });

  it('shows the sender\'s name to a colleague who opens the same link', async () => {
    api.members.mockResolvedValue(members);
    const { onSanitise } = page(PRIYA, { sender: ANANTIM });
    expect(await bar().findByRole('button', { name: 'Sender: Anantim Patil' })).toBeTruthy();
    expect(onSanitise).not.toHaveBeenCalled();
  });

  it('drops it for a person who shares no team with the sender', async () => {
    api.members.mockResolvedValue([{ userId: 'sam', name: 'Sam Ito' }]);
    const { onSanitise } = page('sam', { sender: ANANTIM });
    await waitFor(() => expect(onSanitise).toHaveBeenCalledWith({}));
  });

  it('still opens an old link with sender=me, as the person\'s own id', async () => {
    api.members.mockResolvedValue(members);
    const { onSanitise } = page(ANANTIM, { sender: 'me' });
    await waitFor(() => expect(onSanitise).toHaveBeenCalledWith({ sender: ANANTIM }));
    expect(api.jobs).toHaveBeenCalledWith({ sender: ANANTIM }, null, 20);
  });

  it('chooses "Me" as the person\'s id', async () => {
    api.members.mockResolvedValue(members);
    const { onFilters } = page(ANANTIM, {});
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.click(bar().getByRole('button', { name: 'Sender' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Me' }).catch(() => screen.findByRole('menuitem', { name: 'Me' })));
    expect(onFilters).toHaveBeenCalledWith({ sender: ANANTIM });
  });
});

describe('the retry notice in the panel (D-F1-81)', () => {
  const detail = (over: Partial<JobDetail> = {}): JobDetail => ({
    jobId: JOB,
    submittedBy: { userId: PRIYA, name: 'Priya Shah' },
    createdAt: '2026-10-16T10:00:00Z',
    asOf: '2026-10-16T10:05:00.000Z',
    taskCount: 10,
    counts: counts({ completed: 8, failed: 2 }),
    status: 'completed_with_errors',
    isSender: true,
    completedAt: '2026-10-16T10:04:00Z',
    cancelledAt: null,
    destinations: ['Cardio / CARDIO-301 / IRB approvals'],
    fileCount: 5,
    cancel: { open: false, waiting: 0 },
    ...over,
  });
  const opened = async (d: JobDetail) => {
    api.job.mockResolvedValue(d);
    page(PRIYA, {}, JOB);
    await screen.findByRole('heading', { name: '3f1c2a9e' });
    await screen.findByRole('group', { name: 'Filter deliveries by status' });
  };

  it('tells the sender that Retry has ended, and what to do, when the window has closed', async () => {
    await opened(detail({ retry: { open: false, retryable: 0, reason: 'RETRY_WINDOW_CLOSED' } }));
    const note = screen.getByText('Retry has ended (24 hours after this finished). Send the files again as a new distribution.');
    expect(note.closest('.notice')?.getAttribute('role')).toBe('status'); // a quiet info note, not an alert
    expect(screen.queryByRole('button', { name: 'Retry failed deliveries' })).toBeNull();
  });

  it('says the same for files that are too old (the API gives the same reason)', async () => {
    await opened(detail({ retry: { open: false, retryable: 0, reason: 'RETRY_WINDOW_CLOSED' }, completedAt: '2026-10-20T10:04:00Z' }));
    expect(screen.getByText(/^Retry has ended/)).toBeTruthy();
  });

  it('tells the sender when a cancelled distribution has failures', async () => {
    await opened(detail({ cancelledAt: '2026-10-16T10:03:00Z', status: 'cancelled', retry: { open: false, retryable: 0, reason: 'JOB_CANCELLED' } }));
    expect(screen.getByText('This distribution was cancelled. Send the files again as a new distribution.')).toBeTruthy();
  });

  it('says nothing while Retry is open, when nothing failed, or when there is nothing to retry', async () => {
    await opened(detail({ retry: { open: true, retryable: 2 } }));
    expect(screen.queryByText(/Send the files again/)).toBeNull();
    cleanup();
    await opened(detail({ counts: counts({ completed: 10 }), status: 'completed', retry: { open: false, retryable: 0, reason: 'RETRY_WINDOW_CLOSED' } }));
    expect(screen.queryByText(/Send the files again/)).toBeNull(); // nothing failed
    cleanup();
    await opened(detail({ retry: { open: false, retryable: 0, reason: 'NOTHING_TO_RETRY' } }));
    expect(screen.queryByText(/Send the files again/)).toBeNull();
  });

  it('says nothing to a team member', async () => {
    await opened(detail({ isSender: false, submittedBy: { userId: ANANTIM, name: 'Anantim Patil' }, retry: undefined }));
    expect(screen.queryByText(/Send the files again/)).toBeNull();
  });
});
