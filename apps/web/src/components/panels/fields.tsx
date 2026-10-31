import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Numeric field that commits one action on Enter/blur (not per keystroke). `onBegin` fires on focus so the
 * caller can capture the entity version the edit is based on (used for collaboration conflict checks).
 */
export function NumberField({ label, value, onCommit, onBegin, min, max, step = 0.05, suffix = "m", disabled }: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  onBegin?: () => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const format = (input: number) => Number(input.toFixed(4)).toFixed(decimals);
  const [draft, setDraft] = useState(format(value));
  // While unfocused the field always shows the canonical value (e.g. after a rejected/conflicting edit).
  const [focused, setFocused] = useState(false);

  const clamp = (input: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, input));
  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(format(value));
      return;
    }
    const next = clamp(parsed);
    setDraft(format(next));
    if (Math.abs(next - value) > 1e-9) onCommit(next);
  };

  return (
    <label className={"field" + (disabled ? " field--disabled" : "")}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={focused ? draft : format(value)}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setDraft(format(value));
            setFocused(true);
            onBegin?.();
            event.currentTarget.select();
          }}
          onMouseUp={(event) => event.preventDefault()}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(format(value));
              event.currentTarget.blur();
            }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const next = clamp(Number(draft) + (event.key === "ArrowUp" ? step : -step) * (event.shiftKey ? 10 : 1));
              if (Number.isFinite(next)) {
                setDraft(format(next));
                onCommit(Number(next.toFixed(4)));
              }
            }
          }}
        />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

export function Section({ title, aside, children, collapsible, defaultOpen = true }: { title: string; aside?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  if (collapsible) {
    return (
      <details className="inspector-block inspector-block--collapsible" open={defaultOpen}>
        <summary className="inspector-block-title"><span>{title}</span>{aside}</summary>
        {children}
      </details>
    );
  }
  return (
    <section className="inspector-block">
      <header className="inspector-block-title">
        <span>{title}</span>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <label className="toggle-row" title={hint}>
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className={"switch" + (checked ? " switch--on" : "")} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  // Preview while dragging; commit once on the native "change" event so the picker makes one history entry.
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => input.value !== latest.current.value && latest.current.onChange(input.value);
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, []);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input field-input--color">
        <input ref={inputRef} type="color" value={draft} aria-label={label} onChange={(event) => setDraft(event.target.value)} />
        <em>{draft.toUpperCase()}</em>
      </span>
    </label>
  );
}
