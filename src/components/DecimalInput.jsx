import { useState } from 'react';

export default function DecimalInput({ value, onCommit, min = 0, precision = 3, ...props }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={draft ?? value.toFixed(precision)}
      onChange={event => setDraft(event.target.value)}
      onBlur={event => {
        if (draft === null) return;
        const text = event.currentTarget.value.trim();
        const number = Number(text);
        if (/^(?:\d+\.?\d*|\.\d+)$/.test(text) && Number.isFinite(number) && number >= min) onCommit(number);
        setDraft(null);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
      }}
    />
  );
}
