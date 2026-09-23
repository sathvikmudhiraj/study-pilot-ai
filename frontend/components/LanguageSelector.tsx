"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  SUPPORTED_LANGUAGES,
  normalizeLanguageCode,
  type SupportedLanguageCode,
} from "@/shared/languages";

export function LanguageSelector({
  value,
  onChange,
  name,
  id,
  label = "Language",
  showLabel = true,
  disabled = false,
  compact = false,
}: {
  value: SupportedLanguageCode;
  onChange?: (language: SupportedLanguageCode) => void;
  name?: string;
  id?: string;
  label?: string;
  showLabel?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLLabelElement>(null);
  const listboxId = useId();
  const selectedLanguage =
    SUPPORTED_LANGUAGES.find((language) => language.code === value) ??
    SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function changeLanguage(nextValue: string) {
    const nextLanguage = normalizeLanguageCode(nextValue);
    onChange?.(nextLanguage);
    setOpen(false);
  }

  function moveSelection(direction: 1 | -1) {
    const currentIndex = SUPPORTED_LANGUAGES.findIndex(
      (language) => language.code === selectedLanguage.code,
    );
    const nextIndex =
      (currentIndex + direction + SUPPORTED_LANGUAGES.length) %
      SUPPORTED_LANGUAGES.length;
    changeLanguage(SUPPORTED_LANGUAGES[nextIndex].code);
  }

  return (
    <label
      ref={rootRef}
      className={`grid min-w-0 gap-1.5 text-xs font-medium text-slate-300 ${compact ? "w-full sm:w-auto" : "w-full"}`}
    >
      {showLabel ? (
        <span className="text-[11px] font-semibold uppercase text-slate-500">
          {label}
        </span>
      ) : null}
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="relative min-w-0">
        <button
          id={id}
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) setOpen(true);
              else moveSelection(1);
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) setOpen(true);
              else moveSelection(-1);
            }
          }}
          className={`${compact ? "h-9 sm:min-w-40" : "h-11"} flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/80 px-3 text-left text-sm text-slate-100 outline-none transition hover:border-emerald-300/40 hover:bg-slate-900 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span className="min-w-0 truncate">
            {selectedLanguage.label}
          </span>
          <span
            aria-hidden="true"
            className={`text-xs text-slate-400 transition ${open ? "rotate-180" : ""}`}
          >
            v
          </span>
        </button>

        {open ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="absolute right-0 top-full z-50 mt-2 max-h-56 w-full min-w-full overflow-y-auto rounded-xl border border-white/10 bg-[#080d18] p-1.5 shadow-2xl shadow-black/50 ring-1 ring-emerald-400/10"
          >
            {SUPPORTED_LANGUAGES.map((language) => {
              const active = language.code === selectedLanguage.code;
              return (
                <button
                  key={language.code}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => changeLanguage(language.code)}
                  className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                    active
                      ? "bg-emerald-400/15 text-emerald-100"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {language.label}
                    {language.nativeLabel === language.label
                      ? ""
                      : ` - ${language.nativeLabel}`}
                  </span>
                  {active ? (
                    <span className="text-xs font-semibold text-emerald-300">
                      Selected
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange?.(normalizeLanguageCode(event.target.value))
        }
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
            {language.nativeLabel === language.label
              ? ""
              : ` - ${language.nativeLabel}`}
          </option>
        ))}
      </select>
    </label>
  );
}
