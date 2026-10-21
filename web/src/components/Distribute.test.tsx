// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { tooltipOf } from '../testing/tooltip.js';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  '/binders/b-reg/contents': { folders: [{ id: 'f-irb', name: 'IRB approvals' }, { id: 'f-protocol', name: 'Protocol amendments' }], documents: [], nextCursor: null },
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
  restore = vi.fn(async (entries: Array<{ id: string; name: string; stored: boolean }>) => {
    const back = entries.filter((e) => e.stored).map((e) => ({ ...pageFile(e.name, 'verified'), id: e.id, restored: true }));
    this.set([...this.files, ...back]);
    return { restored: back.map((f) => f.id), dropped: entries.length - back.length };
  });
}

const notify = vi.fn();
const onSent = vi.fn();

function screenWith(manager: FakeManager, submit = vi.fn(async () => ({ jobId: '0123456789abcdef', taskCount: 2 }))) {
  render(
    <Distribute
      onTeams={() => {}}
      notify={notify}
      onSent={onSent}
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
  sessionStorage.clear(); // the batch kept across a reload (D-F1-66) must not leak from one test to the next
  apiFetch.mockReset();
  notify.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (!(path in answers)) throw new Error(`unexpected ${path}`);
    return answers[path];
  });
});
afterEach(() => {
  cleanup();
  notify.mockClear();
  onSent.mockClear();
});

describe('Distribute', () => {
  it('keeps Send off until every file is verified and mapped', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'checking')]);
    screenWith(manager);

    await tickTop(user, 'all 2 files');
    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Wait for 1 file to finish scanning');
    expect(send.getAttribute('aria-describedby')).toBe(screen.getByRole('status').id);

    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('allows a tick before there is a file, and sends the files added next to that folder (D-F1-4)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([]);
    screenWith(manager);
    const box = await folderTick(user, /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals/);
    expect((box as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Drop files here')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(''); // the empty page says nothing: the drop area says what to do
    expect(screen.getByRole('region', { name: 'Destinations' }).querySelector('.card-hint')).toBeNull(); // nothing ticked: no words beside the title (D-F1-24)
    await user.click(box);
    expect(screen.getByRole('checkbox', { name: /IRB approvals/ }).getAttribute('aria-checked')).toBe('true'); // the tree is never off for want of files
    expect(screen.getByRole('status').textContent).toBe('');
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false); // it can undo the ticks

    manager.set([pageFile('a.pdf', 'verified')]);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('status').textContent).toBe('');

    // The folder stays ticked for every file added while it is ticked (D-F1-5).
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy());
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified'), pageFile('c.pdf', 'verified')]);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('applies a tick to the selected files only, and shows the folder as mixed for the others', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    screenWith(manager);

    await user.click((screen.getByText('a.pdf').closest('[role="row"]')) as HTMLElement);
    const dest = within(screen.getByRole('region', { name: 'Destinations' }));
    expect(screen.getByText('a.pdf').closest('[role="row"]')?.getAttribute('aria-selected')).toBe('true'); // the highlighted row shows the scope (D-F1-45)
    expect(screen.getByRole('region', { name: 'Destinations' }).querySelector('.card-hint')).toBeNull(); // nothing beside the title, ever
    expect(dest.queryByText(/selected file/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use all files' })).toBeNull(); // the strip is gone (D-F1-20)
    await tickTop(user, '1 selected file');
    expect((await screen.findByRole('checkbox', { name: `Send 1 selected file to ${FOLDER}` })).getAttribute('aria-checked')).toBe('true');

    // The Files header checkbox selects all, and then none, so a tick goes to all files again.
    await user.click(screen.getByRole('checkbox', { name: 'Select all to choose their folders' })); // 1 of 2 selected: selects all
    await user.click(screen.getByRole('checkbox', { name: 'Select all to choose their folders' })); // all selected: clears
    expect(screen.getByRole('region', { name: 'Destinations' }).querySelector('.card-hint')).toBeNull(); // none selected again: nothing shown
    const box = await screen.findByRole('checkbox', { name: `Send all 2 files to ${FOLDER}` });
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    expect(screen.getByRole('status').textContent).toBe('Choose folders for 1 file');
  });

  it('asks before sending, with Cancel as the default answer, and sends nothing on Cancel or Esc', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified')]);
    const submit = screenWith(manager);
    await tickTop(user, 'all 1 file');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const ask = screen.getByRole('dialog', { name: 'Send 1 file to 1 folder?' });
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.keyboard('{Enter}'); // Enter on the focused Cancel answers no
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it('a click on a row or its tick box toggles that file without changing the others (no Ctrl); Shift selects a range; Space toggles the focused row; the header box selects all or none (D-F1-36)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified'), pageFile('c.pdf', 'verified'), pageFile('d.pdf', 'verified')]);
    screenWith(manager);
    const row = (n: string) => screen.getByText(n).closest('[role="row"]') as HTMLElement;
    const picked = () => ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map((n) => row(n).getAttribute('aria-selected'));
    await user.click(row('a.pdf'));
    expect(picked()).toEqual(['true', 'false', 'false', 'false']);
    await user.click(row('c.pdf')); // a stays: no Ctrl needed
    expect(picked()).toEqual(['true', 'false', 'true', 'false']);
    await user.click(within(row('d.pdf')).getByRole('checkbox', { name: 'Select to choose folders for this file' })); // the tick box too
    expect(picked()).toEqual(['true', 'false', 'true', 'true']);
    await user.click(row('c.pdf')); // a second click takes only that file off
    expect(picked()).toEqual(['true', 'false', 'false', 'true']);
    // Shift selects the range from the last file clicked (c, now off) to this one.
    await user.keyboard('{Shift>}');
    await user.click(row('a.pdf'));
    await user.keyboard('{/Shift}');
    expect(picked()).toEqual(['true', 'true', 'true', 'false']);
    // Space toggles the focused row.
    row('d.pdf').focus();
    await user.keyboard(' ');
    expect(picked()).toEqual(['true', 'true', 'true', 'true']);
    await user.keyboard(' ');
    expect(picked()).toEqual(['true', 'true', 'true', 'false']);
    // The header box: all, then none.
    const header = screen.getByRole('checkbox', { name: 'Select all to choose their folders' });
    await user.click(header);
    expect(picked()).toEqual(['true', 'true', 'true', 'true']);
    await user.click(header);
    expect(picked()).toEqual(['false', 'false', 'false', 'false']);
  });

  it('names the file states: Scanning (with "Scanning for malware" as tooltip and name), Failed for an upload storage refused or a scan that could not run (Retry kept), Refused for malware only (no Retry, the tick locked) (D-F1-38)', () => {
    const manager = new FakeManager([
      pageFile('scan.pdf', 'checking'),
      pageFile('stored.pdf', 'refused'),
      pageFile('noscan.pdf', 'unchecked'),
      pageFile('virus.pdf', 'infected'),
    ]);
    screenWith(manager);
    const chip = (n: string) => screen.getByText(n).closest('[role="row"]')!.querySelector('.status-chip') as HTMLElement;
    expect(chip('scan.pdf').textContent).toBe('Scanning');
    expect(tooltipOf(chip('scan.pdf'))).toBe('Scanning for malware');
    expect(chip('scan.pdf').getAttribute('aria-label')).toBe('Scanning for malware');
    expect(screen.queryByText('Checking')).toBeNull();
    // No reason line under a chip (D-F1-60): the reason is the chip's tooltip, from the one reason map, and a Tab stop shows it.
    expect(document.querySelector('.fmsg')).toBeNull();
    for (const [name, reason] of [
      ['stored.pdf', 'Storage did not accept the upload.'],
      ['noscan.pdf', 'The scan could not run.'],
    ] as const) {
      expect(chip(name).textContent).toBe('Failed');
      expect(tooltipOf(chip(name))).toBe(reason);
      expect(chip(name).getAttribute('aria-label')).toBe(reason);
      expect(chip(name).tabIndex).toBe(0);
      expect(screen.getByText(name).closest('[role="row"]')!.textContent).not.toContain(reason); // not repeated in the row
      expect(screen.getByRole('button', { name: `Retry upload of ${name}` })).toBeTruthy(); // the visible action: Retry
      expect(screen.getByRole('button', { name: `Remove ${name}` })).toBeTruthy();
    }
    expect(chip('virus.pdf').textContent).toBe('Refused');
    expect(tooltipOf(chip('virus.pdf'))).toBe('Malware was found. The file was deleted and cannot be sent.');
    expect(chip('virus.pdf').getAttribute('aria-label')).toBe('Malware was found. The file was deleted and cannot be sent.');
    expect(screen.getByRole('button', { name: 'Remove virus.pdf' })).toBeTruthy(); // the visible action on a Refused file: remove
    expect(screen.queryByRole('button', { name: 'Retry upload of virus.pdf' })).toBeNull(); // final: no Retry
    expect(screen.getByRole('img', { name: /virus\.pdf was refused for malware and cannot be selected or sent/ })).toBeTruthy(); // the tick locked
    expect(screen.getAllByText('Refused')).toHaveLength(1); // "Refused" is only for malware
  });

  it('names what the tick boxes are for: the row box "Select to choose folders for this file", the header box "Select all to choose their folders" (D-F1-23)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    screenWith(manager);
    const rowBoxes = screen.getAllByRole('checkbox', { name: 'Select to choose folders for this file' });
    expect(rowBoxes).toHaveLength(2);
    for (const box of rowBoxes) {
      expect(tooltipOf(box)).toBe('Select to choose folders for this file');
      expect(box.getAttribute('aria-checked')).toBe('false');
    }
    const header = screen.getByRole('checkbox', { name: 'Select all to choose their folders' });
    expect(tooltipOf(header)).toBe('Select all to choose their folders');
    // Selection behaves as before: a click on the box selects the row, the header box selects all.
    await user.click(rowBoxes[0] as HTMLElement);
    expect(screen.getAllByRole('checkbox', { name: 'Select to choose folders for this file' })[0]?.getAttribute('aria-checked')).toBe('true');
    expect(within(screen.getByRole('region', { name: 'Destinations' })).queryByText(/selected files?/)).toBeNull(); // no label (D-F1-45)
    await user.click(header);
    expect(within(screen.getByRole('region', { name: 'Destinations' })).queryByText(/selected files?/)).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: 'Select to choose folders for this file' }).every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
  });

  it('shows a muted count beside each ticked folder ("3 files", "2 of 3 files", "1 file"), none beside an unticked one, and a popover lists those files (D-F1-37)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified'), pageFile('c.pdf', 'verified')]);
    screenWith(manager);
    const row = (n: string) => screen.getByText(n).closest('[role="row"]') as HTMLElement;
    const counts = () => [...document.querySelectorAll('.tree .count-link')].map((e) => e.textContent);
    await folderTick(user, /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals/); // opens the tree
    expect(counts()).toEqual([]); // nothing ticked: no counts

    // Nothing selected: a tick is for all three files.
    await user.click(await folderTick(user, /to Cardio \/ CARDIO-301 Regulatory \/ IRB approvals/));
    expect(counts()).toEqual(['3 files']);

    // Select a and b only and tick the second folder: it is for those two, and says "2 files" while they are the scope.
    await user.click(row('a.pdf'));
    await user.click(row('b.pdf'));
    await user.click(await screen.findByRole('checkbox', { name: /to Cardio \/ CARDIO-301 Regulatory \/ Protocol amendments/ }));
    expect(counts()).toEqual(['2 files', '2 files']); // the first folder: a and b of the 2 selected; the second: a and b
    // Select none again: the scope is all three, and the second folder is only for 2 of them.
    await user.click(screen.getByRole('checkbox', { name: 'Select all to choose their folders' })); // selects the other file too
    await user.click(screen.getByRole('checkbox', { name: 'Select all to choose their folders' })); // none
    expect(counts()).toEqual(['3 files', '2 of 3 files']);
    // One file selected: the count is over that file.
    await user.click(row('a.pdf'));
    expect(counts()).toEqual(['1 file', '1 file']);
    await user.click(row('a.pdf'));

    // The popover lists the files of the second folder, in a scrolling list like the one of a file's folders.
    const second = [...document.querySelectorAll<HTMLElement>('.tree .count-link')][1] as HTMLElement;
    await user.click(second);
    const panel = await screen.findByRole('dialog', { name: /Files for Cardio \/ CARDIO-301 Regulatory \/ Protocol amendments/ });
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a.pdf', 'b.pdf']);
    expect(panel.querySelector('.popover-list')).not.toBeNull();
    // A tick on a folder that is only for some of the files makes it for all of them; the next tick takes it off, and its count goes.
    await user.keyboard('{Escape}');
    const protocol = () => screen.getByRole('checkbox', { name: /to Cardio \/ CARDIO-301 Regulatory \/ Protocol amendments/ });
    await user.click(protocol());
    expect(counts()).toEqual(['3 files', '3 files']);
    await user.click(protocol());
    expect(counts()).toEqual(['3 files']);
  });

  it('has no summary line in the bar; the batch is in the question that Send asks (D-F1-20)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    screenWith(manager);
    await tickTop(user, 'all 2 files');
    expect(screen.queryByText('2 files to 1 folder: 2 deliveries')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('dialog', { name: 'Send 2 files to 1 folder?' })).toBeTruthy();
  });

  it('gives each reason in words beside the buttons: no folders, still checking, failed, refused; and none when Send is on', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    screenWith(manager);
    const reason = (): string | undefined => document.querySelector('.send-reason')?.textContent;
    expect(reason()).toBe('Choose folders for 2 files');
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'checking')]);
    await waitFor(() => expect(reason()).toBe('Wait for 1 file to finish scanning'));
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'interrupted')]);
    await waitFor(() => expect(reason()).toBe('Retry or remove 1 failed file'));
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'infected')]);
    await waitFor(() => expect(reason()).toBe('Remove 1 refused file'));
    manager.set([pageFile('a.pdf', 'verified')]);
    await tickTop(user, 'all 1 file');
    await waitFor(() => expect(reason()).toBe(''));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('.sendbar [title], .sendbar .tip-wrap')).toBeNull(); // no tooltip in the bar carries a reason
  });

  it('asks before the page is closed only when a reload would lose a file: one still uploading or one that failed, not one that is stored (D-F1-66)', async () => {
    const manager = new FakeManager([pageFile('a.pdf', 'uploading')]);
    screenWith(manager);
    const asks = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(asks()).toBe(true);

    // Everything uploaded and verified, nothing sent yet: a reload brings the batch back, so there is nothing to ask about.
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    await waitFor(() => expect(asks()).toBe(false));

    // A file that failed must be added again after a reload.
    manager.set([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'unchecked')]);
    await waitFor(() => expect(asks()).toBe(true));

    // A file refused for malware is not kept and is not worth a question.
    manager.set([pageFile('a.pdf', 'infected')]);
    await waitFor(() => expect(asks()).toBe(false));

    manager.set([]);
    await waitFor(() => expect(asks()).toBe(false));
  });

  describe('the batch comes back after a reload (D-F1-66)', () => {
    const stored = (name: string, id: string, stored = true) => ({ id, serverId: `srv-${id}`, name, sizeBytes: 10, contentType: 'application/pdf', sha256: 'a'.repeat(64), stored });
    const keep = (batch: unknown) => sessionStorage.setItem('docbeam.batch.v1', JSON.stringify(batch));
    const dest = { binderId: 'b1', folderId: 'f1', path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' };

    it('puts the stored files back, with their folder ticks and the held folders, and says how many could not come back', async () => {
      keep({
        files: [stored('a.pdf', 'p1'), stored('b.pdf', 'p2'), stored('c.pdf', 'p3', false)],
        mapping: { destinations: { k1: dest }, files: { p1: ['k1'], p2: ['k1'], p3: ['k1'] }, held: ['k1'] },
      });
      screenWith(new FakeManager([]));
      expect(await screen.findByText('a.pdf')).toBeTruthy();
      expect(screen.getByText('b.pdf')).toBeTruthy();
      expect(screen.queryByText('c.pdf')).toBeNull(); // it was mid-upload
      await waitFor(() => expect(notify).toHaveBeenCalledWith('1 file could not be restored', 'error'));
      // The ticks of the files that came back are kept; the one that did not has none.
      const saved = JSON.parse(sessionStorage.getItem('docbeam.batch.v1') as string);
      expect(Object.keys(saved.mapping.files).sort()).toEqual(['p1', 'p2']);
      expect(saved.mapping.held).toEqual(['k1']);
    });

    it('keeps the stored batch when the server cannot be asked, and says to reload', async () => {
      const batch = { files: [stored('a.pdf', 'p1')], mapping: { destinations: { k1: dest }, files: { p1: ['k1'] }, held: [] } };
      keep(batch);
      const manager = new FakeManager([]);
      manager.restore.mockResolvedValueOnce({ restored: [], dropped: 1, unreachable: true } as never);
      screenWith(manager);
      await waitFor(() => expect(notify).toHaveBeenCalledWith('Your files could not be checked. Reload to try again.', 'error'));
      expect(JSON.parse(sessionStorage.getItem('docbeam.batch.v1') as string).files).toHaveLength(1); // not wiped by the empty page
    });

    it('puts the folder ticks back when the screen is drawn again over files that are already here', async () => {
      keep({ files: [stored('a.pdf', 'p1')], mapping: { destinations: { k1: dest }, files: { p1: ['k1'] }, held: ['k1'] } });
      const manager = new FakeManager([{ ...pageFile('a.pdf', 'verified'), id: 'p1' }]);
      screenWith(manager);
      await waitFor(() => expect(JSON.parse(sessionStorage.getItem('docbeam.batch.v1') as string).mapping.files).toEqual({ p1: ['k1'] }));
      expect(manager.restore).not.toHaveBeenCalled();
    });

    it('does not restore over files that are already on the page, and says nothing when nothing is kept', async () => {
      keep({ files: [stored('old.pdf', 'p9')], mapping: { destinations: {}, files: {}, held: [] } });
      const manager = new FakeManager([pageFile('now.pdf', 'verified')]);
      screenWith(manager);
      expect(manager.restore).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('keeps the batch up to date while files are added and ticked, and forgets it after Clear', async () => {
      const user = userEvent.setup();
      const manager = new FakeManager([pageFile('a.pdf', 'verified')]);
      screenWith(manager);
      await waitFor(() => expect(JSON.parse(sessionStorage.getItem('docbeam.batch.v1') as string).files).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: 'Clear' }));
      await waitFor(() => expect(sessionStorage.getItem('docbeam.batch.v1')).toBeNull());
    });

    it('forgets the batch after Send', async () => {
      const user = userEvent.setup();
      const manager = new FakeManager([pageFile('a.pdf', 'verified')]);
      screenWith(manager);
      await tickTop(user, 'all 1 file');
      expect(sessionStorage.getItem('docbeam.batch.v1')).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await user.click(within(screen.getByRole('dialog', { name: /^Send 1 file to 1 folder/ })).getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(onSent).toHaveBeenCalled());
      await waitFor(() => expect(sessionStorage.getItem('docbeam.batch.v1')).toBeNull());
    });
  });

  it('sends the batch, then clears the page, says "Sent", and hands the new distribution on to open on Status (D-F1-31)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified'), pageFile('b.pdf', 'verified')]);
    const submit = screenWith(manager);
    await tickTop(user, 'all 2 files');

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const ask = screen.getByRole('dialog', { name: 'Send 2 files to 1 folder?' });
    expect(ask.textContent).not.toContain('deliveries'); // no "N deliveries to T teams." line any more (D-F1-23)
    expect([...ask.querySelectorAll('p')].map((p) => p.textContent)).toEqual(["Delivered files can't be recalled."]);
    expect(document.activeElement?.textContent).toBe('Cancel'); // the focus starts on Cancel
    await user.click(within(ask).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Sent'));
    expect(onSent).toHaveBeenCalledWith('0123456789abcdef'); // the app opens #/status/<id> with its panel
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
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('The platform is not answering. Try again.')).toBeTruthy();
    expect(manager.clear).not.toHaveBeenCalled();
    expect(manager.files).toHaveLength(1);
    expect(onSent).not.toHaveBeenCalled(); // it stays on Distribute with everything kept, and nothing says "Sent"
    expect(notify).not.toHaveBeenCalledWith('Sent');
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('turns picked files into the queue and lists the ones it refused', async () => {
    const manager = new FakeManager([]);
    screenWith(manager);
    const input = screen.getByLabelText('Choose files');
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7\n%%EOF\n'], 'ok.pdf'), new File(['x'], 'setup.exe')] } });
    expect(await screen.findByText(/setup\.exe/)).toBeTruthy();
    expect(manager.add).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/This type is not allowed/)).toBeTruthy();
  });

  it('puts a file whose contents are not what its name says in the "not added" box, with the reason (D-F1-44)', async () => {
    const manager = new FakeManager([]);
    screenWith(manager);
    const input = screen.getByLabelText('Choose files');
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.7\n%%EOF\n'], 'report.docx'), new File([png], 'photo.pdf'), new File(['MZ-program'], 'setup.pdf')] } });
    const box = await screen.findByRole('alert');
    await waitFor(() => expect(within(box).getByText('3 files not added')).toBeTruthy());
    expect([...box.querySelectorAll('.not-added-reason')].map((e) => e.textContent)).toEqual([
      'The contents are a PDF, but the name says .docx.',
      'The contents are a PNG, but the name says .pdf.',
      "This isn't a real PDF file.",
    ]);
    expect(manager.add).not.toHaveBeenCalled();
  });

  it('shows the refused files in one calm box: "1 file not added" (singular), "2 files not added", one Close for the box, none per line (D-F1-35)', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager([pageFile('a.pdf', 'verified')]);
    screenWith(manager);
    const input = screen.getByLabelText('Choose files');
    fireEvent.change(input, { target: { files: [new File(['x'], 'setup.exe')] } });
    const box = await screen.findByRole('alert');
    expect(within(box).getByText('1 file not added')).toBeTruthy();
    expect(within(box).getAllByRole('button')).toHaveLength(1);
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt')] } });
    expect(await within(screen.getByRole('alert')).findByText('2 files not added')).toBeTruthy();
    expect(box.querySelector('.not-added-name')?.textContent).toBe('setup.exe'); // the name in normal text
    expect(box.querySelector('.not-added-reason')?.textContent).toContain('This type is not allowed'); // the reason apart
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/files? not added/)).toBeNull();
    // Cleared with the page.
    fireEvent.change(input, { target: { files: [new File(['x'], 'setup.exe')] } });
    expect(await screen.findByText('1 file not added')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/files? not added/)).toBeNull();
  });
});

describe('the Filter… box over the file list (D-F1-41)', () => {
  const many = (n: number): PageFile[] => Array.from({ length: n }, (_, i) => pageFile(`${i % 2 === 0 ? 'Consent' : 'Labs'}-${String(i + 1).padStart(2, '0')}.pdf`, 'verified'));
  const dataRows = () => document.querySelectorAll('.frow[data-id]');

  it('is shown for more than 15 files and not for 15 or fewer', () => {
    screenWith(new FakeManager(many(15)));
    expect(screen.queryByRole('textbox', { name: 'Filter files' })).toBeNull();
    cleanup();
    screenWith(new FakeManager(many(16)));
    expect(screen.getByRole('textbox', { name: 'Filter files' }).getAttribute('placeholder')).toBe('Filter…');
  });

  it('matches anywhere in the name in any case, says "Showing N of M" and "No matches", and Esc empties it', async () => {
    const user = userEvent.setup();
    screenWith(new FakeManager(many(20)));
    const box = screen.getByRole('textbox', { name: 'Filter files' }) as HTMLInputElement;
    await user.type(box, 'labs-1');
    expect(dataRows()).toHaveLength(5); // Labs-02 .. Labs-20 even numbers starting with 1: 10, 12, 14, 16, 18
    expect(screen.getByText('Showing 5 of 20')).toBeTruthy();
    await user.clear(box);
    await user.type(box, 'zzz');
    expect(screen.getByText('No matches')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(box.value).toBe('');
    expect(dataRows()).toHaveLength(20);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('"No matches" is one centred line across the table with a "Clear filter" link that empties the box and returns the focus to it (D-F1-45)', async () => {
    const user = userEvent.setup();
    screenWith(new FakeManager(many(20)));
    const box = screen.getByRole('textbox', { name: 'Filter files' }) as HTMLInputElement;
    await user.type(box, 'zzz');
    const none = document.querySelector('.no-matches') as HTMLElement;
    expect(none.getAttribute('role')).toBe('status'); // the one shared component
    expect(none.textContent).toBe('No matchesClear filter');
    expect(none.closest('.ftable')).not.toBeNull(); // inside the table, spanning every column (grid-column: 1 / -1 in the stylesheet)
    await user.click(within(none).getByRole('button', { name: 'Clear filter' }));
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    expect(dataRows()).toHaveLength(20);
  });

  it('the Files filter box is the same component as the folder filter ("Filter…"): magnifier, one field style, and a height from the control tokens', () => {
    screenWith(new FakeManager(many(20)));
    const filter = screen.getByRole('textbox', { name: 'Filter files' });
    const search = screen.getByRole('searchbox', { name: 'Filter folders' });
    for (const box of [filter, search]) {
      expect(box.className).toBe('field');
      expect(box.parentElement?.classList.contains('searchfield')).toBe(true);
      expect(box.parentElement?.querySelector('svg')).not.toBeNull(); // the magnifier
    }
    expect(filter.getAttribute('placeholder')).toBe('Filter…'); // every box that narrows a loaded list says the same (D-F1-46)
    expect(search.getAttribute('placeholder')).toBe('Filter…'); // "Search folders" is gone
    expect(filter.parentElement?.classList.contains('sm')).toBe(true); // beside "Add files", a small button
    expect(search.parentElement?.classList.contains('md')).toBe(true);
    const css = readFileSync(join(process.cwd(), 'web/src/styles.css'), 'utf8');
    expect(css).toMatch(/\.searchfield\.sm \.field \{ min-height: var\(--control-sm\)/); // the same token as .btnsm
    expect(css).toMatch(/\.btnsm \{ min-height: var\(--control-sm\)/);
    expect(css).toMatch(/\.field \{ width: 100%; min-height: var\(--control\)/); // and the same token as .btn, .btn2
  });

  it('Select all and Send still act on all the files, not only the listed ones', async () => {
    const user = userEvent.setup();
    const submit = screenWith(new FakeManager(many(20)));
    await user.type(screen.getByRole('textbox', { name: 'Filter files' }), 'consent-0'); // 5 of 20 listed
    expect(dataRows()).toHaveLength(5);
    await user.click(screen.getByRole('checkbox', { name: 'Select all to choose their folders' }));
    expect(screen.getByRole('checkbox', { name: 'Select all to choose their folders' }).getAttribute('aria-checked')).toBe('true'); // all 20 are selected
    await user.click(screen.getByRole('checkbox', { name: 'Select all to choose their folders' })); // none again
    await user.click(await folderTick(user, `Send all 20 files to ${FOLDER}`)); // the folder takes all 20, not the 5 listed
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('dialog', { name: 'Send 20 files to 1 folder?' })).toBeTruthy();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    const body = (submit.mock.calls[0] as unknown[])[0] as { files: unknown[] };
    expect(body.files).toHaveLength(20);
  });

  it('keeps the box while the filter has text even if the list shrinks to 15 or fewer, and clears it with Clear', async () => {
    const user = userEvent.setup();
    const manager = new FakeManager(many(16));
    screenWith(manager);
    await user.type(screen.getByRole('textbox', { name: 'Filter files' }), 'labs');
    act(() => manager.set(many(16).slice(0, 15)));
    expect(screen.getByRole('textbox', { name: 'Filter files' })).toBeTruthy(); // the filter is still set, so it stays visible
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('textbox', { name: 'Filter files' })).toBeNull();
  });
});
