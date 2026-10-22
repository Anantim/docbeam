// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog.js';
import { focusPageHeading } from './useFocusTrap.js';

// Where the focus goes when a dialog closes (D-F1-78): back to the control that opened it; if that control is gone or off, to the
// heading of the page. The question before Send, Clear and sign out are covered next to their own screens; these are the dialogs
// that have no screen test of their own, and the rule itself.

const login = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../auth/session.js', () => ({ login, logout: vi.fn(), AuthError: class AuthError extends Error {} }));

const { SessionDialog } = await import('./SessionDialog.js');
const { Preview } = await import('./Preview.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Harness({ children }: { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <h1>The page</h1>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {open && children(() => setOpen(false))}
    </div>
  );
}

describe('ConfirmDialog', () => {
  const dialog = (onYes: () => void) => (close: () => void) => (
    <ConfirmDialog heading="Sure?" confirmLabel="Yes" cancelLabel="No" onConfirm={() => (onYes(), close())} onCancel={close}>
      <p>Really.</p>
    </ConfirmDialog>
  );

  it('starts on the safe answer and gives the focus back to the opener on every way out: No, Esc, the overlay and Yes', async () => {
    const user = userEvent.setup();
    const yes = vi.fn();
    render(<Harness>{dialog(yes)}</Harness>);
    const opener = screen.getByRole('button', { name: 'Open it' });

    await user.click(opener);
    expect(document.activeElement?.textContent).toBe('No');
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(document.querySelector('.overlay') as HTMLElement);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes' }));
    expect(yes).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('puts the focus on the page heading when the opener has gone', async () => {
    const user = userEvent.setup();
    function Goes() {
      const [state, setState] = useState<'idle' | 'asking' | 'done'>('idle');
      return (
        <div>
          <h1>The page</h1>
          {state === 'idle' && <button onClick={() => setState('asking')}>Open it</button>}
          {state === 'asking' && (
            <ConfirmDialog heading="Sure?" confirmLabel="Yes" cancelLabel="No" onConfirm={() => setState('done')} onCancel={() => setState('idle')}>
              <p>Really.</p>
            </ConfirmDialog>
          )}
        </div>
      );
    }
    render(<Goes />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await user.click(screen.getByRole('button', { name: 'Yes' })); // the opener is gone after this
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'The page' }));
  });
});

describe('Preview', () => {
  it('gives the focus back to its opener when it closes', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(close) => <Preview name="a.png" contentType="image/png" sizeBytes={3} blob={new Blob(['x'], { type: 'image/png' })} meta="3 B" onClose={close} />}
      </Harness>,
    );
    const opener = screen.getByRole('button', { name: 'Open it' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Close preview' }));
    expect(document.activeElement).toBe(opener);
  });
});

describe('SessionDialog', () => {
  it('gives the focus back to what had it before the dialog opened, once the person has signed in again', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {(close) => <SessionDialog email="a@example.com" onSignedIn={close} />}
      </Harness>,
    );
    const opener = screen.getByRole('button', { name: 'Open it' });
    await user.click(opener);
    await user.type(screen.getByLabelText('Password'), 'pw{Enter}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe('focusPageHeading', () => {
  it('focuses the first heading that is not hidden, and does nothing when there is none', () => {
    render(
      <div>
        <div hidden>
          <h1>Hidden screen</h1>
        </div>
        <h1>Shown screen</h1>
      </div>,
    );
    focusPageHeading();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Shown screen' }));
    cleanup();
    focusPageHeading(); // no heading: no error
  });
});
