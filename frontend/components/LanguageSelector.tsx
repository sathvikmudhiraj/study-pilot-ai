"use client";

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
  disabled = false,
  compact = false,
}: {
  value: SupportedLanguageCode;
  onChange?: (language: SupportedLanguageCode) => void;
  name?: string;
  id?: string;
  label?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label className={`grid min-w-0 gap-1.5 text-xs font-medium text-slate-300 ${compact ? "w-full sm:w-auto" : "w-full"}`}>
      <span className="text-[11px] font-semibold uppercase text-slate-500">{label}</span>
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange?.(normalizeLanguageCode(event.target.value))}
        className={`${compact ? "h-9 sm:min-w-40" : "h-11"} min-w-0 rounded-md border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}{language.nativeLabel === language.label ? "" : ` - ${language.nativeLabel}`}
          </option>
        ))}
      </select>
    </label>
  );
}

