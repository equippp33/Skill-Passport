"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "~/lib/utils";

export interface PickableLanguage {
  key: string;
  displayName: string;
  promptName: string;
  /** A glyph from the language's own script — see `config/languages.ts`. */
  symbol: string;
}

/**
 * Language dropdown shown above the interview.
 *
 * A backup for automatic detection, not the primary route: detection runs on
 * the candidate's first answer and is right almost always. This is here for
 * the case where it is not, and for the candidate who simply wants to switch.
 *
 * Deliberately a custom listbox rather than a native `<select>`. Each option
 * carries a script glyph and both the native and English name, which a
 * native select cannot lay out, and the eleven scripts render far more
 * legibly at the size a rendered menu allows.
 *
 * Accessibility: full keyboard support (arrows, Home/End, Escape, Enter),
 * `aria-activedescendant` so the active option is announced, and focus
 * returned to the trigger on close.
 */
export function LanguagePicker({
  languages,
  value,
  onSelect,
  disabled = false,
  busy = false,
  label,
  hint,
}: {
  languages: PickableLanguage[];
  /** Current language key, or null before detection has run. */
  value: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const listId = useId();
  const labelId = useId();

  const selectedIndex = languages.findIndex((l) => l.key === value);
  const selected = selectedIndex >= 0 ? languages[selectedIndex] : null;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /** Open with the current selection highlighted, not the first row. */
  function toggle() {
    if (disabled || busy) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen((v) => !v);
  }

  // Clicking anywhere else dismisses. `pointerdown` rather than `click` so
  // the menu is gone before the click lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Move DOM focus into the list so keystrokes reach it rather than the page.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function choose(index: number) {
    const language = languages[index];
    if (!language) return;
    close(true);
    if (language.key !== value) onSelect(language.key);
  }

  function onListKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % languages.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + languages.length) % languages.length);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(languages.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        close(true);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span id={labelId} className="text-sm text-content-muted">
          {label}
        </span>

        <button
          ref={triggerRef}
          type="button"
          disabled={disabled || busy}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              toggle();
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-labelledby={labelId}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5",
            "border-border-strong bg-surface text-sm font-medium transition-colors",
            "hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60",
            open && "bg-surface-muted",
          )}
        >
          <Glyph symbol={selected?.symbol ?? "?"} />
          <span>{selected ? selected.displayName : "Detecting…"}</span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={cn(
              "size-4 text-content-muted transition-transform duration-150",
              open && "rotate-180",
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="m6 8 4 4 4-4" strokeLinecap="round" />
          </svg>
        </button>

        {busy ? (
          <span className="text-sm text-content-muted">Switching…</span>
        ) : hint ? (
          <span className="text-xs text-content-muted">{hint}</span>
        ) : null}
      </div>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={`${listId}-${activeIndex}`}
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute right-0 z-40 mt-2 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto p-1",
            "rounded-xl border border-border-subtle bg-surface",
            "shadow-[var(--shadow-raised)] outline-none",
          )}
        >
          {languages.map((language, index) => {
            const isSelected = language.key === value;
            const isActive = index === activeIndex;

            return (
              <div
                key={language.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => choose(index)}
                onPointerEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2",
                  isActive && "bg-surface-muted",
                  isSelected && "bg-accent-soft",
                )}
              >
                <Glyph symbol={language.symbol} highlighted={isSelected} />

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {language.displayName}
                  </span>
                  {/* The English name is what lets someone who cannot read a
                      script still find their language in the list. */}
                  <span className="block text-xs text-content-muted">
                    {language.promptName}
                  </span>
                </span>

                {isSelected ? (
                  <svg
                    aria-hidden
                    viewBox="0 0 20 20"
                    className="size-4 shrink-0 text-accent"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="m4 10 4 4 8-8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The script glyph, in a fixed square so rows stay aligned across scripts. */
function Glyph({
  symbol,
  highlighted = false,
}: {
  symbol: string;
  highlighted?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-sm leading-normal font-semibold",
        highlighted
          ? "bg-accent text-accent-contrast"
          : "bg-surface-muted text-content-muted",
      )}
    >
      {symbol}
    </span>
  );
}
