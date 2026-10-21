// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../auth/session.js', () => ({ apiFetch: (path: string) => apiFetch(path) }));

const { Destinations } = await import('./Destinations.js');

const answers: Record<string, unknown> = {
  '/teams': {
    items: [
      { id: 't-cardio', name: 'Cardio' },
      { id: 't-onc', name: 'Oncology' },
    ],
    nextCursor: null,
  },
  '/teams/t-cardio/binders': { items: [{ id: 'b-reg', name: 'CARDIO-301 Regulatory' }], nextCursor: null },
  '/teams/t-onc/binders': { items: [{ id: 'b-onc', name: 'ONC-118 Regulatory' }], nextCursor: null },
  '/binders/b-reg/contents': { folders: [{ id: 'f-irb', name: 'IRB approvals' }], documents: [{ id: 'd1', name: 'ignored.pdf' }], nextCursor: null },
  '/binders/b-onc/contents': { folders: [], documents: [], nextCursor: null },
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
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
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
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={onTeams} />);
    await waitFor(() => expect(onTeams).toHaveBeenCalledWith(['Cardio', 'Oncology']));
  });

  it('ticks a folder as a destination with its path', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Destinations stateOf={() => 'off'} onToggle={onToggle} onTeams={() => {}} />);
    await openCardio(user);
    await user.click(await screen.findByRole('checkbox', { name: 'Send your files to Cardio / CARDIO-301 Regulatory / IRB approvals' }));
    expect(onToggle).toHaveBeenCalledWith({ binderId: 'b-reg', folderId: 'f-irb', path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' });
  });

  it('has no tick on a binder, only on its folders', async () => {
    const user = userEvent.setup();
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await openCardio(user);
    await screen.findByRole('checkbox', { name: /IRB approvals/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: /CARDIO-301 Regulatory$/ })).toBeNull();
  });

  it('lets a folder be ticked with no file on the page (the tick is not disabled)', async () => {
    const user = userEvent.setup();
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await openCardio(user);
    expect((await screen.findByRole('checkbox', { name: /IRB approvals/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('filters the loaded rows', async () => {
    const user = userEvent.setup();
    render(
      <Destinations
        stateOf={() => 'off'}
        onToggle={() => {}}
        onTeams={() => {}}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Expand Cardio' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Oncology' }));
    await screen.findByText('ONC-118 Regulatory');
    // One character only narrows what is loaded (the server search starts at 2, D-F1-67).
    await user.type(screen.getByRole('searchbox'), 'n');
    expect(screen.queryByText('CARDIO-301 Regulatory')).toBeNull();
    expect(screen.getByText('ONC-118 Regulatory')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'z');
    expect(screen.getByText('No binders or folders match.')).toBeTruthy();
    expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith('/folders/search'))).toBe(false);
  });
});

describe('the folder search (D-F1-67)', () => {
  const hit = (id: string, name: string, path: string, extra: Record<string, unknown> = {}) => ({ id, name, path, teamId: 't-cardio', binderId: 'b-reg', folderIds: [id], ...extra });
  const search = (q: string, page: unknown) => {
    answers[`/folders/search?q=${q}`] = page;
  };

  it('asks the server from 2 characters, after a pause, and lists the matches with their full path', async () => {
    search('ir', { items: [hit('f-irb', 'IRB approvals', 'Cardio / CARDIO-301 Regulatory / IRB approvals')], nextCursor: null });
    const user = userEvent.setup();
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await screen.findByText('Cardio');
    await user.type(screen.getByRole('searchbox'), 'ir');
    const result = await screen.findByRole('button', { name: 'Tick Cardio / CARDIO-301 Regulatory / IRB approvals and show it in the tree' });
    expect(result.textContent).toContain('IRB approvals');
    expect(result.textContent).toContain('Cardio / CARDIO-301 Regulatory'); // the path above the folder
    // One request for the word, not one per letter.
    expect(apiFetch.mock.calls.filter((c) => String(c[0]).startsWith('/folders/search'))).toEqual([['/folders/search?q=ir']]);
    expect(screen.queryByText('Oncology')).toBeNull(); // the matches replace the tree while searching
  });

  it('picking a match clears the box, opens the tree down to the folder (reading the levels it needs) and ticks it', async () => {
    search('irb', { items: [hit('f-irb', 'IRB approvals', 'Cardio / CARDIO-301 Regulatory / IRB approvals')], nextCursor: null });
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<Destinations stateOf={() => 'off'} onToggle={onToggle} onTeams={() => {}} />);
    await screen.findByText('Cardio');
    await user.type(screen.getByRole('searchbox'), 'irb');
    await user.click(await screen.findByRole('button', { name: /^Tick Cardio .* IRB approvals and show it in the tree$/ }));
    // The tree is back, open to the folder.
    expect(await screen.findByRole('checkbox', { name: /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals$/ })).toBeTruthy();
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect(onToggle).toHaveBeenCalledWith({ binderId: 'b-reg', folderId: 'f-irb', path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' });
    expect(screen.getByRole('button', { name: 'Collapse Cardio' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse CARDIO-301 Regulatory' })).toBeTruthy();
  });

  it('does not untick a folder that is already ticked when it is picked, and shows a folder that is not on its level\'s first page', async () => {
    search('arch', { items: [hit('f-late', 'Archive 2019', 'Cardio / CARDIO-301 Regulatory / Archive 2019')], nextCursor: null });
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<Destinations stateOf={(d) => (d.folderId === 'f-late' ? 'on' : 'off')} onToggle={onToggle} onTeams={() => {}} />);
    await screen.findByText('Cardio');
    await user.type(screen.getByRole('searchbox'), 'arch');
    await user.click(await screen.findByRole('button', { name: /Archive 2019 and show it in the tree$/ }));
    // The first page of the binder (IRB approvals only) does not hold it, but the tree shows it.
    expect(await screen.findByRole('checkbox', { name: /Archive 2019$/ })).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('says when nothing matches, offers more pages, and retries a failed search', async () => {
    search('page', { items: [hit('f1', 'Page one', 'Cardio / R / Page one')], nextCursor: 'c2' });
    answers['/folders/search?q=page&cursor=c2'] = { items: [hit('f2', 'Page two', 'Cardio / R / Page two')], nextCursor: null };
    search('nomatch', { items: [], nextCursor: null });
    const user = userEvent.setup();
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await screen.findByText('Cardio');
    await user.type(screen.getByRole('searchbox'), 'page');
    await screen.findByRole('button', { name: /Page one/ });
    await user.click(await screen.findByRole('button', { name: /Show more|Load more|more/i }));
    await screen.findByRole('button', { name: /Page two/ });

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'nomatch');
    expect(await screen.findByText('No folders match.')).toBeTruthy();

    await user.clear(screen.getByRole('searchbox'));
    delete answers['/folders/search?q=broken'];
    await user.type(screen.getByRole('searchbox'), 'broken');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not search.');
    search('broken', { items: [hit('f3', 'Broken one', 'Cardio / R / Broken one')], nextCursor: null });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: /Broken one/ });
  });
});

describe('Destinations tree, paged levels (D-F1-6)', () => {
  // A stand-in for the browser's IntersectionObserver that the test fires by hand.
  let fire: () => void = () => {};
  beforeEach(() => {
    class FakeObserver {
      constructor(private cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        fire = () => this.cb([{ isIntersecting: true }]);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  const folders = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `f${from + i}`, name: `Batch ${String(from + i).padStart(3, '0')}` }));

  it('loads nothing before a row is opened, then a page when it opens, then the next page when the end scrolls into view', async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/teams') return { items: [{ id: 't', name: 'Paging Team' }], nextCursor: null };
      if (path === '/teams/t/binders') return { items: [{ id: 'b', name: 'Archive' }], nextCursor: null };
      if (path === '/binders/b/contents') return { folders: folders(1, 20), documents: [], nextCursor: 'c1' };
      if (path === '/binders/b/contents?cursor=c1') return { folders: folders(21, 40), documents: [], nextCursor: 'c2' };
      if (path === '/binders/b/contents?cursor=c2') return { folders: folders(41, 60), documents: [], nextCursor: null };
      throw new Error(`unexpected ${path}`);
    });
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Expand Paging Team' }));
    expect(apiFetch).not.toHaveBeenCalledWith('/binders/b/contents');
    await user.click(await screen.findByRole('button', { name: 'Expand Archive' }));
    await screen.findByText('Batch 020');
    expect(screen.queryByText('Batch 021')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();

    fire(); // the end of the list scrolls into view
    await screen.findByText('Batch 040');
    expect(screen.getByText('Batch 001')).toBeTruthy(); // the first page is kept
    fire();
    await screen.findByText('Batch 060');
    expect(apiFetch).toHaveBeenCalledTimes(5); // teams, binders, and three pages: nothing was asked twice
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull(); // the last page: no more row
  });

  it('shows a loading row while a page is on its way, and a retry when it fails', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    let fail = true;
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/teams') return { items: [{ id: 't', name: 'Paging Team' }], nextCursor: null };
      if (path === '/teams/t/binders') return { items: [{ id: 'b', name: 'Archive' }], nextCursor: null };
      if (path === '/binders/b/contents') return { folders: folders(1, 2), documents: [], nextCursor: 'c1' };
      if (path === '/binders/b/contents?cursor=c1') {
        if (fail) {
          fail = false;
          throw new Error('network');
        }
        return new Promise((r) => (release = r));
      }
      throw new Error(`unexpected ${path}`);
    });
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Expand Paging Team' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Archive' }));
    await screen.findByText('Batch 002');
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('Could not load more.');
    expect(screen.getByText('Batch 002')).toBeTruthy(); // what was loaded stays
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Loading more…');
    release({ folders: folders(3, 3), documents: [], nextCursor: null });
    await screen.findByText('Batch 003');
  });

  it('stops after the folders: a page that holds a document ends the list, and the document pages are never read', async () => {
    const user = userEvent.setup();
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/teams') return { items: [{ id: 't', name: 'Paging Team' }], nextCursor: null };
      if (path === '/teams/t/binders') return { items: [{ id: 'b', name: 'Archive' }], nextCursor: null };
      if (path === '/binders/b/contents') return { folders: folders(1, 2), documents: [{ id: 'd1', name: 'x.pdf' }], nextCursor: 'docs-next' };
      throw new Error(`unexpected ${path}`);
    });
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Expand Paging Team' }));
    await user.click(await screen.findByRole('button', { name: 'Expand Archive' }));
    await screen.findByText('Batch 002');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });

  it('pages the teams too: the next page of teams loads when the end of the list is reached', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/teams') return { items: [{ id: 't1', name: 'Alpha' }], nextCursor: 'k' };
      if (path === '/teams?cursor=k') return { items: [{ id: 't2', name: 'Beta' }], nextCursor: null };
      throw new Error(`unexpected ${path}`);
    });
    const onTeams = vi.fn();
    render(<Destinations stateOf={() => 'off'} onToggle={() => {}} onTeams={onTeams} />);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Beta')).toBeNull();
    fire();
    await screen.findByText('Beta', undefined, { timeout: 5000 }); // generous: 80 test files start together
    await waitFor(() => expect(onTeams).toHaveBeenLastCalledWith(['Alpha', 'Beta']));
  });
});
