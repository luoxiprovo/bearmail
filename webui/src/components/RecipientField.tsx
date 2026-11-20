import { useEffect, useId, useRef, useState } from "react";
import { matchSenderAddresses, recipientTokenAt, replaceRecipientToken, type SenderAddress } from "../jmap/mail";

interface RecipientFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: SenderAddress[];
  onSearch?: (text: string) => () => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
}

export function RecipientField({ id, value, onChange, suggestions, onSearch, placeholder, required, autoFocus }: RecipientFieldProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const token = recipientTokenAt(value, cursor);
  const taken = new Set(
    value.split(",").map((item) => item.trim().toLowerCase()).filter((item) => item && item !== token.text.trim().toLowerCase()),
  );
  const matches = matchSenderAddresses(suggestions, token.text).filter((sender) => !taken.has(sender.email.toLowerCase()));
  const exact = matches.some((sender) => sender.email.toLowerCase() === token.text.trim().toLowerCase());
  const visible = open && matches.length > 0 && !exact;
  const highlighted = Math.min(active, Math.max(matches.length - 1, 0));

  useEffect(() => {
    const text = token.text.trim();
    if (text.length < 2 || !onSearch) return;
    let cancel = () => {};
    const timer = window.setTimeout(() => {
      cancel = onSearch(text) ?? (() => {});
    }, 250);
    return () => {
      window.clearTimeout(timer);
      cancel();
    };
  }, [onSearch, token.text]);

  const rememberCursor = () => {
    const input = inputRef.current;
    if (input) setCursor(input.selectionStart ?? input.value.length);
  };
  const choose = (sender: SenderAddress) => {
    const next = replaceRecipientToken(value, token, sender.email);
    onChange(next);
    setOpen(false);
    const place = next.endsWith(sender.email) ? next.length : next.indexOf(sender.email) + sender.email.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(place, place);
      setCursor(place);
    });
  };

  return (
    <div className="recipient-field">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible ? `${listId}-${highlighted}` : undefined}
        autoFocus={autoFocus}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onFocus={() => { rememberCursor(); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onClick={rememberCursor}
        onSelect={rememberCursor}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart ?? event.target.value.length);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!visible) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) => (current - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const sender = matches[highlighted];
            if (sender) choose(sender);
          }
        }}
      />
      {visible && (
        <ul id={listId} className="recipient-suggestions" role="listbox" aria-label="People who emailed you">
          {matches.map((sender, index) => (
            <li key={sender.email} role="presentation">
              <button
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(sender)}
              >
                <b>{sender.name || sender.email}</b>
                {sender.name && <small>{sender.email}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
