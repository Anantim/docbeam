import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiFailure } from '../auth/session.js';
import { trackingApi, type JobSummary } from '../tracking/api.js';
import { formatWhen, shortId } from '../tracking/format.js';
import { extractJobId } from '../tracking/route.js';
import { SearchIcon } from './Icons.js';

interface Props {
  /** Called with the full id of the distribution to open. */
  onOpen: (jobId: string) => void;
  /** The signed-in person, so a distribution they sent reads "You" in the list of matches. */
  meId?: string;
}

const NOTHING = 'No distribution with that ID that you can see.';
const BAD = 'Enter the 8-character ID from the list, the full ID, or a link.';
const SHORT = /^[0-9a-f]{8}$/i;

/**
 * "Open by ID": an icon button that opens a small card with one field (D-F1-15). Paste a full id or a link, or type the
 * 8 characters the list shows (D-F1-32), and press Enter or Open. One match opens at once; several are listed to choose
 * from (id, sent at, sender); none says so. It closes with Esc, a click outside, or after it opens a distribution.
 */
export function OpenById({ onOpen, meId }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [matches, setMatches] = useState<JobSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const ticket = useRef(0);

  // A lookup that is still running when the text changes or the card closes is dropped.
  useEffect(() => {
    ticket.current += 1;
    setBusy(false);
  }, [typed, open]);

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

  const finish = (id: string): void => {
    setTyped('');
    setMatches([]);
    setNote('');
    setOpen(false);
    onOpen(id);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setNote('');
    setMatches([]);
    const text = typed.trim();
    if (text === '') return;
    const full = extractJobId(text);
    if (full) return finish(full); // a full id or a link: the page says "not found" itself if it is not visible
    if (!SHORT.test(text)) {
      setNote(BAD);
      return;
    }
    const mine = ++ticket.current;
    setBusy(true);
    try {
      const found = await trackingApi.byIdPrefix(text.toLowerCase());
      if (mine !== ticket.current) return; // the text changed or the card closed meanwhile
      if (found.length === 1 && found[0]) finish(found[0].jobId);
      else if (found.length === 0) setNote(NOTHING);
      else setMatches(found);
    } catch (e) {
      if (mine !== ticket.current) return;
      setNote(e instanceof ApiFailure ? e.message : 'The ID could not be looked up. Try again.');
    } finally {
      if (mine === ticket.current) setBusy(false);
    }
  };

  const empty = typed.trim() === '';

  return (
    <div
      className="openid"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault(); // the side panel's Escape handler leaves a key that is already taken
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
        <form id={panelId} className="openid-card card" onSubmit={(e) => void submit(e)} aria-label="Open a distribution by ID">
          <label htmlFor={`${panelId}-field`}>Distribution ID or link</label>
          <input
            id={`${panelId}-field`}
            ref={field}
            className="field"
            value={typed}
            placeholder="Distribution ID or link"
            onChange={(e) => {
              setTyped(e.target.value);
              setNote('');
              setMatches([]);
            }}
          />
          {note && (
            <div role="alert" className="openid-note">
              {note}
            </div>
          )}
          {matches.length > 0 && (
            <ul className="openid-matches" aria-label="Distributions with that ID">
              {matches.map((m) => (
                <li key={m.jobId}>
                  <button type="button" className="openid-match" onClick={() => finish(m.jobId)}>
                    <span className="mono">{shortId(m.jobId)}</span>
                    <span>{formatWhen(m.createdAt)}</span>
                    <span className="muted">{m.submittedBy.userId === meId ? 'You' : m.submittedBy.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="openid-actions">
            <button className="btn btnsm" type="submit" disabled={empty || busy} title={empty ? 'Enter a distribution ID or link first' : undefined}>
              Open
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
