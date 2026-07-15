import { AppShell } from "@/frontend/components/AppShell";
import { VoiceTutor } from "@/frontend/components/VoiceTutor";
import { PageHeader } from "@/frontend/components/ui";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { supabaseSetupMessage } from "@/frontend/lib/supabase/errors";
import type { Conversation, ConversationMessage } from "@/frontend/lib/conversationTypes";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type VoicePageProps = {
  searchParams?: Promise<{
    conversationId?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VoicePage({ searchParams }: VoicePageProps) {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  if (!supabase || !user) {
    return (
      <AppShell>
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">
          Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
        </div>
      </AppShell>
    );
  }

  const resolvedSearchParams = await searchParams;
  const requestedConversationId = firstParam(resolvedSearchParams?.conversationId)?.trim() ?? "";
  let conversationError = "";
  let conversation: Conversation | null = null;
  let messages: ConversationMessage[] = [];

  const [filesResult, notesResult] = await Promise.all([
    supabase
      .from("files")
      .select("id, file_name, file_type, mime_type, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("notes")
      .select("id, title, topic, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (requestedConversationId) {
    if (!UUID_RE.test(requestedConversationId)) {
      conversationError = "That conversation link is invalid. Voice Tutor opened safely without it.";
    } else {
      const conversationResult = await supabase
        .from("conversations")
        .select("id, title, pinned, context_mode, active_file_ids, active_note_ids, created_at, updated_at")
        .eq("id", requestedConversationId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (conversationResult.error) {
        conversationError = supabaseSetupMessage(conversationResult.error.message);
      } else if (!conversationResult.data) {
        conversationError = "That conversation is unavailable or does not belong to this account. Voice Tutor opened safely without it.";
      } else {
        conversation = conversationResult.data;
        const messagesResult = await supabase
          .from("assistant_questions")
          .select("id, question, answer, related_file_ids, related_note_ids, conversation_id, created_at")
          .eq("user_id", user.id)
          .eq("conversation_id", requestedConversationId)
          .order("created_at", { ascending: true })
          .limit(100);

        if (messagesResult.error) {
          conversationError = supabaseSetupMessage(messagesResult.error.message);
        } else {
          messages = messagesResult.data ?? [];
        }
      }
    }
  }

  const recentFile = (filesResult.data ?? [])[0] ?? null;

  const setupError = filesResult.error || notesResult.error;

  // Pull the most recent file so explicit commands like "explain this file"
  // still have a default attachment. Normal questions do not inherit it.
  const selectedCommandFileId = Array.isArray(conversation?.active_file_ids) && conversation.active_file_ids.length > 0
    ? conversation.active_file_ids[0]
    : recentFile?.id ?? null;
  const selectedCommandFileName = selectedCommandFileId
    ? (filesResult.data ?? []).find((file) => file.id === selectedCommandFileId)?.file_name ?? recentFile?.file_name ?? null
    : null;

  return (
    <AppShell>
      <PageHeader
        title="Voice tutor"
        description="Ask questions or say a command hands-free. Voice input runs only in your browser when you tap Start listening, and answers can be read aloud in your chosen language."
      />

      {setupError ? (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">
          {supabaseSetupMessage(setupError.message)}
        </div>
      ) : (
        <VoiceTutor
          initialFileId={selectedCommandFileId}
          initialFileName={selectedCommandFileName}
          initialConversation={conversation}
          initialMessages={messages}
          initialConversationError={conversationError}
          files={filesResult.data ?? []}
          notes={notesResult.data ?? []}
        />
      )}
    </AppShell>
  );
}
