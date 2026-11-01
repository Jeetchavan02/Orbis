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

  // Stepping (arrow keys or the ▲▼ buttons): a burst of steps commits as ONE action once the user pauses.
  // Committing every step would send each one against the same base version before the server echoed the
  // previous one, so the second step would be rejected as stale.
  const [stepping, setStepping] = useState(false);
  const pending = useRef<number | null>(null);
  const flushTimer = useRef<number | null>(null);
  const repeat = useRef<{ delay: number | null; interval: number | null }>({ delay: null, interval: null });
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  const flush = () => {
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const next = pending.current;
    pending.current = null;
    setStepping(false);
    if (next !== null && Math.abs(next - latest.current.value) > 1e-9) latest.current.onCommit(next);
  };
  const stepBy = (direction: 1 | -1, multiplier: number) => {
    const current = pending.current ?? (focused && Number.isFinite(Number(draft)) ? Number(draft) : value);
    const next = Number(clamp(current + direction * step * multiplier).toFixed(4));
    if (pending.current === null) onBegin?.(); // base version for this burst
    pending.current = next;
    setDraft(format(next));
    setStepping(true);
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flush, 450);
  };
  const stopRepeat = () => {
    if (repeat.current.delay !== null) window.clearTimeout(repeat.current.delay);
    if (repeat.current.interval !== null) window.clearInterval(repeat.current.interval);
    repeat.current = { delay: null, interval: null };
  };
  const startRepeat = (direction: 1 | -1, multiplier: number) => {
    stopRepeat();
    stepBy(direction, multiplier);
    repeat.current.delay = window.setTimeout(() => {
      repeat.current.interval = window.setInterval(() => stepBy(direction, multiplier), 70);
    }, 380);
  };
  const multiplierFor = (event: { shiftKey: boolean; altKey: boolean }) => (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
  // Commit a pending burst if the field unmounts (e.g. selection changes) instead of losing it.
  useEffect(() => () => {
    stopRepeat();
    if (pending.current !== null) flush();
  }, []);

  return (
    <label className={"field" + (disabled ? " field--disabled" : "")}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={focused || stepping ? draft : format(value)}
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
            if (pending.current !== null) flush();
            else commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
              pending.current = null;
              setStepping(false);
              setDraft(format(value));
              event.currentTarget.blur();
            }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              stepBy(event.key === "ArrowUp" ? 1 : -1, multiplierFor(event));
            }
          }}
        />
        <em>{suffix}</em>
        {!disabled ? (
          <span className="field-steppers">
            {([1, -1] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                tabIndex={-1}
                aria-label={(direction === 1 ? "Increase " : "Decrease ") + label}
                title={`${direction === 1 ? "Increase" : "Decrease"} by ${step}${suffix === "°" ? "°" : " " + suffix} (Shift ×10, Alt ÷10, or use ↑↓)`}
                onMouseDown={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  startRepeat(direction, multiplierFor(event));
                }}
                onPointerUp={stopRepeat}
                onPointerCancel={stopRepeat}
                onLostPointerCapture={stopRepeat}
                onClick={(event) => event.preventDefault()}
              >
                <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true"><path d={direction === 1 ? "M0.5 4.5 4 1l3.5 3.5" : "M0.5 0.5 4 4l3.5-3.5"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ))}
          </span>
        ) : null}
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
