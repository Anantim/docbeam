import { forwardRef, type FocusEventHandler, type MouseEventHandler } from 'react';
import { SearchField } from './SearchField.js';

/** A list is long enough to filter above this many items (D-F1-41). Each list sets its own: files, deliveries, popovers 15; people 10. */
export const FILTER_AFTER = { popover: 15, deliveries: 15, files: 15, people: 10 } as const;

/** True when `text` holds the words typed, in any case, anywhere in it. An empty box matches everything. */
export function matchesFilter(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || text.toLowerCase().includes(q);
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** What a screen reader calls the box, for example "Filter files". The box itself says "Filter…". */
  label: string;
  className?: string;
  size?: 'md' | 'sm';
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onClick?: MouseEventHandler<HTMLInputElement>;
}

/**
 * The one "Filter…" box (D-F1-41): case-insensitive, matches anywhere in the text, and the lists that use it show it only
 * past a threshold. It is the search box of the Destinations card (D-F1-45). Esc empties it; with nothing in it Esc goes on
 * to whatever it sits in (a popover, a menu, the panel).
 */
export const ListFilter = forwardRef<HTMLInputElement, Props>(function ListFilter({ value, onChange, label, className = '', size = 'md', onFocus, onClick }, ref) {
  return (
    <SearchField
      ref={ref}
      value={value}
      onChange={onChange}
      label={label}
      placeholder="Filter…"
      size={size}
      className={className}
      onFocus={onFocus}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value !== '') {
          e.preventDefault();
          e.stopPropagation();
          onChange('');
        }
      }}
    />
  );
});

/**
 * "No matches" for every filtered list and popover (D-F1-45): one line, centred across the whole width of the list, with a
 * "Clear filter" link. The caller empties its box and puts the focus back in it.
 */
export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="no-matches" role="status">
      <span>No matches</span>
      <button type="button" className="link" onClick={onClear}>
        Clear filter
      </button>
    </div>
  );
}
