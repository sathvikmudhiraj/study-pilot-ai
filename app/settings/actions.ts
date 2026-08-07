"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { isSupportedLanguageCode, normalizeLanguageCode, type SupportedLanguageCode } from "@/shared/languages";

export type LanguageSettingsState = {
  ok: boolean;
  message: string;
  language: SupportedLanguageCode;
};

export async function savePreferredLanguage(
  previous: LanguageSettingsState,
  formData: FormData,
): Promise<LanguageSettingsState> {
  const rawLanguage = formData.get("language");
  if (!isSupportedLanguageCode(rawLanguage)) {
    return { ...previous, ok: false, message: "Choose a supported language." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { ...previous, ok: false, message: "Supabase is not configured." };
  }

  const language = normalizeLanguageCode(rawLanguage);
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) {
    return { ...previous, ok: false, message: "Please log in again." };
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      ...userResult.user.user_metadata,
      preferred_language: language,
    },
  });

  if (error) {
    return { ...previous, ok: false, message: "Could not save your language preference. Please try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/chat");
  revalidatePath("/voice");
  return { ok: true, message: "Preferred language saved.", language };
}

