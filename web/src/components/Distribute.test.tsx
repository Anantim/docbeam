// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStatus, PageFile, UploadManager } from '../upload/manager.js';

const apiFetch = vi.fn();
vi.mock('../auth/session.js', () => ({
  apiFetch: (path: string) => apiFetch(path),
  logout: vi.fn(),
  whenSignedIn: async () => undefined,
}));
vi.mock('../upload/instance.js', () => ({ uploadManager: {} }));

const { Distribute } = await import('./Distribute.js');
const { Submission } = await import('../distribute/submit.js');

const answers: Record<string, unknown> = {
  '/teams': { items: [{ id: 't-cardio', name: 'Cardio' }], nextCursor: null },
  '/teams/t-cardio/binders': { items: [{ id: 'b-reg', name: 'CARDIO-301 Regulatory' }], nextCursor: null },
  '/binders/b-reg/contents': { folders: [{ id: 'f-irb', name: 'IRB approvals' }], documents: [], nextCursor: null },
};

const pageFile = (name: string, status: FileStatus): PageFile => ({
  id: `id-${name}`,
  file: new File([new Uint8Array(1)], name),
  name,
  sizeBytes: 1000,
  contentType: 'application/pdf',
  status,
  progress: status === 'verified' ? 1 : 0.4,
  partsDone: 0,
  partCount: 0,
  sha256: 'a'.repeat(64),
  serverId: `server-${name}`,
});

/** Just enough of the upload queue for the screen: a list the test can change. */
class FakeManager {
  files: PageFile[];
  listeners = new Set<() => void>();
  constructor(files: PageFile[]) {
    this.files = files;
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.files;
  set(files: PageFile[]) {
    this.files = files;
    for (const l of this.listeners) l();
  }
  add = vi.fn();
  remove = vi.fn((id: string) => this.set(this.files.filter((f) => f.id !== id)));
  retry = vi.fn();
  clear = vi.fn(() => this.set([]));
}

const notify = vi.fn();

function screenWith(manager: FakeManager, submit = vi.fn(async () => ({ jobId: '0123456789abcdef', taskCount: 2 }))) {
  render(
    <Distribute
      onTeams={() => {}}
      notify={notify}
      manager={manager as unknown as UploadManager}
      submission={new Submission(submit, () => 'key-1')}
    />,
  );
  return submit;
}

const FOLDER = 'Cardio / CARDIO-301 Regulatory / IRB approvals';

/** The tree starts with the teams only: opens the team and the binder if they are still closed, then returns the folder's tick. */
async function folderTick(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  for (const row of ['Cardio', 'CARDIO-301 Regulatory']) {
    const expand = await screen.findByRole('button', { name: new RegExp(`^(Expand|Collapse) ${row}$`) });
    if (expand.getAttribute('aria-expanded') === 'false') await user.click(expand);
  }
  return screen.findByRole('checkbox', { name });
}

const tickTop = async (user: ReturnType<typeof userEvent.setup>, scope: string) =>
  user.click(await folderTick(user, `Send ${scope} to ${FOLDER}`));

beforeEach(() => {
  apiFetch.mockReset();
  notify.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (!(path in answers)) throw new Error(`unexpected ${path}`);
    return answers[path];
  });
});
afterEach(cleanup);

describe('Distribute', () => {
  it('keeps Send off until every file is verified and mapped', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'checking')]);
    screenWith(manager);

    await tickTop(user, 'all 2 files');
    const send = screen.getByRole('button', { name: /^Send 2 deliveries$/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Waiting for 1 file to be verified');

    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    await waitFor(() => expect((screen.getByRole('button', { name: /^Send 2 deliveries$/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('allows a tick before there is a file, and sends the files added next to that folder (D-F1-4)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([]);
    screenWith(manager);
    const box = await folderTick(user, /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals/);
    expect((box as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Drop files here')).toBeTruthy();
    await user.click(box);
    expect(screen.getByRole('checkbox', { name: /IRB approvals/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Add a file first');
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false); // it can undo the ticks

    manager.set([pageFile('a.pdf', 'verified')]);
    await waitFor(() => expect((screen.getByRole('button', { name: /^Send 1 delivery$/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('status').textContent).toBe('');

    // The folder stays ticked for every file added while it is ticked (D-F1-5).
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Send 2 deliveries$/ })).toBeTruthy());
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified'), pageFile('c.pdf', 'verified')]);
    await waitFor(() => expect((screen.getByRole('button', { name: /^Send 3 deliveries$/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('applies a tick to the selected files only, and shows the folder as mixed for the others', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    screenWith(manager);

    await user.click(screen.getByRole('checkbox', { name: 'Select a.pdf' }));
    expect(within(screen.getByRole('region', { name: 'Destinations' })).getByText('1 selected file')).toBeTruthy();
    await tickTop(user, '1 selected file');
    expect((await screen.findByRole('checkbox', { name: `Send 1 selected file to ${FOLDER}` })).getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Use all files' }));
    const box = await screen.findByRole('checkbox', { name: `Send all 2 files to ${FOLDER}` });
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    expect(screen.getByRole('status').textContent).toBe('1 file has no destination yet. Tick a folder');
  });

  it('removes a file from one folder with the cross in Review, and drops a file left with no folder', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified')]);
    screenWith(manager);
    await tickTop(user, 'all 1 file');

    const review = screen.getByRole('region', { name: 'Review' });
    await user.click(within(review).getByRole('button', { name: 'Remove a.pdf from IRB approvals' }));
    expect(manager.remove).toHaveBeenCalledWith('id-a.pdf');
    expect(notify).toHaveBeenCalledWith('a.pdf had no other destination, so it was removed from this distribution.');
  });

  it('asks before the page is closed whenever it holds files that were not sent, and not when it is empty', async () => {
    const manager = new FakeManager([pageFile('a.pdf', 'uploading')]);
    screenWith(manager);
    const asks = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(asks()).toBe(true);

    // Everything uploaded and verified, nothing sent yet: a reload would lose the prepared batch.
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    await waitFor(() => expect(asks()).toBe(true));

    // A refused file is still on the page.
    manager.set([pageFile('a.pdf', 'infected')]);
    await waitFor(() => expect(asks()).toBe(true));

    manager.set([]);
    await waitFor(() => expect(asks()).toBe(false));
  });

  it('sends the batch, then clears the page and names the job by its first 8 characters', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    const submit = screenWith(manager);
    await tickTop(user, 'all 2 files');

    await user.click(screen.getByRole('button', { name: 'Send 2 deliveries' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Distribution 01234567 sent. 2 deliveries queued.'));
    expect(submit).toHaveBeenCalledWith(
      {
        files: [
          { fileId: 'server-a.pdf', sha256: 'a'.repeat(64) },
          { fileId: 'server-b.pdf', sha256: 'a'.repeat(64) },
        ],
        mappings: [
          { fileId: 'server-a.pdf', destinations: [{ binderId: 'b-reg', folderId: 'f-irb' }] },
          { fileId: 'server-b.pdf', destinations: [{ binderId: 'b-reg', folderId: 'f-irb' }] },
        ],
      },
      'key-1',
    );
    expect(manager.clear).toHaveBeenCalled();
  });

  it('shows the platform message and keeps the page as it is when the platform is down', async () => {
    const { ApiFailure } = await import('../auth/errors.js');
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified')]);
    const submit = vi.fn().mockRejectedValue(new ApiFailure(503, 'down', 'PLATFORM_UNAVAILABLE'));
    screenWith(manager, submit);
    await tickTop(user, 'all 1 file');
    await user.click(screen.getByRole('button', { name: 'Send 1 delivery' }));
    expect(await screen.findByText('The platform is not answering. Try again.')).toBeTruthy();
    expect(manager.clear).not.toHaveBeenCalled();
    expect(manager.files).toHaveLength(1);
  });

  it('turns picked files into the queue and lists the ones it refused', async () => {
    const manager = new FakeManager([]);
    screenWith(manager);
    const input = screen.getByLabelText('Choose files');
    fireEvent.change(input, { target: { files: [new File(['x'], 'ok.pdf'), new File(['x'], 'setup.exe')] } });
    expect(manager.add).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/setup\.exe/)).toBeTruthy();
    expect(screen.getByText(/This type is not allowed/)).toBeTruthy();
  });
});
