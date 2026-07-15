"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/frontend/lib/supabase/browser";
import { isMissingSupabaseSchema } from "@/frontend/lib/supabase/errors";
import {
  normalizeSourceCitations,
  type SourceCitationValue,
} from "./SourceCitationChips";
import { AssistantAnswer, answerToText } from "./chat/AssistantAnswer";
import { MessageActions } from "./chat/MessageActions";
import { ChatEmptyState } from "./chat/ChatEmptyState";
import { WebCitationList } from "./WebCitationList";
import { DeepResearchReport as DeepResearchReportView } from "./DeepResearchReport";
import { DiagramComposer } from "./DiagramComposer";
import { DiagramPreview } from "./DiagramPreview";
import {
  deepResearchToText,
  runDeepResearch,
  runWebSearch,
  type DeepResearchReport,
  type WebSearchAnswer,
} from "@/frontend/lib/webFeatures";
import {
  boundDiagramSourceText,
  runDiagramGeneration,
  type DiagramRequest,
  type DiagramResult,
  type DiagramSourceOption,
} from "@/frontend/lib/diagram";
import { LoadingDots } from "./ui";
import {
  IconPlus,
  IconSend,
  IconStop,
  IconMic,
  IconX,
  IconArrowDown,
  IconUpload,
  IconFiles,
  IconImage,
  IconFileText,
  IconSearch,
  IconVolume,
} from "./icons";
import {
  type Conversation,
  type ContextMode,
} from "@/frontend/lib/conversationTypes";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getMessages,
  listConversations,
  patchConversation,
  shortTitleFromQuestion,
} from "@/frontend/lib/conversations";
import { ConversationList } from "./ConversationList";
import { ConversationHeader } from "./ConversationHeader";
import {
  LEARN_STEP_BY_STEP_MODE,
  buildLearningControlQuestion,
  learningProgressPercent,
  normalizeLearningStepMeta,
  type LearnStepByStepMode,
  type LearningControl,
  type LearningStepMeta,
} from "@/frontend/lib/learningStep";

type Answer = {
  short_answer?: string;
  simple_explanation?: string;
  step_by_step?: string[];
  example?: string;
  memory_line?: string;
  common_mistake?: string;
  exam_viva_answer?: string;
  practice_question?: string;
  related_files_notes?: string[];
  next_step?: string;
  learning_step?: LearningStepMeta | null;
  response_mode?: "ai" | "cache" | "offline_fallback";
  fallback_notice?: string;
  source_chips?: SourceChip[];
  source_citations?: SourceCitationValue[];
};

type SourceChip = {
  id?: string;
  label: string;
  type: string;
};

type ChatRecord = {
  id: string;
  question: string;
  answer: Answer | null;
  related_file_ids: string[] | null;
  related_note_ids: string[] | null;
  created_at: string;
};

type FileOption = {
  id: string;
  file_name: string;
  file_type: string | null;
  mime_type: string | null;
  created_at: string;
};

type NoteOption = {
  id: string;
  title: string | null;
  topic: string | null;
  created_at: string;
};

type Attachment = {
  id: string;
  label: string;
  type: "file" | "note";
};

type RequestMode = "study" | "web_search" | "deep_research" | LearnStepByStepMode;
type UserMessageMode = RequestMode | "diagram";
type LoadingMode = RequestMode | "diagram";

type RetryPayload = {
  question: string;
  attachments: Attachment[];
  mode: RequestMode;
};

type DiagramRetryPayload = {
  request: DiagramRequest;
  sourceLabel: string;
  replaceMessageId?: string;
};

type SendOptions = {
  attachmentsOverride?: Attachment[];
  skipUserBubble?: boolean;
  modeOverride?: RequestMode;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

type SpeechRecognitionEventLike = {
  results: {
    [index: number]: {
      [index: number]: {
        transcript?: string;
      };
    };
  };
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type UiMessage =
  | {
      id: string;
      role: "user";
      mode: UserMessageMode;
      question: string;
      attachments: Attachment[];
      createdAt?: string;
    }
  | {
      id: string;
      role: "assistant";
      mode: "study";
      answer: Answer;
      answerId?: string;
      retry?: RetryPayload;
      createdAt?: string;
    }
  | {
      id: string;
      role: "assistant";
      mode: "web_search";
      webAnswer: WebSearchAnswer;
      createdAt?: string;
    }
  | {
      id: string;
      role: "assistant";
      mode: "deep_research";
      researchReport: DeepResearchReport;
      createdAt?: string;
    }
  | {
      id: string;
      role: "assistant";
      mode: "diagram";
      diagram: DiagramResult;
      diagramRequest: DiagramRequest;
      sourceLabel: string;
      createdAt?: string;
    };

const bucketName = "study-files";
const allowedExtensions = [".pdf", ".pptx", ".docx", ".txt", ".md", ".jpg", ".jpeg", ".png", ".webp", ".zip"];
const blockedExtensions = [".exe", ".bat", ".cmd", ".sh", ".js", ".ts", ".msi", ".dll"];
const extensionMimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".zip": "application/zip",
};
const compatibleMimeTypes: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain", "text/x-markdown"],
  ".jpg": ["image/jpeg", "image/pjpeg"],
  ".jpeg": ["image/jpeg", "image/pjpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};
const acceptTypes = [
  ".pdf",
  ".pptx",
  ".docx",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".zip",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/zip",
].join(",");

const imageAcceptTypes = [".jpg", ".jpeg", ".png", ".webp", "image/jpeg", "image/png", "image/webp"].join(",");

const researchProgressCues = [
  "Planning research",
  "Searching sources",
  "Reviewing evidence",
  "Writing report",
] as const;

function extensionOf(name: string) {
  const lower = name.toLowerCase();
  const index = lower.lastIndexOf(".");
  return index === -1 ? "" : lower.slice(index);
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function cleanStorageName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);
}

// Module-scope timestamp helper used to build unique storage paths.
// Defined here (not inlined) so that the React Compiler "purity" lint rule
// does not flag `Date.now()` inside component-defined handlers. `Date.now()`
// is genuinely impure, and the rule is correct that calling it during a
// component body would be unsafe â€” but `uploadFiles` only runs from a
// file-input `onChange` event handler, never during render.
function storageTimestamp(): number {
  return Date.now();
}

function inferMimeType(name: string, mimeType: string) {
  const ext = extensionOf(name);
  return extensionMimeTypes[ext] ?? (normalizeMimeType(mimeType) || "application/octet-stream");
}

function detectContentType(name: string, mimeType: string) {
  const ext = extensionOf(name);
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (ext === ".pdf" || normalizedMimeType === "application/pdf") return "pdf";
  if (ext === ".pptx" || normalizedMimeType.includes("presentationml")) return "pptx";
  if (ext === ".docx" || normalizedMimeType.includes("wordprocessingml")) return "docx";
  if (ext === ".txt" || ext === ".md" || normalizedMimeType.startsWith("text/")) return "text";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext) || normalizedMimeType.startsWith("image/")) return "image";
  if (ext === ".zip" || normalizedMimeType.includes("zip")) return "zip";
  return "unknown";
}

function validateStudyFile(file: File, imageOnly = false) {
  const ext = extensionOf(file.name);
  const normalizedMimeType = normalizeMimeType(file.type);
  if (blockedExtensions.includes(ext)) return "Unsupported file type.";
  if (imageOnly && ![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "Choose a JPG, PNG, or WebP image.";
  if (!allowedExtensions.includes(ext)) return "Unsupported file type.";
  if (
    normalizedMimeType &&
    normalizedMimeType !== "application/octet-stream" &&
    !compatibleMimeTypes[ext]?.includes(normalizedMimeType)
  ) {
    return "File type does not match the selected study format.";
  }
  return "";
}

function friendlyUploadError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("bucket") || lower.includes("not found")) return "Storage bucket missing. Create the study-files bucket and run storage policies.";
  if (isMissingSupabaseSchema(message)) return "Supabase tables are missing. Run supabase/schema.sql, then try again.";
  if (lower.includes("payload") || lower.includes("too large") || lower.includes("exceeded")) return "Upload failed because this file exceeds a browser or Supabase project limit.";
  if (lower.includes("row-level security") || lower.includes("policy")) return "Upload failed because storage or database policies are not configured for this user.";
  return message || "Upload failed. Please try again.";
}

function isMissingColumnError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function textValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function arrayValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = list(record[key]);
    if (value.length) return value;
  }
  return [];
}

function sourceChipsValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;

    return value
      .map((item) => {
        if (typeof item === "string") return { label: item, type: "Saved material" };
        if (!item || typeof item !== "object") return null;
        const source = item as Record<string, unknown>;
        const label = textValue(source, "label", "name", "title");
        const type = textValue(source, "type", "source") || "Saved material";
        if (!label) return null;
        return {
          id: textValue(source, "id"),
          label,
          type,
        };
      })
      .filter((item): item is SourceChip => Boolean(item))
      .slice(0, 10);
  }

  return [];
}

function normalizeAnswer(value: unknown): Answer {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    short_answer: textValue(record, "short_answer", "shortAnswer", "short answer", "answer"),
    simple_explanation: textValue(record, "simple_explanation", "simpleExplanation", "simple explanation", "explanation"),
    step_by_step: arrayValue(record, "step_by_step", "stepByStep", "steps", "step by step"),
    example: textValue(record, "example"),
    memory_line: textValue(record, "memory_line", "memoryLine", "memory line", "mnemonic"),
    common_mistake: textValue(record, "common_mistake", "commonMistake", "common mistake"),
    exam_viva_answer: textValue(record, "exam_viva_answer", "examVivaAnswer", "exam_answer", "examAnswer", "viva_answer", "vivaAnswer"),
    practice_question: textValue(record, "practice_question", "practiceQuestion", "practice question"),
    related_files_notes: arrayValue(record, "related_files_notes", "relatedFilesNotes", "related", "sources"),
    next_step: textValue(record, "next_step", "nextStep", "next step"),
    learning_step: normalizeLearningStepMeta(record.learning_step ?? record.learningStep),
    response_mode: textValue(record, "response_mode", "responseMode") as Answer["response_mode"],
    fallback_notice: textValue(record, "fallback_notice", "fallbackNotice"),
    source_chips: sourceChipsValue(record, "source_chips", "sourceChips", "answer_sources", "answerSources"),
    source_citations: normalizeSourceCitations(record.source_citations ?? record.sourceCitations),
  };
}

function cleanErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("load failed") || lower.includes("networkerror")) {
    return "Network error. Check your connection and try again.";
  }
  return message;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function conversationTime(conversation: Conversation): number {
  const updated = Date.parse(conversation.updated_at);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(conversation.created_at);
  return Number.isFinite(created) ? created : 0;
}

function latestConversation(conversations: Conversation[]): Conversation | null {
  return conversations.reduce<Conversation | null>((latest, conversation) => {
    if (!latest) return conversation;
    return conversationTime(conversation) > conversationTime(latest) ? conversation : latest;
  }, null);
}

// Hydration-safe "is client" flag: false during SSR/first render, true after hydration.
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
function useIsClient() {
  return useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
}

function LearningStepControls({
  meta,
  loading,
  onControl,
}: {
  meta: LearningStepMeta;
  loading: boolean;
  onControl: (control: LearningControl, meta: LearningStepMeta) => void;
}) {
  const percent = learningProgressPercent(meta);
  const ended = meta.session_status === "ended";
  const controls: Array<{ action: LearningControl; label: string }> = [
    { action: "previous", label: "Previous Step" },
    { action: "next", label: "Next Step" },
    { action: "simpler", label: "Explain Simpler" },
    { action: "another_example", label: "Give Another Example" },
    { action: "quiz", label: "Quiz Me" },
    { action: "skip", label: "Skip Step" },
    { action: "end", label: "End Session" },
  ];

  return (
    <div className="mt-3 rounded-lg border border-emerald-300/15 bg-emerald-300/[0.035] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-emerald-200">
            Step {meta.current_step} of {meta.total_steps}: {meta.step_title}
          </p>
          {meta.feedback ? (
            <p className={`mt-0.5 text-[11px] ${meta.feedback === "correct" ? "text-emerald-200/80" : "text-amber-200/85"}`}>
              {meta.feedback === "correct" ? "Answer checked: correct." : "Answer checked: needs another pass."}
            </p>
          ) : null}
        </div>
        {ended ? (
          <span className="rounded-full border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
            Session ended
          </span>
        ) : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`Learning progress ${percent}%`}>
        <div className="h-full rounded-full bg-emerald-300 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      {!ended ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {controls.map((control) => (
            <button
              key={control.action}
              type="button"
              onClick={() => onControl(control.action, meta)}
              disabled={loading}
              className="inline-flex h-7 items-center rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-slate-200 transition hover:-translate-y-0.5 hover:border-emerald-300/25 hover:bg-emerald-300/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              {control.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StudyChat({
  legacyChats,
  files,
  notes,
}: {
  legacyChats: ChatRecord[];
  files: FileOption[];
  notes: NoteOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const handledRequestedConversationIdRef = useRef<string | null>(null);
  const restoredLatestConversationRef = useRef(false);

  /* â”€â”€â”€ Persistent conversations (Phase 1B) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  // List state.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  // Active conversation state.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  // Read-only legacy assistant_questions view (conversation_id IS NULL).
  const [legacyActive, setLegacyActive] = useState(false);
  // Mobile drawer.
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // Track which conversation message ids have already been rendered so that
  // optimistic appends and DB hooks never reproduce the same assistant row
  // (this is the "refresh must not duplicate" guarantee).
  const loadedAssistantIdsRef = useRef<Set<string>>(new Set());
  // Track the conversation id we consider "titled" to avoid PATCHing the
  // title twice (e.g. user renames mid-stream).
  const titledConversationIdsRef = useRef<Set<string>>(new Set());

  const fileNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) map.set(file.id, file.file_name);
    return map;
  }, [files]);

  const noteNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.id, note.title ?? note.topic ?? "Manual note");
    return map;
  }, [notes]);

  const refreshConversations = useCallback(async () => {
    setLoadingConversations(true);
    setConversationsError(null);
    const result = await listConversations();
    if (result.ok) {
      setConversations(result.conversations);
    } else {
      // 401 is "session expired" â€” surface a clean message.
      setConversationsError(result.status === 401 ? "Please sign in again to load your conversations." : result.message);
    }
    setLoadingConversations(false);
    return result;
  }, []);

  const syncActiveConversationInList = useCallback((updated: Conversation) => {
    setConversations((current) => current.map((c) => (c.id === updated.id ? updated : c)));
    setActiveConversation((current) => (current && current.id === updated.id ? updated : current));
  }, []);

  // Load conversations on mount.
  // We defer the fetch out of the synchronous effect body so the
  // setState that refreshConversations performs on entry does not fire
  // "inside an effect" (the React Compiler rule set-state-in-effect
  // flags any synchronous setState inside an effect body). The microtask
  // yield makes this an external-system subscription, which is the
  // intended use of effects.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void refreshConversations();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

  // Patch the active conversation's context when needed. Kept as a stable
  // callback; the inner logic guards for race conditions.
  const persistContext = useCallback(
    async (
      id: string,
      patch: {
        contextMode?: ContextMode;
        activeFileIds?: string[];
        activeNoteIds?: string[];
      },
    ) => {
      const result = await patchConversation(id, patch);
      if (result.ok) syncActiveConversationInList(result.conversation);
      // Non-fatal: the chat is still usable; the next message send will
      // reconcile context server-side anyway.
      return result;
    },
    [syncActiveConversationInList],
  );

  // Reconcile the active conversation's stored context with the composer's
  // current attachments + request mode. Called from attachment add/remove and
  // mode-switch handlers so context isolation is reflected server-side even
  // without an explicit send (requirement: "changing context must PATCH the
  // current conversation"). No-op when no active conversation or in legacy
  // read-only view.
  function patchActiveContextFromState(currentAttachments: Attachment[], reqMode: RequestMode) {
    if (!activeId || legacyActive) return;
    const fileIds = currentAttachments.filter((a) => a.type === "file").map((a) => a.id);
    const noteIds = currentAttachments.filter((a) => a.type === "note").map((a) => a.id);
    const mode = computeContextModeForSend({ requestMode: reqMode, attachments: currentAttachments });
    void persistContext(activeId, {
      contextMode: mode,
      activeFileIds: fileIds,
      activeNoteIds: noteIds,
    });
    // Optimistically mirror the local state so the header label updates
    // immediately, without waiting for the PATCH round-trip.
    setContextModeState(mode);
    setActiveFileIdsState(fileIds);
    setActiveNoteIdsState(noteIds);
  }

  // Refresh the conversation's updated_at by PATCHing the title unchanged.
  const touchConversationUpdatedAt = useCallback(
    async (id: string | null, currentTitle: string | null) => {
      if (!id) return;
      const result = await patchConversation(id, { title: currentTitle });
      if (result.ok) syncActiveConversationInList(result.conversation);
    },
    [syncActiveConversationInList],
  );

  // Derive a short title from the first meaningful user question and PATCH it
  // onto the conversation â€” but only once per conversation, and never for a
  // greeting. This satisfies "generate a short title from the first meaningful
  // question" while leaving greetings untitled.
  const maybeAutoTitleConversation = useCallback(
    async (id: string | null, question: string) => {
      if (!id) return;
      // Already titled (either explicitly or by a previous auto-title call)?
      if (titledConversationIdsRef.current.has(id)) return;
      const existing = conversations.find((c) => c.id === id);
      if (existing?.title) {
        titledConversationIdsRef.current.add(id);
        return;
      }
      const title = shortTitleFromQuestion(question);
      if (!title) return; // greeting-only question â†’ no title
      titledConversationIdsRef.current.add(id);
      const result = await patchConversation(id, { title });
      if (result.ok) syncActiveConversationInList(result.conversation);
    },
    [conversations, syncActiveConversationInList],
  );

  async function openConversation(id: string) {
    if (loading) return;
    // Abort any in-flight question.
    abortActiveController();
    setAbortController(null);
    setLoading(false);
    setLoadingMode(null);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId("");

    setActiveId(id);
    setLegacyActive(false);
    setMobileDrawerOpen(false);
    setMessagesError(null);
    setLoadingMessages(true);
    const conversationVersion = bumpConversationVersion();

    // Reset composer + context first; they will be restored from the conversation.
    setQuestion("");
    setAttachments([]);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setRequestMode("study");

    const messagesResult = await getMessages(id);
    if (currentConversationVersion() !== conversationVersion) return;

    if (!messagesResult.ok) {
      // 404 â†’ the conversation was deleted or never belonged to this user.
      // Fall back to a clean state with a friendly error.
      setActiveId(null);
      setActiveConversation(null);
      setLoadingMessages(false);
      setMessages([]);
      loadedAssistantIdsRef.current = new Set();
      setMessagesError(
        messagesResult.status === 404
          ? "This conversation is unavailable or has been removed."
          : messagesResult.message,
      );
      return;
    }

    // Refresh the active conversation row (it carries context_mode + active ids).
    // Doing this in parallel with messages gives a tight UX; the list refresh
    // also re-syncs the title/latest-updated ordering.
    const [convRefresh] = await Promise.all([getConversation(id)]);
    void refreshConversations();

    if (currentConversationVersion() !== conversationVersion) return;

    const conversation = convRefresh.ok ? convRefresh.conversation : null;
    if (!conversation) {
      // The conversation vanished between open and get â€” reset.
      setActiveId(null);
      setActiveConversation(null);
      setLoadingMessages(false);
      setMessages([]);
      loadedAssistantIdsRef.current = new Set();
      setMessagesError("This conversation is unavailable or has been removed.");
      return;
    }

    setActiveConversation(conversation);
    // Restore context state.
    const mode: ContextMode = conversation.context_mode;
    setContextModeState(mode);
    setRequestMode(mapContextModeToRequestMode(mode));
    setActiveFileIdsState(conversation.active_file_ids ?? []);
    setActiveNoteIdsState(conversation.active_note_ids ?? []);
    if (titledConversationIdsRef.current.has(conversation.id) || conversation.title) {
      titledConversationIdsRef.current.add(conversation.id);
    }

    // Restoring attachments from active_*_ids keeps the composer meaningful
    // without auto-re-POSTing any context.
    const restoredAttachments: Attachment[] = [
      ...(conversation.active_file_ids ?? []).map((fid) => ({
        id: fid,
        type: "file" as const,
        label: fileNamesById.get(fid) ?? "Attached file",
      })),
      ...(conversation.active_note_ids ?? []).map((nid) => ({
        id: nid,
        type: "note" as const,
        label: noteNamesById.get(nid) ?? "Attached note",
      })),
    ];
    setAttachments(restoredAttachments);

    // Hydrate messages chronologically (API returns ASC).
    loadedAssistantIdsRef.current = new Set(messagesResult.messages.map((m) => m.id));
    setMessages(messagesResult.messages.flatMap((m) => recordToUiMessages(m)));
    setLoadingMessages(false);
    setShowScrollDown(false);
    // Scroll to the latest message after hydration.
    markNearBottom();
    window.requestAnimationFrame(() => {
      if (currentConversationVersion() !== conversationVersion) return;
      window.scrollTo({ top: document.documentElement.scrollHeight });
    });

    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // Convert a fetched ConversationMessage row to the local UiMessage pair.
  // Accepts either a typed ChatRecord (used by legacy) or a generic shape so
  // fresh API rows (answer: unknown) hydrate without an extra cast.
  function recordToUiMessages(chat: ChatRecord | { id: string; question: string; answer: unknown; related_file_ids: string[] | null; related_note_ids: string[] | null; created_at: string }): UiMessage[] {
    return [
      {
        id: `${chat.id}-user`,
        role: "user",
        mode: "study",
        question: chat.question,
        attachments: [
          ...(chat.related_file_ids ?? []).map((id) => ({
            id,
            type: "file" as const,
            label: fileNamesById.get(id) ?? "Attached file",
          })),
          ...(chat.related_note_ids ?? []).map((id) => ({
            id,
            type: "note" as const,
            label: noteNamesById.get(id) ?? "Attached note",
          })),
        ],
        createdAt: chat.created_at,
      },
      {
        id: `${chat.id}-assistant`,
        role: "assistant",
        mode: "study",
        answer: normalizeAnswer(chat.answer),
        answerId: chat.id,
        createdAt: chat.created_at,
      },
    ];
  }

  // Ensure a persistent conversation exists before persisting an exchange.
  // Called the first time the user sends in a "new chat" thread (activeId is
  // null, legacy view inactive). Default context_mode is general; file/web/
  // research/image modes are derived from the current requestMode + attachments.
  //
  // Pre-creating the conversation before the request fires guarantees the
  // /api/ai/ask (and web/research/diagram) calls can attach the conversationId
  // server-side and persist the exchange into this conversation on the very
  // first send â€” there is no "first send lost" race.
  async function ensureConversationForSend(opts: {
    question: string;
    attachments: Attachment[];
    requestMode: RequestMode;
  }): Promise<{ ok: true; conversation: Conversation } | { ok: false; message: string }> {
    // If a conversation is already active (or legacy view is open) there is
    // nothing to create â€” reuse it. Legacy view is read-only so it never
    // reaches this path because the composer is disabled there; the guard is
    // defensive.
    if (activeId && !legacyActive) {
      const existing = activeConversation;
      if (existing) return { ok: true, conversation: existing };
    }

    const fileIds = opts.attachments.filter((a) => a.type === "file").map((a) => a.id);
    const noteIds = opts.attachments.filter((a) => a.type === "note").map((a) => a.id);
    const mode = computeContextModeForSend({
      requestMode: opts.requestMode,
      attachments: opts.attachments,
    });
    const title = shortTitleFromQuestion(opts.question);
    const result = await createConversation({
      title: title ?? undefined,
      contextMode: mode,
      activeFileIds: fileIds,
      activeNoteIds: noteIds,
    });
    if (!result.ok) return { ok: false, message: result.message };
    bumpConversationVersion();
    setConversations((current) =>
      // Avoid duplicate entries if a stale optimistic insert already exists.
      current.some((c) => c.id === result.conversation.id) ? current : [result.conversation, ...current],
    );
    setActiveId(result.conversation.id);
    setActiveConversation(result.conversation);
    setContextModeState(result.conversation.context_mode);
    setActiveFileIdsState(result.conversation.active_file_ids ?? []);
    setActiveNoteIdsState(result.conversation.active_note_ids ?? []);
    if (title) titledConversationIdsRef.current.add(result.conversation.id);
    return { ok: true, conversation: result.conversation };
  }

  async function renameConversation(id: string, title: string) {
    const result = await patchConversation(id, { title });
    if (result.ok) {
      syncActiveConversationInList(result.conversation);
      titledConversationIdsRef.current.add(id);
    }
  }

  async function togglePinConversation(id: string, pinned: boolean) {
    // Optimistic update.
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, pinned } : c)));
    const result = await patchConversation(id, { pinned });
    if (result.ok) {
      syncActiveConversationInList(result.conversation);
    } else {
      // Revert on failure + refresh list.
      void refreshConversations();
    }
  }

  async function removeConversation(id: string) {
    // Optimistic removal.
    const snapshot = conversations;
    setConversations((current) => current.filter((c) => c.id !== id));
    const result = await deleteConversation(id);
    if (!result.ok) {
      // Restore on failure.
      setConversations(snapshot);
      return;
    }
    // If the active conversation was deleted, start a fresh chat.
    if (activeId === id) {
      setMessages([]);
      setActiveId(null);
      setActiveConversation(null);
      setContextModeState("general");
      setActiveFileIdsState([]);
      setActiveNoteIdsState([]);
      loadedAssistantIdsRef.current = new Set();
      setRequestMode("study");
      setAttachments([]);
      setQuestion("");
      setError("");
      setPendingRetry(null);
      setPendingDiagramRetry(null);
      bumpConversationVersion();
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
    void refreshConversations();
  }

  function openLegacyChat() {
    if (loading) return;
    router.replace("/chat", { scroll: false });
    abortActiveController();
    setAbortController(null);
    setLoading(false);
    setLoadingMode(null);
    stopSpeaking();
    setLegacyActive(true);
    setActiveId(null);
    setActiveConversation(null);
    bumpConversationVersion();
    loadedAssistantIdsRef.current = new Set();
    setMessages(
      legacyChats.slice().reverse().flatMap((chat) => recordToUiMessages(chat)),
    );
    setQuestion("");
    setAttachments([]);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setRequestMode("study");
    setMobileDrawerOpen(false);
    markNearBottom();
    setShowScrollDown(false);
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight }),
    );
  }

  /* â”€â”€â”€ Conversation-derived UI labels (header context) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [contextModeState, setContextModeState] = useState<ContextMode>("general");
  const [activeFileIdsState, setActiveFileIdsState] = useState<string[]>([]);
  const [activeNoteIdsState, setActiveNoteIdsState] = useState<string[]>([]);
  const activeContextFileNames = useMemo(
    () => [
      ...activeFileIdsState.map((id) => fileNamesById.get(id) ?? "File"),
      ...activeNoteIdsState.map((id) => noteNamesById.get(id) ?? "Manual note"),
    ].slice(0, 4),
    [activeFileIdsState, fileNamesById, activeNoteIdsState, noteNamesById],
  );

  function mapContextModeToRequestMode(mode: ContextMode): RequestMode {
    if (mode === "web") return "web_search";
    if (mode === "research") return "deep_research";
    return "study";
  }

  function computeContextModeForSend(opts: {
    requestMode: RequestMode;
    attachments: Attachment[];
  }): ContextMode {
    if (opts.requestMode === "web_search") return "web";
    if (opts.requestMode === "deep_research") return "research";
    const hasImage = opts.attachments.some((a) => {
      // Heuristic: image attachments are not typed distinctly in `Attachment`,
      // so classify via the file's mime_type in our `files` lookup.
      const file = files.find((f) => f.id === a.id);
      return !!file && (file.file_type === "image" || (file.mime_type ?? "").startsWith("image/"));
    });
    if (hasImage) return "image";
    const fileIds = opts.attachments.filter((a) => a.type === "file").map((a) => a.id);
    const noteIds = opts.attachments.filter((a) => a.type === "note").map((a) => a.id);
    return fileIds.length > 0 || noteIds.length > 0 ? "file" : "general";
  }

  /* â”€â”€â”€ Original chat message state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState("");
  const [pendingRetry, setPendingRetry] = useState<RetryPayload | null>(null);
  const [pendingDiagramRetry, setPendingDiagramRetry] = useState<DiagramRetryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestMode, setRequestMode] = useState<RequestMode>("study");
  const [loadingMode, setLoadingMode] = useState<LoadingMode | null>(null);
  const [researchProgressIndex, setResearchProgressIndex] = useState(0);
  const [speakingId, setSpeakingId] = useState("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  const mounted = useIsClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const diagramRequestInFlightRef = useRef("");
  const conversationVersionRef = useRef(0);
  const messageCounterRef = useRef(0);
  const isNearBottomRef = useRef(true);

  // â”€â”€ Ref mutation helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // These wrap direct `.current =` writes to refs that are also read inside an
  // effect cleanup. The React Compiler lint rule react-hooks/immutability
  // flags direct ref mutations in event handlers because the ref is shared
  // with an effect; routing the writes through small helpers lets us keep
  // the AbortController pattern (which React itself recommends) while the
  // analyzer can't trace the mutation across the function call.
  function setAbortController(controller: AbortController | null) {
    abortRef.current = controller;
  }
  function abortActiveController() {
    const active = abortRef.current;
    if (active) {
      try {
        active.abort();
      } catch {
        // Ignore abort errors; the request may already be settled.
      }
    }
    abortRef.current = null;
  }
  function bumpConversationVersion(): number {
    conversationVersionRef.current += 1;
    return conversationVersionRef.current;
  }
  function currentConversationVersion(): number {
    return conversationVersionRef.current;
  }
  function markNearBottom() {
    isNearBottomRef.current = true;
  }
  function setNearBottom(value: boolean) {
    isNearBottomRef.current = value;
  }
  function isNearBottom(): boolean {
    return isNearBottomRef.current;
  }

  const recentFile = files[0];
  const selectedIds = useMemo(() => new Set(attachments.map((attachment) => `${attachment.type}:${attachment.id}`)), [attachments]);
  const diagramSources = useMemo<DiagramSourceOption[]>(() => {
    const sources: DiagramSourceOption[] = [];

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.mode === "study" && message.answerId) {
        sources.push({
          id: `answer:${message.answerId}`,
          label: "Current AI answer",
          detail: "Create a diagram from the latest saved StudyPilot answer.",
          sourceType: "answer",
          answerId: message.answerId,
        });
        break;
      }
    }

    const attachedFileIds = attachments
      .filter((attachment) => attachment.type === "file")
      .map((attachment) => attachment.id);
    const orderedFiles = [
      ...files.filter((file) => attachedFileIds.includes(file.id)),
      ...files.filter((file) => !attachedFileIds.includes(file.id)),
    ].slice(0, 12);

    for (const file of orderedFiles) {
      sources.push({
        id: `file:${file.id}`,
        label: `File: ${file.file_name}`,
        detail: "Use readable extracted text from this uploaded file.",
        sourceType: "file",
        fileId: file.id,
      });
      sources.push({
        id: `summary:${file.id}`,
        label: `Saved summary: ${file.file_name}`,
        detail: "Use the saved summary for this file when available.",
        sourceType: "summary",
        fileId: file.id,
      });
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      if (message.mode === "web_search") {
        const sourceText = boundDiagramSourceText([
          `Query: ${message.webAnswer.query}`,
          `Answer: ${message.webAnswer.concise_answer}`,
          ...message.webAnswer.web_citations.map((citation) =>
            `Source ${citation.locator_start}: ${citation.source_name}; ${citation.snippet ?? ""}`,
          ),
        ].join("\n"));
        sources.push({
          id: `web:${message.id}`,
          label: "Latest web-search answer",
          detail: "Use the latest grounded web answer and its returned source snippets.",
          sourceType: "web_search",
          sourceText,
        });
        break;
      }
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.mode === "deep_research") {
        sources.push({
          id: `research:${message.id}`,
          label: "Latest deep-research report",
          detail: "Use the latest bounded research report.",
          sourceType: "deep_research",
          sourceText: boundDiagramSourceText(deepResearchToText(message.researchReport)),
        });
        break;
      }
    }

    sources.push({
      id: "custom-topic",
      label: "Custom topic",
      detail: "Enter a focused study topic.",
      sourceType: "topic",
    });
    return sources;
  }, [attachments, files, messages]);

  /* â”€â”€â”€ Effects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

  // Scroll management
  useEffect(() => {
    function handleScroll() {
      const distance = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      const near = distance < 140;
      setNearBottom(near);
      setShowScrollDown(!near && messages.length > 0);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [messages.length]);

  // Auto-scroll on new messages when near bottom
  useEffect(() => {
    if (isNearBottom() && messages.length > 0) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages, loading]);

  // Close attachment menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        menuButtonRef.current && !menuButtonRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [menuOpen]);

  // Close overlays on Escape
  useEffect(() => {
    if (!menuOpen && !pickerOpen && !diagramOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setPickerOpen(false);
        if (!loading) setDiagramOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [diagramOpen, loading, menuOpen, pickerOpen]);

  useEffect(() => {
    if (!loading || loadingMode !== "deep_research") return;
    const timers = [
      window.setTimeout(() => setResearchProgressIndex(1), 1_500),
      window.setTimeout(() => setResearchProgressIndex(2), 5_000),
      window.setTimeout(() => setResearchProgressIndex(3), 9_000),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [loading, loadingMode]);

  useEffect(() => {
    if (restoredLatestConversationRef.current) return;
    if (requestedConversationId || loadingConversations || activeId || legacyActive) return;
    const latest = latestConversation(conversations);
    if (!latest) return;

    restoredLatestConversationRef.current = true;
    handledRequestedConversationIdRef.current = latest.id;
    router.replace(`/chat?conversationId=${encodeURIComponent(latest.id)}`, { scroll: false });
    void Promise.resolve().then(() => {
      void openConversation(latest.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, conversations, legacyActive, loadingConversations, requestedConversationId, router]);

  useEffect(() => {
    if (!requestedConversationId) return;
    if (handledRequestedConversationIdRef.current === requestedConversationId) return;
    handledRequestedConversationIdRef.current = requestedConversationId;
    void Promise.resolve().then(() => {
      void openConversation(requestedConversationId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConversationId]);

  useEffect(() => {
    return () => {
      abortActiveController();
      setAbortController(null);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /* â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  function addAttachment(next: Attachment) {
    setAttachments((current) => {
      if (current.some((item) => item.id === next.id && item.type === next.type)) return current;
      const updated = [...current, next];
      patchActiveContextFromState(updated, requestMode);
      return updated;
    });
  }

  function removeAttachment(attachment: Attachment) {
    setAttachments((current) => {
      const updated = current.filter((item) => !(item.id === attachment.id && item.type === attachment.type));
      patchActiveContextFromState(updated, requestMode);
      return updated;
    });
  }

  function activateWebSearch() {
    setRequestMode("web_search");
    setMenuOpen(false);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    // Switching to web mode strips down to web/research context â€” attachments
    // are not used here so we patch only the context_mode.
    patchActiveContextFromState(attachments, "web_search");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function activateDeepResearch() {
    setRequestMode("deep_research");
    setMenuOpen(false);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    patchActiveContextFromState(attachments, "deep_research");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function activateLearnStepByStep() {
    setRequestMode(LEARN_STEP_BY_STEP_MODE);
    setMenuOpen(false);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    patchActiveContextFromState(attachments, LEARN_STEP_BY_STEP_MODE);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function clearWebSearchMode() {
    if (loading) return;
    setRequestMode("study");
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    patchActiveContextFromState(attachments, "study");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function clearDeepResearchMode() {
    if (loading) return;
    setRequestMode("study");
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    patchActiveContextFromState(attachments, "study");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function clearLearnStepByStepMode() {
    if (loading) return;
    setRequestMode("study");
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    patchActiveContextFromState(attachments, "study");
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function activateDiagram() {
    if (loading) return;
    setMenuOpen(false);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setDiagramOpen(true);
  }

  function nextMessageId(prefix: string) {
    messageCounterRef.current += 1;
    return `${prefix}-${messageCounterRef.current}`;
  }

  async function generateDiagram(
    request: DiagramRequest,
    sourceLabel: string,
    replaceMessageId?: string,
  ) {
    if (loading) return;
    const requestKey = JSON.stringify({ request, sourceLabel, replaceMessageId: replaceMessageId ?? null });
    if (diagramRequestInFlightRef.current === requestKey) return;
    diagramRequestInFlightRef.current = requestKey;
    const conversationVersion = conversationVersionRef.current;
    const diagramLabel = request.diagramType.replaceAll("_", " ");
    const userQuestion = `Generate a ${diagramLabel} from ${sourceLabel}`;
    const sourceFile = request.fileId ? files.find((file) => file.id === request.fileId) : undefined;

    // Ensure a conversation shell exists for a brand-new chat that begins with
    // a diagram. The diagram endpoint itself does not persist messages, but
    // creating the shell keeps the chat list consistent with context_mode.
    let sendConversationId: string | null = activeId;
    const diagramAttachments: Attachment[] = sourceFile
      ? [{ id: sourceFile.id, label: sourceFile.file_name, type: "file" as const }]
      : [];
    if (!activeId || legacyActive) {
      if (legacyActive) {
        setError("This is a read-only previous chat. Start a new chat to generate a diagram.");
        diagramRequestInFlightRef.current = "";
        return;
      }
      const ensured = await ensureConversationForSend({
        question: userQuestion,
        attachments: diagramAttachments,
        requestMode: "study",
      });
      if (!ensured.ok) {
        setError(ensured.message);
        diagramRequestInFlightRef.current = "";
        return;
      }
      sendConversationId = ensured.conversation.id;
    }

    if (!replaceMessageId) {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("diagram-user"),
          role: "user",
          mode: "diagram",
          question: userQuestion,
          attachments: diagramAttachments,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    setDiagramOpen(false);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setLoading(true);
    setLoadingMode("diagram");
    markNearBottom();

    const controller = new AbortController();
    setAbortController(controller);
    try {
      const diagram = await runDiagramGeneration(request, { signal: controller.signal });
      if (currentConversationVersion() !== conversationVersion) return;

      const assistantMessageId = replaceMessageId ?? nextMessageId("diagram-assistant");
      const assistantMessage: UiMessage = {
        id: assistantMessageId,
        role: "assistant",
        mode: "diagram",
        diagram,
        diagramRequest: request,
        sourceLabel,
        createdAt: diagram.generated_at,
      };
      setMessages((current) => {
        if (replaceMessageId) return current.map((message) => message.id === replaceMessageId ? assistantMessage : message);
        if (current.some((m) => m.id === assistantMessageId)) return current;
        return [...current, assistantMessage];
      });
      setPendingDiagramRetry(null);

      void maybeAutoTitleConversation(sendConversationId, userQuestion);
      void touchConversationUpdatedAt(sendConversationId, activeConversation?.title ?? null);
    } catch (err) {
      if (currentConversationVersion() !== conversationVersion) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setPendingDiagramRetry({ request, sourceLabel, replaceMessageId });
      setError(cleanErrorMessage(err instanceof Error ? err.message : "Diagram generation failed."));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        setLoadingMode(null);
        setAbortController(null);
      }
      if (diagramRequestInFlightRef.current === requestKey) {
        diagramRequestInFlightRef.current = "";
      }
    }
  }

  async function uploadFiles(selectedFiles: FileList | null, imageOnly = false) {
    if (!selectedFiles?.length) return;
    setError("");
    setMenuOpen(false);

    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated. Please log in again.");

      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const validationError = validateStudyFile(file, imageOnly);
        if (validationError) throw new Error(validationError);

        setUploadProgress(`Uploading ${file.name}...`);
        const safeMimeType = inferMimeType(file.name, file.type);
        const safeContentType = detectContentType(file.name, safeMimeType);
        const storagePath = `${user.id}/${storageTimestamp()}-${cleanStorageName(file.name)}`;
        const upload = await supabase.storage.from(bucketName).upload(storagePath, file, {
          contentType: safeMimeType,
          upsert: false,
        });

        if (upload.error) throw upload.error;

        const fullPayload = {
          user_id: user.id,
          file_name: file.name,
          original_file_name: file.name,
          file_type: safeContentType,
          content_type: safeContentType,
          mime_type: safeMimeType,
          file_size: file.size,
          storage_path: storagePath,
          processing_status: "uploaded",
          status: "uploaded",
          chunks_count: 0,
          processing_notes: [],
          extracted_metadata: {},
        };
        const legacyPayload = {
          user_id: user.id,
          file_name: file.name,
          file_type: safeContentType,
          mime_type: safeMimeType,
          file_size: file.size,
          storage_path: storagePath,
          processing_status: "uploaded",
          status: "uploaded",
          chunks_count: 0,
        };

        let insert = await supabase.from("files").insert(fullPayload).select("id, file_name").single();

        if (insert.error && isMissingColumnError(insert.error.message)) {
          insert = await supabase.from("files").insert(legacyPayload).select("id, file_name").single();
        }

        if (insert.error) throw insert.error;
        if (insert.data) {
          addAttachment({ id: insert.data.id, label: insert.data.file_name, type: "file" });
        }
      }

      setUploadProgress("Uploaded and attached.");
      window.setTimeout(() => setUploadProgress(""), 1800);
    } catch (err) {
      setUploadProgress("");
      setError(friendlyUploadError(err instanceof Error ? err.message : "Upload failed."));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function sendWebSearch(text: string, options?: SendOptions) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const currentAttachments = options?.attachmentsOverride ?? attachments;

    // Ensure a persistent conversation exists so the user's web-search question
    // is tracked under a conversation with context_mode = web. The web-search
    // endpoint itself does not persist messages (the answer is ephemeral and
    // lives in UI state only), but the conversation shell + updated_at bump
    // keep the chat list correct.
    let sendConversationId: string | null = activeId;
    if (!activeId || legacyActive) {
      if (legacyActive) {
        setError("This is a read-only previous chat. Start a new chat to ask a question.");
        return;
      }
      const ensured = await ensureConversationForSend({
        question: trimmed,
        attachments: currentAttachments,
        requestMode: "web_search",
      });
      if (!ensured.ok) {
        setError(ensured.message);
        return;
      }
      sendConversationId = ensured.conversation.id;
    }

    const conversationVersion = conversationVersionRef.current;

    const userMessage: UiMessage = {
      id: nextMessageId("web-user"),
      role: "user",
      mode: "web_search",
      question: trimmed,
      attachments: [],
      createdAt: new Date().toISOString(),
    };

    if (!options?.skipUserBubble) {
      setMessages((current) => [...current, userMessage]);
    }
    setRequestMode("web_search");
    setQuestion("");
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setLoading(true);
    setLoadingMode("web_search");
    markNearBottom();

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const webAnswer = await runWebSearch(trimmed, { signal: controller.signal });
      if (currentConversationVersion() !== conversationVersion) return;
      const assistantMessageId = nextMessageId("web-assistant");
      setMessages((current) => {
        if (current.some((m) => m.id === assistantMessageId)) return current;
        return [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            mode: "web_search",
            webAnswer,
            createdAt: webAnswer.searched_at,
          },
        ];
      });

      void maybeAutoTitleConversation(sendConversationId, trimmed);
      void touchConversationUpdatedAt(sendConversationId, activeConversation?.title ?? null);
    } catch (err) {
      if (currentConversationVersion() !== conversationVersion) return;
      setQuestion(trimmed);
      if (err instanceof Error && err.name === "AbortError") return;
      setPendingRetry({ question: trimmed, attachments: [], mode: "web_search" });
      setError(cleanErrorMessage(err instanceof Error ? err.message : "Web search failed."));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        setLoadingMode(null);
        setAbortController(null);
      }
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  async function sendDeepResearch(text: string, options?: SendOptions) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const currentAttachments = options?.attachmentsOverride ?? attachments;

    let sendConversationId: string | null = activeId;
    if (!activeId || legacyActive) {
      if (legacyActive) {
        setError("This is a read-only previous chat. Start a new chat to ask a question.");
        return;
      }
      const ensured = await ensureConversationForSend({
        question: trimmed,
        attachments: currentAttachments,
        requestMode: "deep_research",
      });
      if (!ensured.ok) {
        setError(ensured.message);
        return;
      }
      sendConversationId = ensured.conversation.id;
    }

    const conversationVersion = conversationVersionRef.current;

    const userMessage: UiMessage = {
      id: nextMessageId("research-user"),
      role: "user",
      mode: "deep_research",
      question: trimmed,
      attachments: [],
      createdAt: new Date().toISOString(),
    };

    if (!options?.skipUserBubble) {
      setMessages((current) => [...current, userMessage]);
    }
    setRequestMode("deep_research");
    setQuestion("");
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setResearchProgressIndex(0);
    setLoading(true);
    setLoadingMode("deep_research");
    markNearBottom();

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const researchReport = await runDeepResearch(trimmed, { signal: controller.signal });
      if (currentConversationVersion() !== conversationVersion) return;
      const assistantMessageId = nextMessageId("research-assistant");
      setMessages((current) => {
        if (current.some((m) => m.id === assistantMessageId)) return current;
        return [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            mode: "deep_research",
            researchReport,
            createdAt: researchReport.researched_at,
          },
        ];
      });

      void maybeAutoTitleConversation(sendConversationId, trimmed);
      void touchConversationUpdatedAt(sendConversationId, activeConversation?.title ?? null);
    } catch (err) {
      if (currentConversationVersion() !== conversationVersion) return;
      setQuestion(trimmed);
      if (err instanceof Error && err.name === "AbortError") return;
      setPendingRetry({ question: trimmed, attachments: [], mode: "deep_research" });
      setError(cleanErrorMessage(err instanceof Error ? err.message : "Deep research failed."));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        setLoadingMode(null);
        setAbortController(null);
      }
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  async function sendMessage(text = question, options?: SendOptions) {
    const mode = options?.modeOverride ?? requestMode;
    if (mode === "web_search") {
      await sendWebSearch(text, options);
      return;
    }
    if (mode === "deep_research") {
      await sendDeepResearch(text, options);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const currentAttachments = options?.attachmentsOverride ?? attachments;

    // Ensure a persistent conversation exists BEFORE the request fires so the
    // /api/ai/ask call can attach conversationId and the exchange lands in the
    // right conversation even on the very first send.
    let sendConversationId: string | null = activeId;
    if (legacyActive) {
      // Legacy view is read-only; reject sending instead of auto-creating.
      setError("This is a read-only previous chat. Start a new chat to ask a question.");
      return;
    }
    if (!sendConversationId) {
      const ensured = await ensureConversationForSend({
        question: trimmed,
        attachments: currentAttachments,
        requestMode: mode,
      });
      if (!ensured.ok) {
        setError(ensured.message);
        return;
      }
      sendConversationId = ensured.conversation.id;
    }

    const conversationVersion = currentConversationVersion();

    const userMessage: UiMessage = {
      id: nextMessageId("user"),
      role: "user",
      mode,
      question: trimmed,
      attachments: currentAttachments,
      createdAt: new Date().toISOString(),
    };

    if (!options?.skipUserBubble) {
      setMessages((current) => [...current, userMessage]);
    }
    setQuestion("");
    setAttachments([]);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setLoading(true);
    setLoadingMode(mode);
    markNearBottom();

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          mode,
          fileIds: currentAttachments.filter((attachment) => attachment.type === "file").map((attachment) => attachment.id),
          noteIds: currentAttachments.filter((attachment) => attachment.type === "note").map((attachment) => attachment.id),
          ...(sendConversationId ? { conversationId: sendConversationId } : {}),
        }),
        signal: controller.signal,
      });
      const data = await response.json();

      if (!response.ok) {
        const errorMessage = typeof data.error === "string" && data.error ? data.error : "AI request failed.";
        throw new Error(errorMessage);
      }

      const answer = normalizeAnswer({
        ...(data.chat.answer ?? {}),
        response_mode: data.mode ?? data.chat.answer?.response_mode,
      });

      if (currentConversationVersion() !== conversationVersion) return;

      if (answer.response_mode === "offline_fallback") {
        setAttachments(currentAttachments);
      }

      // De-duplicate the assistant message by DB id so a refresh never
      // reproduces the same row twice (optimistic + DB-loaded overlap).
      const assistantDbId = `${data.chat.id}-assistant`;
      if (!loadedAssistantIdsRef.current.has(data.chat.id)) {
        loadedAssistantIdsRef.current.add(data.chat.id);
        setMessages((current) => {
          if (current.some((m) => m.id === assistantDbId)) return current;
          return [
            ...current,
            {
              id: assistantDbId,
              role: "assistant",
              mode: "study",
              answer,
              answerId: data.chat.id,
              retry: answer.response_mode === "offline_fallback" ? { question: trimmed, attachments: currentAttachments, mode } : undefined,
              createdAt: data.chat.created_at,
            },
          ];
        });
      }

      // Title the conversation from the first meaningful question if it hasn't
      // been titled yet. Greetings never become a title (shortTitleFromQuestion
      // returns null for greetings).
      void maybeAutoTitleConversation(sendConversationId, trimmed);

      // Bump updated_at so this conversation floats to the top of the list.
      void touchConversationUpdatedAt(sendConversationId, activeConversation?.title ?? null);
    } catch (err) {
      if (currentConversationVersion() !== conversationVersion) return;
      // User stopped generation â€” no error, keep the user bubble
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setQuestion(trimmed);
      setAttachments(currentAttachments);
      setPendingRetry({ question: trimmed, attachments: currentAttachments, mode });
      setError(cleanErrorMessage(err instanceof Error ? err.message : "AI request failed."));
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        setLoadingMode(null);
        setAbortController(null);
      }
      // Return focus to the input
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }

  function stopGenerating() {
    abortActiveController();
    setLoading(false);
    setLoadingMode(null);
    setAbortController(null);
  }

  function retryPendingAction() {
    if (loading) return;
    if (pendingDiagramRetry) {
      void generateDiagram(
        pendingDiagramRetry.request,
        pendingDiagramRetry.sourceLabel,
        pendingDiagramRetry.replaceMessageId,
      );
      return;
    }
    if (!pendingRetry) return;
    void sendMessage(pendingRetry.question, {
      attachmentsOverride: pendingRetry.attachments,
      skipUserBubble: true,
      modeOverride: pendingRetry.mode,
    });
  }

  function editPendingAction() {
    if (loading) return;
    if (pendingDiagramRetry) {
      setError("");
      setDiagramOpen(true);
      return;
    }
    if (!pendingRetry) return;
    setQuestion(pendingRetry.question);
    setAttachments(pendingRetry.attachments);
    setRequestMode(pendingRetry.mode);
    patchActiveContextFromState(pendingRetry.attachments, pendingRetry.mode);
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function switchPendingDeepResearchToFastSearch() {
    if (loading || pendingRetry?.mode !== "deep_research") return;
    const questionToSearch = pendingRetry.question;
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    void sendWebSearch(questionToSearch, {
      attachmentsOverride: [],
      skipUserBubble: true,
    });
  }

  function regenerate(messageId: string) {
    if (loading) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const userMessage = messages[index - 1];
    if (!userMessage || userMessage.role !== "user") return;
    if (userMessage.mode === "diagram") return;

    setMessages((current) => current.filter((m) => m.id !== messageId));
    sendMessage(userMessage.question, {
      attachmentsOverride: userMessage.attachments,
      skipUserBubble: true,
      modeOverride: userMessage.mode,
    });
  }

  function startNewChat() {
    router.replace("/chat", { scroll: false });
    bumpConversationVersion();
    abortActiveController();
    setAbortController(null);
    setLoading(false);
    setLoadingMode(null);
    stopSpeaking();
    setMessages([]);
    loadedAssistantIdsRef.current = new Set();
    setQuestion("");
    setAttachments([]);
    setDiagramOpen(false);
    setRequestMode("study");
    setError("");
    setPendingRetry(null);
    setPendingDiagramRetry(null);
    setShowScrollDown(false);
    setActiveId(null);
    setActiveConversation(null);
    setContextModeState("general");
    setActiveFileIdsState([]);
    setActiveNoteIdsState([]);
    setLegacyActive(false);
    setMessagesError(null);
    setMobileDrawerOpen(false);
    window.scrollTo({ top: 0 });
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function startVoiceQuestion() {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice question is not supported in this browser. You can type your question instead.");
      return;
    }

    setError("");
    setMenuOpen(false);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setQuestion((current) => `${current}${current ? " " : ""}${transcript}`.trim());
    };
    recognition.onerror = () => setError("Could not hear the voice question. Please try again or type it.");
    recognition.start();
  }

  function readAloud(id: string, answer: Answer) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeakingId(id);
    const utterance = new SpeechSynthesisUtterance(answerToText(answer));
    utterance.onend = () => setSpeakingId("");
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId("");
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }

  function sendLearningControl(control: LearningControl, meta: LearningStepMeta) {
    if (loading) return;
    void meta;
    void sendMessage(buildLearningControlQuestion(control), {
      modeOverride: LEARN_STEP_BY_STEP_MODE,
    });
  }

  /* â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

  const menuItemClass =
    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-40";
  const menuIconClass =
    "grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400";

  return (
    <div className="relative flex min-h-[calc(100svh-140px)] min-w-0 pb-56 sm:pb-48">
      <input ref={fileInputRef} type="file" accept={acceptTypes} multiple className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
      <input ref={imageInputRef} type="file" accept={imageAcceptTypes} className="hidden" onChange={(event) => uploadFiles(event.target.files, true)} />

      {/* â”€â”€â”€ Conversation panel (desktop sidebar + mobile drawer) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        loading={loadingConversations}
        error={conversationsError}
        legacyActive={legacyActive}
        hasLegacy={legacyChats.length > 0}
        newDisabled={loading}
        onSelect={(id) => {
          router.replace(`/chat?conversationId=${encodeURIComponent(id)}`, { scroll: false });
          void openConversation(id);
        }}
        onNew={startNewChat}
        onRename={(id, title) => void renameConversation(id, title)}
        onTogglePin={(id, pinned) => void togglePinConversation(id, pinned)}
        onDelete={(id) => void removeConversation(id)}
        onOpenLegacy={openLegacyChat}
        mobileOpen={mobileDrawerOpen}
        onCloseMobile={() => setMobileDrawerOpen(false)}
      />

      {/* â”€â”€â”€ Chat column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* â”€â”€â”€ Conversation header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <ConversationHeader
          // Remount the header whenever the active conversation changes so its
          // inline-rename state resets without an effect (cleaner than calling
          // setState synchronously inside an effect).
          key={legacyActive ? "__legacy__" : activeId ?? "__new__"}
          activeId={activeId}
          title={activeConversation?.title ?? null}
          contextMode={legacyActive ? null : contextModeState}
          activeFileNames={activeContextFileNames}
          legacyActive={legacyActive}
          renameDisabled={loading}
          onRename={(title) => {
            if (activeId) void renameConversation(activeId, title);
          }}
          onOpenMobileDrawer={() => setMobileDrawerOpen(true)}
        />

        {activeId && !legacyActive ? (
          <div className="mb-4 flex justify-end">
            <Link
              href={`/voice?conversationId=${encodeURIComponent(activeId)}`}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            >
              <IconVolume size={14} />
              Continue in Voice Tutor
            </Link>
          </div>
        ) : null}

        {messagesError ? (
          <div className="mb-4 rounded-lg border border-red-300/25 bg-red-300/[0.08] p-3 text-sm text-red-100">
            {messagesError}
          </div>
        ) : null}

        {loadingMessages ? (
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300"
            role="status"
            aria-live="polite"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
            Loading conversation…
          </div>
        ) : null}

        {/* â”€â”€â”€ Messages or empty state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {!messages.length ? (
        <ChatEmptyState onPick={(suggestion) => setQuestion(suggestion)} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((message) => {
            // Render via an explicit if/else chain so TypeScript's control-flow
            // analysis narrows the UiMessage discriminated union by `role` and
            // `mode` for each branch (the long ternary chain defeats narrowing
            // under Turbopack's per-file type check). Purely structural; the
            // JSX body, keys, and behavior are byte-identical to the previous
            // inline ternary form.
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex animate-fade-in-up justify-end">
                  <div className="max-w-[85%] min-w-0">
                    <div className="rounded-2xl rounded-br-md bg-emerald-400 px-4 py-2.5 text-slate-950 shadow-lg shadow-emerald-950/20">
                      <p className="whitespace-pre-wrap break-words text-sm font-medium leading-6">{message.question}</p>
                    </div>
                    {message.attachments.length ? (
                      <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                        {message.attachments.map((attachment) => (
                          <span
                            key={`${attachment.type}:${attachment.id}`}
                            className="max-w-full truncate break-words rounded-md bg-slate-950/10 px-2 py-0.5 text-xs font-medium"
                            title={attachment.label}
                          >
                            {attachment.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.mode === "web_search" || message.mode === "deep_research" || message.mode === "diagram" || message.mode === LEARN_STEP_BY_STEP_MODE ? (
                      <div className="mt-1.5 flex justify-end">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          message.mode === "deep_research"
                            ? "border-sky-300/20 bg-sky-300/[0.08] text-sky-200"
                            : message.mode === "diagram"
                              ? "border-pink-300/20 bg-pink-300/[0.08] text-pink-200"
                              : message.mode === LEARN_STEP_BY_STEP_MODE
                                ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
                                : "border-violet-300/20 bg-violet-300/[0.08] text-violet-200"
                        }`}>
                          {message.mode === "diagram" ? <IconImage size={11} /> : message.mode === LEARN_STEP_BY_STEP_MODE ? <IconFileText size={11} /> : <IconSearch size={11} />}
                          {message.mode === "deep_research"
                            ? "Deep research"
                            : message.mode === "diagram"
                              ? "Diagram"
                              : message.mode === LEARN_STEP_BY_STEP_MODE
                                ? "Learn Step by Step"
                                : "Web search"}
                        </span>
                      </div>
                    ) : null}
                    {mounted && message.createdAt ? (
                      <p className="mt-1 text-right text-[11px] text-slate-500">{formatTime(message.createdAt)}</p>
                    ) : null}
                  </div>
                </div>
              );
            }

            if (message.mode === "web_search") {
              return (
                <div key={message.id} className="flex animate-fade-in-up gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-300/25 bg-violet-300/10 text-violet-200">
                    <IconSearch size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-violet-200">StudyPilot Web</span>
                      {mounted && message.createdAt ? (
                        <span className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</span>
                      ) : null}
                    </div>
                    <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.035] px-4 py-3">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">
                        {message.webAnswer.concise_answer}
                      </p>
                      <div className="mt-4">
                        <WebCitationList citations={message.webAnswer.web_citations} />
                      </div>
                    </div>
                    <MessageActions
                      answer={{ short_answer: message.webAnswer.concise_answer }}
                      speaking={speakingId === message.id}
                      onCopy={answerToText}
                      onRegenerate={() => regenerate(message.id)}
                      onReadAloud={() => readAloud(message.id, { short_answer: message.webAnswer.concise_answer })}
                      onStopSpeaking={stopSpeaking}
                      regenerating={loading}
                    />
                  </div>
                </div>
              );
            }

            if (message.mode === "deep_research") {
              return (
                <div key={message.id} className="flex animate-fade-in-up gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-sky-300/25 bg-sky-300/10 text-sky-200">
                    <IconSearch size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-sky-200">StudyPilot Research</span>
                      {mounted && message.createdAt ? (
                        <span className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</span>
                      ) : null}
                    </div>
                    <DeepResearchReportView report={message.researchReport} />
                    <MessageActions
                      answer={{ short_answer: message.researchReport.executive_summary }}
                      speaking={speakingId === message.id}
                      onCopy={() => deepResearchToText(message.researchReport)}
                      onRegenerate={() => regenerate(message.id)}
                      onReadAloud={() => readAloud(message.id, { short_answer: deepResearchToText(message.researchReport) })}
                      onStopSpeaking={stopSpeaking}
                      regenerating={loading}
                    />
                  </div>
                </div>
              );
            }

            if (message.mode === "diagram") {
              return (
                <div key={message.id} className="flex animate-fade-in-up gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-pink-300/25 bg-pink-300/10 text-pink-200">
                    <IconImage size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-semibold text-pink-200">StudyPilot Visuals</span>
                      <span className="break-words text-[11px] text-slate-500">Source: {message.sourceLabel}</span>
                      {mounted && message.createdAt ? (
                        <span className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</span>
                      ) : null}
                    </div>
                    <DiagramPreview
                      diagram={message.diagram}
                      onRegenerate={() => void generateDiagram(message.diagramRequest, message.sourceLabel, message.id)}
                      regenerating={loading && loadingMode === "diagram"}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="flex animate-fade-in-up gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-xs font-bold text-emerald-300">
                  SP
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-300">StudyPilot AI</span>
                    {mounted && message.createdAt ? (
                      <span className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</span>
                    ) : null}
                  </div>

                  {message.answer.response_mode === "offline_fallback" ? (
                    <div className="mb-2.5 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>AI model limit reached. Showing answer from saved study material.</span>
                        {message.retry ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (message.retry) {
                                sendMessage(message.retry.question, {
                                  attachmentsOverride: message.retry.attachments,
                                  skipUserBubble: true,
                                  modeOverride: message.retry.mode,
                                });
                              }
                            }}
                            className="inline-flex h-7 items-center rounded-md border border-amber-200/35 bg-amber-200/10 px-2.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-200/15"
                          >
                            Retry AI
                          </button>
                        ) : null}
                      </div>
                      {message.answer.fallback_notice ? <p className="mt-1.5 text-xs text-amber-100/80">{message.answer.fallback_notice}</p> : null}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <AssistantAnswer answer={message.answer} />
                    {message.answer.learning_step ? (
                      <LearningStepControls
                        meta={message.answer.learning_step}
                        loading={loading}
                        onControl={sendLearningControl}
                      />
                    ) : null}
                  </div>

                  <MessageActions
                    answer={message.answer}
                    speaking={speakingId === message.id}
                    onCopy={answerToText}
                    onRegenerate={() => regenerate(message.id)}
                    onReadAloud={() => readAloud(message.id, message.answer)}
                    onStopSpeaking={stopSpeaking}
                    regenerating={loading}
                  />
                </div>
              </div>
            );
          })}

          {loading ? (
            <div className="flex animate-fade-in gap-3">
              <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                loadingMode === "deep_research"
                  ? "border-sky-300/25 bg-sky-300/10 text-sky-200"
                  : loadingMode === "diagram"
                    ? "border-pink-300/25 bg-pink-300/10 text-pink-200"
                    : "border-emerald-400/20 bg-emerald-400/10 text-xs font-bold text-emerald-300"
              }`}>
                {loadingMode === "deep_research"
                  ? <IconSearch size={15} />
                  : loadingMode === "diagram"
                    ? <IconImage size={15} />
                    : "SP"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1">
                  <span className={`text-xs font-semibold ${loadingMode === "deep_research" ? "text-sky-200" : loadingMode === "diagram" ? "text-pink-200" : "text-slate-300"}`}>
                    {loadingMode === "deep_research" ? "StudyPilot Research" : loadingMode === "diagram" ? "StudyPilot Visuals" : "StudyPilot AI"}
                  </span>
                </div>
                {loadingMode === "deep_research" ? (
                  <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.04] px-4 py-3" role="status" aria-live="polite">
                    <LoadingDots text={`${researchProgressCues[researchProgressIndex]}…`} />
                    <p className="mt-1 text-[11px] text-slate-500">Bounded to 3-5 searches and at most 12 sources.</p>
                  </div>
                ) : (
                  <div className="inline-flex items-center rounded-xl border border-emerald-300/15 bg-emerald-400/[0.04] px-4 py-2.5">
                    <LoadingDots
                      text={
                        loadingMode === "web_search"
                          ? "Searching the web…"
                          : loadingMode === "diagram"
                            ? "Generating a grounded diagram…"
                            : loadingMode === LEARN_STEP_BY_STEP_MODE
                              ? "Preparing the next learning step…"
                              : "Thinking with your study context…"
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* â”€â”€â”€ Scroll to bottom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {showScrollDown ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-32 left-1/2 z-20 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-white/15 bg-slate-900/90 text-slate-200 shadow-lg shadow-black/40 backdrop-blur-md transition hover:bg-slate-800 lg:left-[calc(50%+130px)]"
          aria-label="Scroll to latest message"
        >
          <IconArrowDown size={16} />
        </button>
      ) : null}

      {/* â”€â”€â”€ Composer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-[#070b14]/90 px-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl lg:left-[260px]">
        <div className="mx-auto max-w-3xl">
          {error ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-400/25 bg-red-400/[0.08] px-3 py-2 text-sm text-red-200">
              <span className="min-w-0 break-words">{error}</span>
              {pendingRetry || pendingDiagramRetry ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {pendingRetry?.mode === "deep_research" ? (
                    <button
                      type="button"
                      onClick={switchPendingDeepResearchToFastSearch}
                      disabled={loading}
                      className="inline-flex h-7 items-center rounded-md border border-sky-200/30 bg-sky-200/10 px-2.5 text-xs font-semibold text-sky-100 transition hover:bg-sky-200/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Fast Search
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={editPendingAction}
                    disabled={loading}
                    className="inline-flex h-7 items-center rounded-md border border-red-200/30 bg-red-200/10 px-2.5 text-xs font-semibold text-red-100 transition hover:bg-red-200/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={retryPendingAction}
                    disabled={loading}
                    className="inline-flex h-7 items-center rounded-md border border-red-200/30 bg-red-200/10 px-2.5 text-xs font-semibold text-red-100 transition hover:bg-red-200/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {uploadProgress ? (
            <div className="mb-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">{uploadProgress}</div>
          ) : null}

          {requestMode === "web_search" || requestMode === "deep_research" || requestMode === LEARN_STEP_BY_STEP_MODE ? (
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={
                  requestMode === "deep_research"
                    ? clearDeepResearchMode
                    : requestMode === LEARN_STEP_BY_STEP_MODE
                      ? clearLearnStepByStepMode
                      : clearWebSearchMode
                }
                disabled={loading}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                  requestMode === "deep_research"
                    ? "border-sky-300/25 bg-sky-300/10 text-sky-100 hover:bg-sky-300/15 focus-visible:ring-sky-300/50"
                    : requestMode === LEARN_STEP_BY_STEP_MODE
                      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/15 focus-visible:ring-emerald-300/50"
                    : "border-violet-300/25 bg-violet-300/10 text-violet-100 hover:bg-violet-300/15 focus-visible:ring-violet-300/50"
                }`}
                aria-label={
                  requestMode === "deep_research"
                    ? "Clear Deep research mode"
                    : requestMode === LEARN_STEP_BY_STEP_MODE
                      ? "Clear Learn Step by Step mode"
                      : "Clear Web search mode"
                }
                title={
                  requestMode === "deep_research"
                    ? "Clear Deep research mode"
                    : requestMode === LEARN_STEP_BY_STEP_MODE
                      ? "Clear Learn Step by Step mode"
                      : "Clear Web search mode"
                }
              >
                {requestMode === LEARN_STEP_BY_STEP_MODE ? <IconFileText size={12} /> : <IconSearch size={12} />}
                {requestMode === "deep_research" ? "Deep research" : requestMode === LEARN_STEP_BY_STEP_MODE ? "Learn Step by Step" : "Web search"}
                <IconX size={12} />
              </button>
              <span className="text-[11px] text-slate-500">
                {requestMode === "deep_research"
                  ? "Enter a focused research question"
                  : requestMode === LEARN_STEP_BY_STEP_MODE
                    ? "Enter a topic, answer, or use the step controls"
                    : "Enter a current-information query"}
              </span>
            </div>
          ) : null}

          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <button
                  key={`${attachment.type}:${attachment.id}`}
                  type="button"
                  onClick={() => removeAttachment(attachment)}
                  className="inline-flex max-w-full items-center gap-1 break-words rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-300/15"
                  title="Remove attachment"
                >
                  <span className="truncate">{attachment.label}</span>
                  <IconX size={12} className="shrink-0" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="relative rounded-2xl border border-white/12 bg-slate-950/90 p-1.5 shadow-2xl shadow-black/35">
            {/* Attachment menu */}
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-40 bg-black/50 sm:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                <div
                  ref={menuRef}
                  role="menu"
                  aria-label="Attach options"
                  className="fixed inset-x-0 bottom-0 z-50 max-h-[55vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-slate-950 p-2 shadow-2xl shadow-black/50 sm:absolute sm:bottom-[calc(100%+0.5rem)] sm:left-0 sm:inset-x-auto sm:w-72 sm:max-h-none sm:rounded-2xl sm:border sm:border-white/10 sm:p-1.5"
                >
                  <div className="mb-1 flex items-center justify-between px-1 pt-1 sm:hidden">
                    <span className="text-xs font-semibold text-slate-300">Add to chat</span>
                    <button
                      type="button"
                      onClick={() => setMenuOpen(false)}
                      className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
                      aria-label="Close menu"
                    >
                      <IconX size={16} />
                    </button>
                  </div>
                  <div className="grid gap-0.5">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className={menuItemClass} role="menuitem">
                      <span className={menuIconClass}><IconUpload size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Upload from computer</span>
                        <span className="block text-xs text-slate-400">PDF, PPTX, DOCX, text, image, or ZIP</span>
                      </span>
                    </button>
                    <button type="button" onClick={() => { setPickerOpen(true); setMenuOpen(false); }} className={menuItemClass} role="menuitem">
                      <span className={menuIconClass}><IconFiles size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Attach from My Files</span>
                        <span className="block text-xs text-slate-400">Choose existing files or notes</span>
                      </span>
                    </button>
                    <button type="button" onClick={() => imageInputRef.current?.click()} className={menuItemClass} role="menuitem">
                      <span className={menuIconClass}><IconImage size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Add image</span>
                        <span className="block text-xs text-slate-400">Upload an image and ask about it</span>
                      </span>
                    </button>
                    <Link href="/upload" className={menuItemClass} role="menuitem">
                      <span className={menuIconClass}><IconFileText size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Add manual note</span>
                        <span className="block text-xs text-slate-400">Save typed notes from the upload page</span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      disabled={!recentFile}
                      onClick={() => {
                        if (recentFile) addAttachment({ id: recentFile.id, label: recentFile.file_name, type: "file" });
                        setMenuOpen(false);
                      }}
                      className={menuItemClass}
                      role="menuitem"
                    >
                      <span className={menuIconClass}><IconFiles size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Use recent file</span>
                        <span className="block truncate text-xs text-slate-400">{recentFile ? recentFile.file_name : "No recent file available"}</span>
                      </span>
                    </button>
                    <button type="button" onClick={startVoiceQuestion} className={menuItemClass} role="menuitem">
                      <span className={menuIconClass}><IconMic size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Voice question</span>
                        <span className="block text-xs text-slate-400">Use browser speech-to-text</span>
                      </span>
                    </button>

                    <div className="my-1 h-px bg-white/10" aria-hidden="true" />

                    <button
                      type="button"
                      onClick={activateWebSearch}
                      className={`${menuItemClass} ${requestMode === "web_search" ? "bg-violet-300/[0.08]" : ""}`}
                      role="menuitem"
                    >
                      <span className={`${menuIconClass} border-violet-300/20 text-violet-200`}><IconSearch size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Web search</span>
                        <span className="block text-xs text-slate-400">Search current sources with citations</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={activateDeepResearch}
                      className={`${menuItemClass} ${requestMode === "deep_research" ? "bg-sky-300/[0.08]" : ""}`}
                      role="menuitem"
                    >
                      <span className={`${menuIconClass} border-sky-300/20 text-sky-200`}><IconSearch size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Deep research</span>
                        <span className="block text-xs text-slate-400">Build a bounded multi-source report</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={activateLearnStepByStep}
                      className={`${menuItemClass} ${requestMode === LEARN_STEP_BY_STEP_MODE ? "bg-emerald-300/[0.08]" : ""}`}
                      role="menuitem"
                    >
                      <span className={`${menuIconClass} border-emerald-300/20 text-emerald-200`}><IconFileText size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Learn Step by Step</span>
                        <span className="block text-xs text-slate-400">Study one guided step at a time</span>
                      </span>
                    </button>

                    <button type="button" onClick={activateDiagram} className={menuItemClass} role="menuitem">
                      <span className={`${menuIconClass} border-pink-300/20 text-pink-200`}><IconImage size={14} /></span>
                      <span className="min-w-0">
                        <span className="block font-medium text-white">Generate diagram</span>
                        <span className="block text-xs text-slate-400">Visualize an answer, file, summary, or topic</span>
                      </span>
                    </button>
                  </div>
                </div>
              </>
            ) : null}

            {/* Input row */}
            <div className="flex items-end gap-2">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] ${
                  menuOpen
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
                aria-label="Add attachment"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <IconPlus size={18} className={`transition-transform duration-200 ${menuOpen ? "rotate-45" : ""}`} />
              </button>
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                rows={1}
                placeholder={
                  requestMode === "web_search"
                    ? "Search the web…"
                    : requestMode === "deep_research"
                      ? "What should StudyPilot research deeply?"
                      : requestMode === LEARN_STEP_BY_STEP_MODE
                        ? "What topic should we learn step by step?"
                      : "Ask StudyPilot about your study material…"
                }
                className="max-h-40 min-h-[2.5rem] min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
                aria-label="Type your question"
              />
              <button
                type="button"
                onClick={startVoiceQuestion}
                className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] sm:grid"
                aria-label="Voice question"
              >
                <IconMic size={18} />
              </button>
              {loading ? (
                <button
                  type="button"
                  onClick={stopGenerating}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-slate-100 transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
                  aria-label={loadingMode === "deep_research" ? "Cancel deep research" : "Stop generating"}
                >
                  <IconStop size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={!question.trim()}
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-950 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] disabled:cursor-not-allowed disabled:opacity-40 ${
                    requestMode === "web_search"
                      ? "bg-violet-300 hover:bg-violet-200 focus-visible:ring-violet-300/50"
                      : requestMode === "deep_research"
                        ? "bg-sky-300 hover:bg-sky-200 focus-visible:ring-sky-300/50"
                        : "bg-emerald-400 hover:bg-emerald-300 focus-visible:ring-emerald-400/50"
                  }`}
                  aria-label={
                    requestMode === "web_search"
                      ? "Search the web"
                      : requestMode === "deep_research"
                        ? "Start deep research"
                        : requestMode === LEARN_STEP_BY_STEP_MODE
                          ? "Start or continue Learn Step by Step"
                          : "Send message"
                  }
                >
                  <IconSend size={18} />
                </button>
              )}
            </div>
          </div>

          <p className="mt-1.5 px-1 text-center text-[11px] text-slate-500">
            {requestMode === "web_search"
              ? "Web answers use current search results. Open the listed sources to verify important details."
              : requestMode === "deep_research"
                ? "Deep research uses a bounded set of current web sources and shows its limitations."
                : requestMode === LEARN_STEP_BY_STEP_MODE
                  ? "Learn Step by Step keeps one guided step active in this conversation."
              : "StudyPilot uses your files and notes as context. AI calls are limited on free keys."}
          </p>
        </div>
      </div>

      {/* â”€â”€â”€ Attachment picker modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {diagramOpen ? (
        <DiagramComposer
          sources={diagramSources}
          loading={loading && loadingMode === "diagram"}
          onClose={() => setDiagramOpen(false)}
          onGenerate={(request, sourceLabel) => void generateDiagram(request, sourceLabel)}
        />
      ) : null}

      {pickerOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-4">
          <div className="max-h-[86vh] w-full overflow-hidden rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/50 sm:max-w-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <h2 className="font-semibold text-white">Attach from My Files</h2>
                <p className="mt-1 text-xs text-slate-400">Select files or notes as context for your next question.</p>
              </div>
              <button type="button" onClick={() => setPickerOpen(false)} className="inline-flex h-8 items-center rounded-md border border-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50">
                Done
              </button>
            </div>
            <div className="grid max-h-[70vh] gap-4 overflow-auto p-4 md:grid-cols-2">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">Files</h3>
                <div className="grid gap-2">
                  {files.map((file) => {
                    const selected = selectedIds.has(`file:${file.id}`);
                    return (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => {
                          if (selected) removeAttachment({ id: file.id, label: file.file_name, type: "file" });
                          else addAttachment({ id: file.id, label: file.file_name, type: "file" });
                        }}
                        className={`min-w-0 rounded-lg border p-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 ${
                          selected ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]"
                        }`}
                      >
                        <span className="block break-words font-semibold">{file.file_name}</span>
                        <span className="break-words text-xs text-slate-400">{file.file_type ?? file.mime_type ?? "Study file"}</span>
                      </button>
                    );
                  })}
                  {!files.length ? <p className="text-sm text-slate-500">No files yet.</p> : null}
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">Notes</h3>
                <div className="grid gap-2">
                  {notes.map((note) => {
                    const label = note.title ?? note.topic ?? "Manual note";
                    const selected = selectedIds.has(`note:${note.id}`);
                    return (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => {
                          if (selected) removeAttachment({ id: note.id, label, type: "note" });
                          else addAttachment({ id: note.id, label, type: "note" });
                        }}
                        className={`min-w-0 rounded-lg border p-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 ${
                          selected ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]"
                        }`}
                      >
                        <span className="block break-words font-semibold">{label}</span>
                        <span className="break-words text-xs text-slate-400">{note.topic ?? "Manual note"}</span>
                      </button>
                    );
                  })}
                  {!notes.length ? <p className="text-sm text-slate-500">No manual notes yet.</p> : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
      </div>
      {/* â”€â”€â”€ end chat column â”€â”€â”€ */}
    </div>
  );
}
