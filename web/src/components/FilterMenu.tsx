import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CheckIcon, ChevronIcon } from './Icons.js';
import { ListFilter, matchesFilter, NoMatches } from './ListFilter.js';

interface Choice {
  value: string;
  label: string;
}

interface Props {
  /** The filter's name: "Status", "Sender", "Sent", "Team". */
  label: string;
  /** The chosen value, or undefined when the filter is not set. */
  value: string | undefined;
  /** What the button shows after the name when a value is set ("Me" gives "Sender: Me"). */
  valueLabel: string;
  /** The first choice, which clears the filter: "Any status", "Anyone", "Any time", "Any team". */
  anyLabel: string;
  choices: Choice[];
  onChange: (value: string | undefined) => void;
  /** A "Filter…" box shows above the choices when there are more than this many (the Sender menu: 10 people, D-F1-41). Never set on Status, Sent or Team. */
  filterAfter?: number;
  /** What the box is called for a screen reader: "Filter senders". */
  filterLabel?: string;
}

/**
 * One filter: a small button that opens a short menu (D-F1-21). A set filter shows its value on the button, in the
 * accent style. Up and Down move, Enter or Space chooses, Esc closes and gives the focus back, a click outside closes.
 */
export function FilterMenu({ label, value, valueLabel, anyLabel, choices, onChange, filterAfter, filterLabel = `Filter ${label.toLowerCase()}` }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const filterable = filterAfter !== undefined && choices.length > filterAfter;
  // "Anyone" stays whatever is typed: it is how the filter is cleared. The box narrows the people already loaded.
  const items: Array<{ value: string | undefined; label: string }> = [{ value: undefined, label: anyLabel }, ...choices.filter((c) => !filterable || matchesFilter(c.label, query))];

  useEffect(() => {
    if (!open) return;
    if (filterable) {
      box.current?.focus(); // many people: the box takes the focus, the arrow keys go on into the list
    } else {
      const checked = items.findIndex((i) => i.value === value);
      const rows = wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
      rows?.[checked >= 0 ? checked : 0]?.focus();
    }
    const onPointer = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]); // the menu is focused once, when it opens

  const close = (): void => {
    setOpen(false);
    setQuery('');
    button.current?.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!open) return;
    const rows = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const typing = event.target === box.current;
    if (typing && (event.key === 'Home' || event.key === 'End')) return; // they move the cursor in the box
    if (event.key === 'Escape') {
      event.preventDefault(); // the side panel's Escape leaves a key that is already taken
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      // From the box with something typed, Down goes to the first match, not to "Anyone" above it.
      rows[typing && query !== '' ? Math.min(rows.length - 1, 1) : Math.min(rows.length - 1, at + 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      rows[Math.max(0, at - 1)]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      rows[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      rows[rows.length - 1]?.focus();
    } else if (event.key === 'Tab') setOpen(false);
  };

  const set = value !== undefined;
  return (
    <div className="fmenu-wrap" ref={wrap} onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className={`fbtn ${set ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {set ? `${label}: ${valueLabel}` : label}
        <ChevronIcon open size={12} />
      </button>
      {open && (
        <div id={menuId} className="fmenu card" role="menu" aria-label={label}>
          {filterable && (
            <div className="fmenu-filter" role="none">
              <ListFilter ref={box} value={query} onChange={setQuery} label={filterLabel} />
            </div>
          )}
          {filterable && items.length === 1 && (
            <NoMatches
              onClear={() => {
                setQuery('');
                box.current?.focus();
              }}
            />
          )}
          {items.map((item) => {
            const chosen = item.value === value;
            return (
              <button
                key={item.value ?? 'any'}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                className="fitem"
                onClick={() => {
                  onChange(item.value);
                  close();
                }}
              >
                <span className="fcheck">{chosen && <CheckIcon size={12} />}</span>
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
