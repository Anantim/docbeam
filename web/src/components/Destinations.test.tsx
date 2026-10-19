// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../auth/session.js', () => ({ apiFetch: (path: string) => apiFetch(path) }));

const { Destinations } = await import('./Destinations.js');

const answers: Record<string, unknown> = {
  '/teams': [
    { id: 't-cardio', name: 'Cardio' },
    { id: 't-onc', name: 'Oncology' },
  ],
  '/teams/t-cardio/binders': [{ id: 'b-reg', name: 'CARDIO-301 Regulatory' }],
  '/teams/t-onc/binders': [{ id: 'b-onc', name: 'ONC-118 Regulatory' }],
  '/binders/b-reg/contents': { folders: [{ id: 'f-irb', name: 'IRB approvals' }], documents: [{ id: 'd1', name: 'ignored.pdf' }] },
  '/binders/b-onc/contents': { folders: [], documents: [] },
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (!(path in answers)) throw new Error(`unexpected ${path}`);
    return answers[path];
  });
});
afterEach(cleanup);

const openCardio = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Expand Cardio' }));
  await user.click(await screen.findByRole('button', { name: 'Expand CARDIO-301 Regulatory' }));
};

describe('Destinations tree', () => {
  it('starts with the teams only, and loads one level each time a row is opened', async () => {
    const user = userEvent.setup();
    render(<Destinations selected={[]} onToggle={() => {}} onTeams={() => {}} />);
    await screen.findByText('Cardio');
    expect(screen.getByText('Oncology')).toBeTruthy();
    expect(screen.queryByText('CARDIO-301 Regulatory')).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(1); // only /teams

    await user.click(screen.getByRole('button', { name: 'Expand Cardio' }));
    await screen.findByText('CARDIO-301 Regulatory');
    expect(apiFetch).toHaveBeenCalledWith('/teams/t-cardio/binders');
    expect(apiFetch).not.toHaveBeenCalledWith('/teams/t-onc/binders');
    expect(apiFetch).not.toHaveBeenCalledWith('/binders/b-reg/contents');

    await user.click(screen.getByRole('button', { name: 'Expand CARDIO-301 Regulatory' }));
    await screen.findByText('IRB approvals');
    expect(apiFetch).toHaveBeenCalledWith('/binders/b-reg/contents');
    expect(screen.queryByText('ignored.pdf')).toBeNull();
  });

  it('reports the team names for the header', async () => {
    const onTeams = vi.fn();
    render(<Destinations selected={[]} onToggle={() => {}} onTeams={onTeams} />);
    await waitFor(() => expect(onTeams).toHaveBeenCalledWith(['Cardio', 'Oncology']));
  });

  it('ticks a folder as a destination with its path', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Destinations selected={[]} onToggle={onToggle} onTeams={() => {}} />);
    await openCardio(user);
    await user.click(await screen.findByRole('checkbox', { name: 'Send your files to Cardio / CARDIO-301 Regulatory / IRB approvals' }));
    expect(onToggle).toHaveBeenCalledWith({ binderId: 'b-reg', folderId: 'f-irb', path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' });
  });

  it('has no tick on a binder, only on its folders', async () => {
    const user = userEvent.setup();
    render(<Destinations selected={[]} onToggle={() => {}} onTeams={() => {}} />);
    await openCardio(user);
    await screen.findByRole('checkbox', { name: /IRB approvals/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: /CARDIO-301 Regulatory$/ })).toBeNull();
  });

  it('lets a folder be ticked with no file on the page (the tick is not disabled)', async () => {
    const user = userEvent.setup();
    render(<Destinations selected={[]} onToggle={() => {}} onTeams={() => {}} />);
    await openCardio(user);
    expect((await screen.findByRole('checkbox', { name: /IRB approvals/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the count and filters the loaded rows', async () => {
    const user = userEvent.setup();
    render(
      <Destinations
        selected={[{ binderId: 'b-reg', folderId: 'f-irb', path: 'x' }]}
        onToggle={() => {}}
        onTeams={() => {}}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Expand Cardio' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Oncology' }));
    await screen.findByText('ONC-118 Regulatory');
    expect(screen.getByText('1 of 20 destinations')).toBeTruthy();
    await user.type(screen.getByRole('searchbox'), 'onc-118');
    expect(screen.queryByText('CARDIO-301 Regulatory')).toBeNull();
    expect(screen.getByText('ONC-118 Regulatory')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No binders or folders match.')).toBeTruthy();
  });
});
