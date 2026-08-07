"use client";

import { useActionState, useState } from "react";
import { savePreferredLanguage, type LanguageSettingsState } from "@/app/settings/actions";
import { LanguageSelector } from "./LanguageSelector";
import type { SupportedLanguageCode } from "@/shared/languages";

export function PreferredLanguageSetting({ initialLanguage }: { initialLanguage: SupportedLanguageCode }) {
  const initialState: LanguageSettingsState = { ok: false, message: "", language: initialLanguage };
  const [state, action, pending] = useActionState(savePreferredLanguage, initialState);
  const [language, setLanguage] = useState(initialLanguage);

  return (
    <form action={action} className="grid gap-4">
      <LanguageSelector value={language} onChange={setLanguage} name="language" disabled={pending} label="Preferred language" />
      <p className="text-xs leading-5 text-slate-500">
        AI Chat, summaries, quizzes, revision plans, and Voice Tutor use this language by default.
      </p>
      {state.message ? (
        <div className={`rounded-md border px-3 py-2 text-sm ${state.ok ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-red-300/25 bg-red-300/10 text-red-100"}`}>
          {state.message}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="h-10 w-fit rounded-md bg-emerald-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save language"}
      </button>
    </form>
  );
}
