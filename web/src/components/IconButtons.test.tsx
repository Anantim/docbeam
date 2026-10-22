// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageFile } from '../upload/manager.js';
import { iconButtonProblems, iconOnlyButtons } from '../testing/icon-buttons.js';
import { tooltipOf } from '../testing/tooltip.js';

const apiFetch = vi.fn();
vi.mock('../auth/session.js', () => ({ apiFetch: (path: string) => apiFetch(path), logout: vi.fn(), ApiFailure: class extends Error {} }));

const { Shell } = await import('./Shell.js');
const { FileTable } = await import('./FileTable.js');
const { AddFiles } = await import('./AddFiles.js');
const { Destinations } = await import('./Destinations.js');
const { Preview } = await import('./Preview.js');

const answers: Record<string, unknown> = {
  '/teams': { items: [{ id: 't-cardio', name: 'Cardio' }], nextCursor: null },
  '/teams/t-cardio/binders': { items: [{ id: 'b-reg', name: 'CARDIO-301 Regulatory' }], nextCursor: null },
  '/binders/b-reg/contents': { folders: [{ id: 'f-irb', name: 'IRB approvals' }], documents: [], nextCursor: null },
};

beforeEach(() => {
  apiFetch.mockImplementation(async (path: string) => answers[path]);
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

const claims = { sub: 'u', name: 'Priya Shah', email: 'p@example.test', exp: 0 };
const file = (id: string, status: PageFile['status']): PageFile => ({
  id,
  file: new File([new Uint8Array(1)], `${id}.pdf`),
  name: `${id}.pdf`,
  sizeBytes: 1,
  contentType: 'application/pdf',
  status,
  progress: 1,
  partsDone: 0,
  partCount: 0,
  sha256: 'a'.repeat(64),
  serverId: `server-${id}`,
});
const mapping = {
  destinations: { k1: { binderId: 'b-reg', folderId: 'f-irb', path: 'Cardio / CARDIO-301 Regulatory / IRB approvals' } },
  files: { ok: ['k1'], bad: [], wait: [] },
  held: [],
};
const noop = (): void => undefined;

function expectClean(root: ParentNode, minimum: number): void {
  expect(iconOnlyButtons(root).length).toBeGreaterThanOrEqual(minimum);
  expect(iconButtonProblems(root)).toEqual([]);
}

describe('every icon-only button has an aria-label and a tooltip with the same text (D-M3-10, D-F1-47)', () => {
  it('in the shell (Sign out)', () => {
    const { container } = render(
      <Shell claims={claims} teams={['Cardio']} view="status" onView={noop} running={2}>
        <div />
      </Shell>,
    );
    expectClean(container, 1);
  });

  it('in the Documents table, for every file state', () => {
    const files = [file('ok', 'verified'), file('wait', 'uploading'), file('bad', 'refused'), file('stop', 'interrupted')];
    const { container } = render(
      <FileTable
        files={files}
        mapping={mapping}
        selected={new Set(['ok'])}
        onPick={noop}
        onToggleAll={noop}
        onPreview={noop}
        onRetry={noop}
        onRemove={noop}
      />,
    );
    expectClean(container, 10);
    // The Retry button says what it retries.
    expect(tooltipOf(screen.getByRole('button', { name: 'Retry upload of bad.pdf' }))).toBe('Retry upload of bad.pdf');
  });

  it('in the Not added list', () => {
    const { container } = render(<AddFiles empty={false} onPick={noop} rejected={[{ name: 'setup.exe', reason: 'This type is not allowed.' }]} onDismiss={noop} />);
    expectClean(container, 1); // one Close for the whole box (D-F1-35)
  });

  it('in the Destinations tree (expand buttons and the folder ticks)', async () => {
    const user = userEvent.setup();
    const { container } = render(<Destinations stateOf={() => 'off'} onToggle={noop} onTeams={noop} />);
    await user.click(await screen.findByRole('button', { name: 'Expand Cardio' }));
    await user.click(await screen.findByRole('button', { name: 'Expand CARDIO-301 Regulatory' }));
    await screen.findByText('IRB approvals');
    expectClean(container, 2);
  });

  it('in the preview dialog (Close)', () => {
    const { container } = render(<Preview name="a.pdf" contentType="application/pdf" sizeBytes={1} blob={new Blob(['x'])} meta="1 B" note="" onClose={noop} />);
    expectClean(container, 1);
  });

  it('catches a button that breaks the rule', () => {
    const { container } = render(
      <div>
        <button type="button">✕</button>
        <button type="button" aria-label="Remove a.pdf">
          ✕
        </button>
      </div>,
    );
    expect(iconButtonProblems(container)).toHaveLength(2);
  });
});
