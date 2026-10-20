import { forwardRef, type FocusEventHandler, type KeyboardEventHandler, type MouseEventHandler } from 'react';
import { SearchIcon } from './Icons.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** What a screen reader calls the box. */
  label: string;
  placeholder: string;
  type?: 'search' | 'text';
  /** `sm` is the height of a small button (`--control-sm`), for a box that sits on one row with one, like "Add files". */
  size?: 'md' | 'sm';
  className?: string;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onClick?: MouseEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * The one search box (D-F1-45): a magnifier, the shared border, radius, padding and placeholder colour, and one height from
 * the control tokens (`--control`, or `--control-sm` with a small button). "Search folders" and every "Filter…" box are this
 * component, so they cannot drift apart.
 */
export const SearchField = forwardRef<HTMLInputElement, Props>(function SearchField(
  { value, onChange, label, placeholder, type = 'text', size = 'md', className = '', onFocus, onClick, onKeyDown },
  ref,
) {
  return (
    <span className={`searchfield ${size} ${className}`}>
      <SearchIcon size={14} />
      <input
        ref={ref}
        type={type}
        className="field"
        placeholder={placeholder}
        aria-label={label}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onFocus={onFocus}
        onClick={onClick}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </span>
  );
});
