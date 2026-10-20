import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { extractJobId } from '../tracking/route.js';
import { SearchIcon } from './Icons.js';

interface Props {
  /** Called with the full id of the distribution to open. */
  onOpen: (jobId: string) => void;
}

const SHORT_ID_NOTE = 'Paste the full distribution id or a link to it. The short 8-character id is not enough.';

/**
 * "Open by ID": an icon button that opens a small card with one field (D-F1-15). Paste a full id or a link and press
 * Enter or Open. It closes with Esc, a click outside, or after it opens a distribution.
 */
export function OpenById({ onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const onPointer = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setNote('');
    if (typed.trim() === '') return;
    const id = extractJobId(typed);
    if (!id) {
      setNote(SHORT_ID_NOTE);
      return;
    }
    setTyped('');
    setOpen(false);
    onOpen(id);
  };

  const empty = typed.trim() === '';

  return (
    <div
      className="openid"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        className="icon"
        type="button"
        aria-label="Open by ID"
        title="Open by ID"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <SearchIcon size={16} />
      </button>
      {open && (
        <form id={panelId} className="openid-card card" onSubmit={submit} aria-label="Open a distribution by ID">
          <label htmlFor={`${panelId}-field`}>Distribution ID or link</label>
          <input
            id={`${panelId}-field`}
            ref={field}
            className="field"
            value={typed}
            placeholder="Paste a full id or a link"
            onChange={(e) => {
              setTyped(e.target.value);
              setNote('');
            }}
          />
          {note && (
            <div role="alert" className="openid-note">
              {note}
            </div>
          )}
          <div className="openid-actions">
            <button className="btn btnsm" type="submit" disabled={empty} title={empty ? 'Paste a distribution id or link first' : undefined}>
              Open
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
