import { forwardRef, type FocusEventHandler, type KeyboardEventHandler, type MouseEventHandler } from 'react';
import { SearchIcon } from './Icons.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** What a screen reader calls the box. */
  label: string;
  placeholder: string;
  type?: 'search' | 'text';
  /** Off, for a list that is empty: the box stays where it is (D-F1-77). */
  disabled?: boolean;
  className?: string;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onClick?: MouseEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * The one search box (D-F1-45): a magnifier, the shared border, radius, padding and placeholder colour, and one height from
 * the control token (`--control`, 36 px, the same as every button beside it, D-F1-77). "Search folders" and every "Filter…" box
 * are this component, so they cannot drift apart.
 */
export const SearchField = forwardRef<HTMLInputElement, Props>(function SearchField(
  { value, onChange, label, placeholder, type = 'text', disabled = false, className = '', onFocus, onClick, onKeyDown },
  ref,
) {
  return (
    <span className={`searchfield ${className}`}>
      <SearchIcon size={14} />
      <input
        ref={ref}
        type={type}
        disabled={disabled}
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
