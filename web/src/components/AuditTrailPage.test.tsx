// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../tracking/api.js';
import type { AuditEvent } from '../tracking/api.js';
import { AuditTrailPage } from './AuditTrailPage.js';

const api = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock('../tracking/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  trackingApi: api,
}));

const JOB_A = 'aaaaaaaa-0000-4000-8000-000000000000';
const JOB_B = 'bbbbbbbb-0000-4000-8000-000000000000';
let nextId = 1;
const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: nextId++,
  occurredAt: new Date().toISOString(),
  action: 'job.submitted',
  actorId: 'u',
  jobId: JOB_A,
  taskId: null,
  teamId: null,
  detail: { actorName: 'Priya Shah', fileCount: 1, destinationCount: 1, taskCount: 1 },
  ...over,
});
const page = (events: AuditEvent[], hasMore = false) => ({ page: 1, limit: 50, hasMore, events });

beforeEach(() => {
  nextId = 1;
  api.audit.mockResolvedValue(page([event(), event({ jobId: JOB_B, action: 'job.cancelled', detail: { actorName: 'Priya Shah', cancelled: 2 } })]));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuditTrailPage', () => {
  it('lists the events grouped by day, with who and what', async () => {
    render(<AuditTrailPage onOpenJob={vi.fn()} />);
    await screen.findByText('Distribution sent');
    expect(screen.getByText('TODAY')).toBeTruthy();
    expect(screen.getByText('Distribution cancelled')).toBeTruthy();
    expect(screen.getByText('2 waiting deliveries cancelled.')).toBeTruthy();
    expect(screen.getAllByText('by Priya Shah')).toHaveLength(2);
    expect(screen.getByText('2 events loaded')).toBeTruthy();
  });

  it('asks only for the actions of the chosen kind, and Deliveries is two actions', async () => {
    const user = userEvent.setup();
    render(<AuditTrailPage onOpenJob={vi.fn()} />);
    await screen.findByText('Distribution sent');
    expect(api.audit).toHaveBeenLastCalledWith({ actions: [], page: 1 });
    await user.click(within(screen.getByRole('group', { name: 'Event' })).getByRole('button', { name: 'Deliveries' }));
    await waitFor(() => expect(api.audit).toHaveBeenLastCalledWith({ actions: ['task.completed', 'task.failed'], page: 1 }));
    await user.click(within(screen.getByRole('group', { name: 'Event' })).getByRole('button', { name: 'Retries' }));
    await waitFor(() => expect(api.audit).toHaveBeenLastCalledWith({ actions: ['job.retried'], page: 1 }));
  });

  it('filters by distribution, and keeps the other distributions on offer', async () => {
    const user = userEvent.setup();
    render(<AuditTrailPage onOpenJob={vi.fn()} />);
    await screen.findByText('Distribution sent');
    const group = screen.getByRole('group', { name: 'Distribution' });
    expect(await within(group).findByRole('button', { name: 'aaaaaaaa' })).toBeTruthy();
    expect(await within(group).findByRole('button', { name: 'bbbbbbbb' })).toBeTruthy();

    api.audit.mockResolvedValue(page([event()]));
    await user.click(within(group).getByRole('button', { name: 'aaaaaaaa' }));
    await waitFor(() => expect(api.audit).toHaveBeenLastCalledWith({ jobId: JOB_A, actions: [], page: 1 }));
    await screen.findByText('1 event loaded');
    expect(within(screen.getByRole('group', { name: 'Distribution' })).getByRole('button', { name: 'bbbbbbbb' })).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Distribution' })).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(api.audit).toHaveBeenLastCalledWith({ actions: [], page: 1 }));
  });

  it('loads the next page when asked, and keeps the first', async () => {
    api.audit.mockResolvedValueOnce(page([event()], true)).mockResolvedValueOnce({ page: 2, limit: 50, hasMore: false, events: [event({ action: 'job.retried', detail: { actorName: 'Priya Shah', retried: 1 } })] });
    const user = userEvent.setup();
    render(<AuditTrailPage onOpenJob={vi.fn()} />);
    await screen.findByText('Distribution sent');
    await user.click(screen.getByRole('button', { name: 'Load more events' }));
    await screen.findByText('Retry requested');
    expect(screen.getByText('Distribution sent')).toBeTruthy();
    expect(api.audit).toHaveBeenLastCalledWith({ actions: [], page: 2 });
    expect(screen.queryByRole('button', { name: 'Load more events' })).toBeNull();
  });

  it('opens a distribution from its link', async () => {
    const onOpenJob = vi.fn();
    const user = userEvent.setup();
    render(<AuditTrailPage onOpenJob={onOpenJob} />);
    await screen.findByText('Distribution sent');
    await user.click(screen.getAllByTitle(`Open distribution ${JOB_A}`)[0] as HTMLElement);
    expect(onOpenJob).toHaveBeenCalledWith(JOB_A);
  });

  it('says so when nothing matches, and when the trail cannot be loaded', async () => {
    api.audit.mockResolvedValueOnce(page([]));
    render(<AuditTrailPage onOpenJob={vi.fn()} />);
    await screen.findByText('No events match these filters.');
    cleanup();
    api.audit.mockRejectedValueOnce(new Error('down'));
    render(<AuditTrailPage onOpenJob={vi.fn()} />);
    await screen.findByRole('alert');
  });
});
