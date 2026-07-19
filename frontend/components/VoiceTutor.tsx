"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  activeContextLabel,
  type Conversation,
  type ConversationMessage,
  type ContextMode,
} from "@/frontend/lib/conversationTypes";
import {
  createConversation,
  patchConversation,
  shortTitleFromQuestion,
} from "@/frontend/lib/conversations";
import {
  VOICE_LANGUAGES,
  findVoiceLanguage,
  getSpeechRecognition,
  isSpeechSynthesisSupported,
  pickVoiceForLocale,
  type SpeechRecognitionLike,
} from "@/frontend/lib/speech/webSpeech";
import {
  RecordingSilenceTimer,
  VOICE_RECORDING_SILENCE_MS,
} from "@/frontend/lib/speech/recordingSilenceTimer";
import {
  VOICE_COMMANDS,
  resolveVoiceCommand,
  type VoiceDiagramSourceIntent,
  type VoiceDiagramType,
  type VoiceNoteExportFormat,
  type VoiceNoteSource,
  type VoiceNoteStyle,
} from "@/frontend/lib/speech/voiceCommands";
import {
  adaptStudyNoteRow,
  createStudyNote,
  updateStudyNote,
  type StudyNoteDraft,
} from "@/frontend/lib/studyNotes";
import { exportStudyNote, type NoteExportFormat } from "@/frontend/lib/noteExport";
import {
  deepResearchToText,
  runDeepResearch,
  runWebSearch,
  type DeepResearchReport as DeepResearchReportValue,
  type WebSearchAnswer,
} from "@/frontend/lib/webFeatures";
import {
  runDiagramGeneration,
  type DiagramRequest,
  type DiagramResult,
} from "@/frontend/lib/diagram";
import {
  normalizeSourceCitations,
  SourceCitationChips,
  type SourceCitationValue,
} from "./SourceCitationChips";
import {
  telemetryStartRequest,
  telemetryEndRequest,
  telemetryStartStage,
  telemetryEndStage,
  telemetrySetMetadata,
} from "@/frontend/lib/telemetry";
import { WebCitationList } from "./WebCitationList";
import { DeepResearchReport as DeepResearchReportView } from "./DeepResearchReport";
import { DiagramPreview } from "./DiagramPreview";
import { VoiceOrb, type VoiceOrbState } from "./voice/VoiceOrb";
import { StudyNoteEditor } from "./StudyNoteEditor";
import {
  IconBrain,
  IconChat,
  IconCheck,
  IconClock,
  IconFileText,
  IconImage,
  IconMic,
  IconRefresh,
  IconSearch,
  IconStop,
  IconVolume,
  IconVolumeOff,
  IconZap,
} from "./icons";

// ---------------------------------------------------------------------------
// Answer shape (mirrors the StudyPilot chat API response)
// ---------------------------------------------------------------------------

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
  response_mode?: "ai" | "cache" | "offline_fallback";
  fallback_notice?: string;
  // Verified sources returned by /api/ai/ask. Rendered as citation chips.
  source_citations?: SourceCitationValue[];
  // Legacy source chips, rendered only when structured citations are absent.
  source_chips?: { id?: string; label: string; type: string }[];
};

type Turn = {
  id: string;
  role: "user" | "assistant" | "system";
  question?: string;
  answer?: Answer;
  answerId?: string;
  webSearch?: WebSearchAnswer;
  webQuery?: string;
  researchReport?: DeepResearchReportValue;
  researchQuery?: string;
  diagram?: DiagramResult;
  diagramRequest?: DiagramRequest;
  diagramPrompt?: string;
  text?: string;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function answerToSpokenText(answer: Answer): string {
  return [
    answer.short_answer,
    answer.simple_explanation,
    ...(answer.step_by_step ?? []),
    answer.example,
    answer.memory_line,
    answer.common_mistake,
    answer.exam_viva_answer,
    answer.practice_question,
    answer.next_step,
  ]
    .filter(Boolean)
    .join(". ");
}

function stripUrlsForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isContextualWebQuery(query: string): boolean {
  const normalized = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized === "this" || normalized === "this topic";
}

function isContextualResearchQuery(query: string): boolean {
  const normalized = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    "this",
    "this topic",
    "ee topic",
    "these technologies",
    "this technology",
    "ఈ టాపిక్",
  ].includes(normalized);
}

function hasMeaningfulQuery(query: string): boolean {
  return /[\p{L}\p{N}]/u.test(query);
}

const RESEARCH_PROGRESS_CUES = [
  "Planning research",
  "Searching sources",
  "Reviewing evidence",
  "Writing report",
] as const;

const MAX_DIAGRAM_SOURCE_TEXT = 12_000;

function boundedDiagramSourceText(text: string): string {
  return text
    .replace(/\[([^\]]+)]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DIAGRAM_SOURCE_TEXT);
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function textValue(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function arrayValue(record: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = list(record[key]);
    if (value.length) return value;
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
    response_mode: textValue(record, "response_mode", "responseMode") as Answer["response_mode"],
    fallback_notice: textValue(record, "fallback_notice", "fallbackNotice"),
    source_citations: normalizeSourceCitations(record.source_citations ?? record.sourceCitations),
    source_chips: Array.isArray(record.source_chips ?? record.sourceChips)
      ? (record.source_chips ?? record.sourceChips) as Answer["source_chips"]
      : undefined,
  };
}

function recordToTurns(message: ConversationMessage): Turn[] {
  return [
    {
      id: `${message.id}-user`,
      role: "user",
      question: message.question,
    },
    {
      id: `${message.id}-assistant`,
      role: "assistant",
      answer: normalizeAnswer(message.answer),
      answerId: message.id,
    },
  ];
}

function conversationDisplayTitle(conversation: Conversation | null): string {
  return conversation?.title?.trim() || "New chat";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-slate-950/55 p-4">
      <h3 className="text-xs font-semibold uppercase text-emerald-200">{title}</h3>
      <div className="mt-2 break-words text-sm leading-6 text-slate-200">{children}</div>
    </section>
  );
}

// SSR-safe subscriptions: browser feature support never changes during a
// session, so the subscribe callback is a no-op. getServerSnapshot returns
// false so the server markup matches a "checking..." state, then the client
// hydrates the real value without a setState-in-effect.
const noopSubscribe = () => () => {};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceTutor({
  initialFileId,
  initialFileName,
  initialConversation,
  initialMessages = [],
  initialConversationError = "",
  files = [],
  notes = [],
}: {
  initialFileId?: string | null;
  initialFileName?: string | null;
  initialConversation?: Conversation | null;
  initialMessages?: ConversationMessage[];
  initialConversationError?: string | null;
  files?: FileOption[];
  notes?: NoteOption[];
}) {
  const [language, setLanguage] = useState<string>("auto");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>(() => initialMessages.flatMap((message) => recordToTurns(message)));
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [researching, setResearching] = useState(false);
  const [activeResearchQuery, setActiveResearchQuery] = useState("");
  const [researchProgressIndex, setResearchProgressIndex] = useState(0);
  const [visualizing, setVisualizing] = useState(false);
  const [activeDiagramPrompt, setActiveDiagramPrompt] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState<StudyNoteDraft | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [hasSpokenText, setHasSpokenText] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialConversationError ?? "");
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation ?? null);
  const [conversationId, setConversationId] = useState<string | null>(initialConversation?.id ?? null);
  const [contextMode, setContextMode] = useState<ContextMode>(initialConversation?.context_mode ?? "general");
  const [activeFileIds, setActiveFileIds] = useState<string[]>(initialConversation?.active_file_ids ?? []);
  const [activeNoteIds, setActiveNoteIds] = useState<string[]>(initialConversation?.active_note_ids ?? []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<RecordingSilenceTimer | null>(null);
  const recognitionCleanupRef = useRef<(() => void) | null>(null);
  const askAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const diagramAbortRef = useRef<AbortController | null>(null);
  const lastSpokenTextRef = useRef<string>("");
  const turnCounterRef = useRef(0);
  // Voice-turn epoch: every accepted final transcript or new AI request
  // bumps this. Async callbacks capture the epoch at issue time and refuse
  // to apply their results if it has advanced (a newer voice turn superseded
  // them). This prevents a late /api/ai/ask response from appending old
  // PDF/previous-answer content after a newer pure greeting.
  const voiceTurnEpochRef = useRef(0);
  // Per-recognition-session guard: each startListening instance gets a unique
  // token. onend checks the token before dispatching handleSpokenText so a
  // duplicate onend (or a stale recognition from a previous mic session)
  // cannot re-process the same transcript. A handled-transcript set, scoped
  // to the single session, blocks duplicate final events for identical text
  // without ever blocking the same words spoken in a later session.
  const recognitionSessionRef = useRef<{ token: number; handled: Set<string> } | null>(null);
  const loadedAssistantIdsRef = useRef<Set<string>>(new Set(initialMessages.map((message) => message.id)));
  const titledConversationIdsRef = useRef<Set<string>>(
    new Set(initialConversation?.title ? [initialConversation.id] : []),
  );
  const requestIdRef = useRef<string>("");

  const recognitionSupported = useSyncExternalStore(
    noopSubscribe,
    () => getSpeechRecognition() !== null,
    () => false,
  );
  const synthesisSupported = useSyncExternalStore(
    noopSubscribe,
    () => isSpeechSynthesisSupported(),
    () => false,
  );

  const activeLanguage = useMemo(() => findVoiceLanguage(language), [language]);
  const fileNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) map.set(file.id, file.file_name);
    if (initialFileId && initialFileName) map.set(initialFileId, initialFileName);
    return map;
  }, [files, initialFileId, initialFileName]);
  const noteNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.id, note.title ?? note.topic ?? "Manual note");
    return map;
  }, [notes]);
  const activeContextNames = useMemo(
    () => [
      ...activeFileIds.map((id) => fileNamesById.get(id) ?? "File"),
      ...activeNoteIds.map((id) => noteNamesById.get(id) ?? "Manual note"),
    ].slice(0, 4),
    [activeFileIds, activeNoteIds, fileNamesById, noteNamesById],
  );
  const activeContextText = activeContextLabel(contextMode, activeContextNames);
  const contextFileForCommands =
    (contextMode === "file" || contextMode === "image" ? activeFileIds[0] : null) ?? initialFileId ?? null;
  const contextFileNameForCommands =
    (contextFileForCommands ? fileNamesById.get(contextFileForCommands) : null) ?? initialFileName ?? null;
  const studyFileIds =
    contextMode === "file" || contextMode === "image" ? activeFileIds : [];
  const studyNoteIds =
    contextMode === "file" || contextMode === "image" ? activeNoteIds : [];

  // Stop any active recognition/synthesis when the component unmounts.
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current !== null) {
        silenceTimerRef.current.dispose();
        silenceTimerRef.current = null;
      }
      recognitionCleanupRef.current?.();
      recognitionCleanupRef.current = null;
      const active = recognitionRef.current;
      if (active) {
        try {
          active.abort();
        } catch {
          // Ignore abort errors on unmount.
        }
      }
      if (isSpeechSynthesisSupported()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore cancel errors on unmount.
        }
      }
      askAbortRef.current?.abort();
      askAbortRef.current = null;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      researchAbortRef.current?.abort();
      researchAbortRef.current = null;
      diagramAbortRef.current?.abort();
      diagramAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!researching) return;
    const timers = [
      window.setTimeout(() => setResearchProgressIndex(1), 1_500),
      window.setTimeout(() => setResearchProgressIndex(2), 5_000),
      window.setTimeout(() => setResearchProgressIndex(3), 9_000),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [researching]);

  function nextTurnId(prefix: string): string {
    turnCounterRef.current += 1;
    return `${prefix}-${turnCounterRef.current}`;
  }

  // Normalize a final transcript the same way voiceCommands.normalize does,
  // so per-session deduplication compares a stable lowercase, punctuation-free
  // form. Whitespace is collapsed so "hi" vs " hi " vs "hi!" are not treated
  // as distinct duplicates.
  function normalizeTranscriptForDedup(text: string): string {
    return text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Bump the voice-turn epoch so any in-flight async result (AI ask, web
  // search, research, diagram) issued under a prior epoch is ignored when it
  // resolves. Returns the new epoch so a caller that continues with async
  // work can capture and verify it locally.
  function invalidateVoiceTurnEpoch(): number {
    voiceTurnEpochRef.current += 1;
    return voiceTurnEpochRef.current;
  }

  // Abort and clear the /api/ai/ask controller (and its loading flag) without
  // touching unrelated abort refs/flags. Used by the greeting path so a
  // late-resolving prior AI request cannot append old PDF/previous-answer
  // content after a newer greeting reply.
  function abortActiveAskRequest() {
    const active = askAbortRef.current;
    if (!active) return;
    askAbortRef.current = null;
    active.abort();
    setLoading(false);
  }

  async function ensureConversationForQuestion(question: string) {
    if (conversationId && conversation) return conversation;

    const title = shortTitleFromQuestion(question);
    const result = await createConversation({
      title: title ?? undefined,
      contextMode: "general",
      activeFileIds: [],
      activeNoteIds: [],
    });
    if (!result.ok) throw new Error(result.message);

    setConversation(result.conversation);
    setConversationId(result.conversation.id);
    setContextMode(result.conversation.context_mode);
    setActiveFileIds(result.conversation.active_file_ids ?? []);
    setActiveNoteIds(result.conversation.active_note_ids ?? []);
    if (title) titledConversationIdsRef.current.add(result.conversation.id);
    return result.conversation;
  }

  async function maybeAutoTitleConversation(id: string | null, question: string) {
    if (!id || titledConversationIdsRef.current.has(id)) return;
    if (conversation?.title) {
      titledConversationIdsRef.current.add(id);
      return;
    }
    const title = shortTitleFromQuestion(question);
    if (!title) return;
    titledConversationIdsRef.current.add(id);
    const result = await patchConversation(id, { title });
    if (result.ok) setConversation(result.conversation);
  }

  async function touchConversationUpdatedAt(id: string | null) {
    if (!id) return;
    const result = await patchConversation(id, { title: conversation?.title ?? null });
    if (result.ok) setConversation(result.conversation);
  }

  // -------------------------------------------------------------------------
  // Ask the existing StudyPilot chat API (declared before the mic handler so
  // there is no forward reference)
  // -------------------------------------------------------------------------

  async function askStudyPilot(displayQuestion: string) {
    setError("");
    setNotice("");
    const requestId = requestIdRef.current;
    let endTelemetryInFinally = Boolean(requestId);

    // This is a new voice turn. Invalidate any older async work first so a
    // late-resolving prior request cannot append stale content. Abort the
    // active controller (if any) before issuing the new one.
    const epoch = invalidateVoiceTurnEpoch();
    abortActiveAskRequest();

    setLoading(true);
    setTurns((current) => [...current, { id: nextTurnId("user"), role: "user", question: displayQuestion }]);

    const controller = new AbortController();
    askAbortRef.current = controller;

    try {
      telemetryStartStage(requestId, "conversation_loading");
      const activeConversation = await ensureConversationForQuestion(displayQuestion);
      telemetryEndStage(requestId, "conversation_loading");

      telemetryStartStage(requestId, "api_request_start");
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: displayQuestion,
          fileIds: studyFileIds,
          noteIds: studyNoteIds,
          conversationId: activeConversation.id,
          deferPersistence: true,
        }),
        signal: controller.signal,
      });
      telemetryEndStage(requestId, "api_request_start");

      telemetryStartStage(requestId, "response_parsing");
      const data = await response.json();
      telemetryEndStage(requestId, "response_parsing");
      if (!response.ok) throw new Error(data?.error || "AI request failed.");
      telemetrySetMetadata(requestId, {
        mode: "ask",
        serverTimings: data?.debug?.timings ?? null,
        responseMode: data?.mode ?? data?.chat?.answer?.response_mode ?? null,
      });

      // ── Stale-response guard ────────────────────────────────────────────
      // If a newer voice turn has superseded this one (e.g. a pure greeting
      // arrived while this request was in flight, or a second mic session
      // accepted a new question), do NOT append the (now stale) AI answer.
      // The abort signal normally fires first, but on some browsers a fetch
      // can resolve just before AbortError propagates, so we verify the
      // epoch explicitly. Also confirm the controller is still active so a
      // stop-activity call followed by a new turn behaves correctly.
      const stillActive =
        askAbortRef.current === controller && voiceTurnEpochRef.current === epoch;
      if (!stillActive) return;

      const answer = normalizeAnswer({
        ...(data.chat?.answer ?? {}),
        response_mode: data.mode ?? data.chat?.answer?.response_mode,
      });
      const answerId = typeof data.chat?.id === "string" ? data.chat.id : undefined;

      // Re-verify after resolve/json — a concurrent turn could have advanced
      // the epoch during the await before the stale check above ran. The
      // controller check above already short-circuits the common case.
      if (askAbortRef.current !== controller || voiceTurnEpochRef.current !== epoch) {
        return;
      }

      if (answerId && !loadedAssistantIdsRef.current.has(answerId)) {
        loadedAssistantIdsRef.current.add(answerId);
        setTurns((current) => [
          ...current,
          {
            id: `${answerId}-assistant`,
            role: "assistant",
            answer,
            answerId,
          },
        ]);
      } else if (!answerId) {
        setTurns((current) => [
          ...current,
          {
            id: nextTurnId("assistant"),
            role: "assistant",
            answer,
          },
        ]);
      }

      telemetryStartStage(requestId, "ui_render");
      window.requestAnimationFrame(() => {
        telemetryEndStage(requestId, "ui_render");
        telemetryEndRequest(requestId, { completed: true });
      });
      endTelemetryInFinally = false;

      const spokenAnswer = stripUrlsForSpeech(answerToSpokenText(answer));
      if (spokenAnswer) speakText(spokenAnswer);

      void maybeAutoTitleConversation(activeConversation.id, displayQuestion);
      void touchConversationUpdatedAt(activeConversation.id);
    } catch (err) {
      if (!isAbortError(err) && voiceTurnEpochRef.current === epoch) {
        setError(err instanceof Error ? err.message : "AI request failed. Please try again.");
      }
    } finally {
      if (askAbortRef.current === controller && voiceTurnEpochRef.current === epoch) {
        askAbortRef.current = null;
        setLoading(false);
      }
      if (endTelemetryInFinally) {
        telemetryEndRequest(requestId, { completed: false });
      }
    }
  }

  async function searchWeb(displayQuestion: string, query: string) {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setError("");
    setNotice("");
    setActiveSearchQuery(query);
    setSearching(true);
    setTurns((current) => [
      ...current,
      { id: nextTurnId("user"), role: "user", question: displayQuestion },
    ]);

    try {
      const result = await runWebSearch(query, { signal: controller.signal });
      setTurns((current) => [
        ...current,
        {
          id: nextTurnId("web"),
          role: "assistant",
          webSearch: result,
          webQuery: query,
        },
      ]);

      const spokenAnswer = stripUrlsForSpeech(result.concise_answer);
      if (spokenAnswer) speakText(spokenAnswer);
    } catch (caught) {
      if (!isAbortError(caught)) {
        setError(caught instanceof Error ? caught.message : "Web search failed. Please try again.");
      }
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setSearching(false);
        setActiveSearchQuery("");
      }
    }
  }

  function stopWebSearch() {
    const active = searchAbortRef.current;
    if (!active) return;
    searchAbortRef.current = null;
    active.abort();
    setSearching(false);
    setActiveSearchQuery("");
    const message = "Web search stopped.";
    setNotice(message);
    addSystemTurn(message);
  }

  async function researchDeeply(displayQuestion: string, query: string) {
    researchAbortRef.current?.abort();
    const controller = new AbortController();
    researchAbortRef.current = controller;

    setError("");
    setNotice("");
    setActiveResearchQuery(query);
    setResearchProgressIndex(0);
    setResearching(true);
    setTurns((current) => [
      ...current,
      { id: nextTurnId("user"), role: "user", question: displayQuestion },
    ]);

    try {
      const report = await runDeepResearch(query, { signal: controller.signal });
      setTurns((current) => [
        ...current,
        {
          id: nextTurnId("research"),
          role: "assistant",
          researchReport: report,
          researchQuery: query,
        },
      ]);

      const spokenSummary = stripUrlsForSpeech(report.executive_summary);
      if (spokenSummary) speakText(spokenSummary);
    } catch (caught) {
      if (!isAbortError(caught)) {
        setError(caught instanceof Error ? caught.message : "Deep research failed. Please try again.");
      }
    } finally {
      if (researchAbortRef.current === controller) {
        researchAbortRef.current = null;
        setResearching(false);
        setActiveResearchQuery("");
        setResearchProgressIndex(0);
      }
    }
  }

  function stopDeepResearch() {
    const active = researchAbortRef.current;
    if (!active) return;
    researchAbortRef.current = null;
    active.abort();
    setResearching(false);
    setActiveResearchQuery("");
    setResearchProgressIndex(0);
    const message = "Deep research stopped.";
    setNotice(message);
    addSystemTurn(message);
  }

  async function generateDiagram(displayQuestion: string, request: DiagramRequest, sourceLabel: string) {
    diagramAbortRef.current?.abort();
    const controller = new AbortController();
    diagramAbortRef.current = controller;

    setError("");
    setNotice("");
    setActiveDiagramPrompt(sourceLabel);
    setVisualizing(true);
    setTurns((current) => [
      ...current,
      { id: nextTurnId("user"), role: "user", question: displayQuestion },
    ]);

    try {
      const diagram = await runDiagramGeneration(request, { signal: controller.signal });
      setTurns((current) => [
        ...current,
        {
          id: nextTurnId("diagram"),
          role: "assistant",
          diagram,
          diagramRequest: request,
          diagramPrompt: displayQuestion,
        },
      ]);

      const spokenExplanation = stripUrlsForSpeech(diagram.explanation);
      if (spokenExplanation) speakText(spokenExplanation);
    } catch (caught) {
      if (!isAbortError(caught)) {
        setError(caught instanceof Error ? caught.message : "Diagram generation failed. Please try again.");
      }
    } finally {
      if (diagramAbortRef.current === controller) {
        diagramAbortRef.current = null;
        setVisualizing(false);
        setActiveDiagramPrompt("");
      }
    }
  }

  function stopDiagramGeneration() {
    const active = diagramAbortRef.current;
    if (!active) return;
    diagramAbortRef.current = null;
    active.abort();
    setVisualizing(false);
    setActiveDiagramPrompt("");
    const message = "Diagram generation stopped.";
    setNotice(message);
    addSystemTurn(message);
  }

  function stopActiveRequest() {
    let stopped = false;

    if (askAbortRef.current) {
      askAbortRef.current.abort();
      askAbortRef.current = null;
      setLoading(false);
      stopped = true;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
      setSearching(false);
      setActiveSearchQuery("");
      stopped = true;
    }
    if (researchAbortRef.current) {
      researchAbortRef.current.abort();
      researchAbortRef.current = null;
      setResearching(false);
      setActiveResearchQuery("");
      setResearchProgressIndex(0);
      stopped = true;
    }
    if (diagramAbortRef.current) {
      diagramAbortRef.current.abort();
      diagramAbortRef.current = null;
      setVisualizing(false);
      setActiveDiagramPrompt("");
      stopped = true;
    }

    if (stopped) {
      const message = "Current StudyPilot action stopped.";
      setNotice(message);
      addSystemTurn(message);
    }
  }

  function addSystemTurn(text: string) {
    setTurns((current) => [...current, { id: nextTurnId("system"), role: "system", text }]);
  }

  function selectedNotesLanguage() {
    if (activeLanguage.code === "te-IN") return "telugu";
    if (activeLanguage.code === "hi-IN") return "hindi";
    if (activeLanguage.code === "ta-IN") return "tamil";
    if (activeLanguage.code === "kn-IN") return "kannada";
    if (activeLanguage.code === "ml-IN") return "malayalam";
    if (activeLanguage.code === "en-IN" || activeLanguage.code === "en-US") return "english";
    return "auto";
  }

  function latestAnswerTurn() {
    return [...turns].reverse().find((turn) => turn.role === "assistant" && turn.answer);
  }

  function latestRealUserTopic() {
    for (const turn of [...turns].reverse()) {
      if (turn.role === "assistant") {
        if (turn.researchReport) {
          return turn.researchQuery?.trim() || turn.researchReport.research_question.trim();
        }
        if (turn.webSearch) return turn.webQuery?.trim() || turn.webSearch.query.trim();
        continue;
      }
      if (turn.role !== "user" || !turn.question?.trim()) continue;
      const resolved = resolveVoiceCommand(turn.question);
      if (resolved.kind === "question" && resolved.question.trim()) return resolved.question.trim();
      if (resolved.kind === "command" && resolved.outcome.kind === "web_search") {
        const query = resolved.outcome.query.trim();
        if (!isContextualWebQuery(query) && hasMeaningfulQuery(query)) return query;
      }
      if (resolved.kind === "command" && resolved.outcome.kind === "deep_research") {
        const query = resolved.outcome.query.trim();
        if (!isContextualResearchQuery(query) && hasMeaningfulQuery(query)) return query;
      }
    }
    return "";
  }

  function latestAssistantDiagramSource(diagramType: VoiceDiagramType): {
    request: DiagramRequest;
    label: string;
  } | null {
    for (const turn of [...turns].reverse()) {
      if (turn.role !== "assistant") continue;

      if (turn.researchReport) {
        const sourceText = boundedDiagramSourceText(deepResearchToText(turn.researchReport));
        if (sourceText) {
          return {
            request: { diagramType, sourceType: "deep_research", sourceText },
            label: turn.researchQuery?.trim() || turn.researchReport.research_question,
          };
        }
      }

      if (turn.webSearch) {
        const sourceText = boundedDiagramSourceText(
          `Web search query: ${turn.webQuery ?? turn.webSearch.query}\n\nAnswer:\n${turn.webSearch.concise_answer}`,
        );
        if (sourceText) {
          return {
            request: { diagramType, sourceType: "web_search", sourceText },
            label: turn.webQuery?.trim() || turn.webSearch.query,
          };
        }
      }

      if (turn.answer && turn.answerId) {
        return {
          request: { diagramType, sourceType: "answer", answerId: turn.answerId },
          label: "the latest saved Voice Tutor answer",
        };
      }
    }

    return null;
  }

  function resolveDiagramRequest({
    diagramType,
    source,
    topic,
  }: {
    diagramType: VoiceDiagramType;
    source: VoiceDiagramSourceIntent;
    topic?: string;
  }): { request: DiagramRequest; label: string } | { error: string } {
    if (source === "topic") {
      const selectedTopic = topic?.trim() ?? "";
      if (!hasMeaningfulQuery(selectedTopic)) return { error: "Please name a topic for the diagram." };
      return {
        request: { diagramType, sourceType: "topic", topic: selectedTopic },
        label: selectedTopic,
      };
    }

    if (source === "file") {
      if (!contextFileForCommands) return { error: "No uploaded file is selected for this diagram." };
      return {
        request: { diagramType, sourceType: "file", fileId: contextFileForCommands },
        label: contextFileNameForCommands ?? "the selected uploaded file",
      };
    }

    if (source === "summary") {
      if (!contextFileForCommands) return { error: "No file is selected, so StudyPilot cannot find its saved summary." };
      return {
        request: { diagramType, sourceType: "summary", fileId: contextFileForCommands },
        label: contextFileNameForCommands ? `the saved summary for ${contextFileNameForCommands}` : "the saved summary for the selected file",
      };
    }

    const latestAssistant = latestAssistantDiagramSource(diagramType);
    if (latestAssistant) return latestAssistant;

    if (source === "auto" && contextFileForCommands) {
      return {
        request: { diagramType, sourceType: "file", fileId: contextFileForCommands },
        label: contextFileNameForCommands ?? "the selected uploaded file",
      };
    }

    return {
      error: source === "answer"
        ? "There is no saved answer, web result, or research report to diagram yet. Ask a question first."
        : "Please ask a question, select a file, or name a topic before generating a diagram.",
    };
  }

  async function prepareNotesPreview(source: VoiceNoteSource, style: VoiceNoteStyle) {
    const latestAnswer = latestAnswerTurn();
    const useAnswer = source === "answer" || (source === "auto" && Boolean(latestAnswer?.answerId));
    const payload: Record<string, string> = {
      style,
      language: selectedNotesLanguage(),
    };

    if (useAnswer) {
      if (!latestAnswer?.answerId) {
        const message = "There is no saved Voice Tutor answer to turn into notes yet. Ask a question first.";
        setNotice(message);
        addSystemTurn(message);
        return;
      }
      payload.sourceType = "answer";
      payload.answerId = latestAnswer.answerId;
      if (contextFileForCommands) payload.fileId = contextFileForCommands;
    } else if (source === "summary") {
      if (!contextFileForCommands) {
        const message = "No file is selected, so StudyPilot cannot find a saved summary for this command.";
        setNotice(message);
        addSystemTurn(message);
        return;
      }
      payload.sourceType = "summary";
      payload.fileId = contextFileForCommands;
    } else {
      if (!contextFileForCommands) {
        const message = "Ask a question or select an uploaded file before creating notes.";
        setNotice(message);
        addSystemTurn(message);
        return;
      }
      payload.sourceType = "file";
      payload.fileId = contextFileForCommands;
    }

    setNotesLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/notes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a notes preview.");
      const generatedDraft = data.draft ?? data.note;
      if (!generatedDraft) throw new Error("StudyPilot returned an invalid notes preview.");

      setNoteDraft(adaptStudyNoteRow(generatedDraft));
      addSystemTurn("Your editable notes preview is ready. Review it before saving or downloading.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create a notes preview.";
      setNotice(message);
      addSystemTurn(message);
    } finally {
      setNotesLoading(false);
    }
  }

  async function savePreparedNote() {
    if (!noteDraft) {
      const message = "Create a notes preview first. Nothing was saved.";
      setNotice(message);
      addSystemTurn(message);
      return;
    }

    const updating = Boolean(noteDraft.id);
    const confirmed = window.confirm(
      updating
        ? "Save these edits to the existing note? This will replace its current title and content."
        : "Save this prepared note to your StudyPilot library?",
    );
    if (!confirmed) {
      addSystemTurn("Save cancelled. Your notes preview is still open.");
      return;
    }

    setNotesLoading(true);
    setError("");
    setNotice("");
    try {
      const saved = noteDraft.id
        ? await updateStudyNote(noteDraft.id, noteDraft)
        : await createStudyNote(noteDraft);
      setNoteDraft(saved);
      addSystemTurn("Notes saved to your StudyPilot library.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not save the prepared note.";
      setNotice(message);
      addSystemTurn(`${message} Your prepared note is still open.`);
    } finally {
      setNotesLoading(false);
    }
  }

  function exportFormatForVoice(format: VoiceNoteExportFormat): NoteExportFormat {
    return format === "text" ? "txt" : format;
  }

  async function downloadPreparedNote(format: VoiceNoteExportFormat) {
    if (!noteDraft) {
      const message = "Create a notes preview first. Nothing was downloaded.";
      setNotice(message);
      addSystemTurn(message);
      return;
    }

    setNotesLoading(true);
    setError("");
    setNotice("");
    try {
      const filename = await exportStudyNote(noteDraft, exportFormatForVoice(format));
      addSystemTurn(`${filename} is ready.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not download the prepared note.";
      setNotice(message);
      addSystemTurn(`${message} Your prepared note is still open.`);
    } finally {
      setNotesLoading(false);
    }
  }

  // Resolve recognized text -> command, navigation, or free-form question.
  async function handleSpokenText(spoken: string) {
    const resolved = resolveVoiceCommand(spoken);

    if (resolved.kind === "blocked") {
      setTurns((current) => [...current, { id: nextTurnId("system"), role: "system", text: resolved.message }]);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "navigate") {
      const destination = resolved.outcome.href;
      setTurns((current) => [
        ...current,
        { id: nextTurnId("user"), role: "user", question: spoken },
        { id: nextTurnId("system"), role: "system", text: resolved.outcome.message },
      ]);
      // Brief delay so the user sees the confirmation before navigation.
      window.setTimeout(() => {
        window.location.href = destination;
      }, 600);
      return;
    }

    // A greeting/social phrase — show inline reply, no API call.
    if (resolved.kind === "command" && resolved.outcome.kind === "greeting") {
      // A pure greeting supersedes any in-flight /api/ai/ask request: bump the
      // voice-turn epoch and abort the active controller so a late AI response
      // carrying old PDF/previous-answer content cannot append after this
      // short greeting reply. Clearing loading is safe here because no other
      // turn is now driving that flag.
      invalidateVoiceTurnEpoch();
      abortActiveAskRequest();

      const { reply } = resolved.outcome;
      setTurns((current) => [
        ...current,
        { id: nextTurnId("user"), role: "user", question: spoken },
        { id: nextTurnId("system"), role: "system", text: reply },
      ]);
      if (synthesisSupported) speakText(reply);
      return;
    }

    // A documented "ask" command resolves to a fixed study question.
    if (resolved.kind === "command" && resolved.outcome.kind === "ask") {
      await askStudyPilot(spoken);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "web_search") {
      let query = resolved.outcome.query.trim();
      if (isContextualWebQuery(query)) query = latestRealUserTopic();

      if (!hasMeaningfulQuery(query)) {
        const message = "Please name a topic to search for. I do not have an earlier question to use yet.";
        setNotice(message);
        setTurns((current) => [
          ...current,
          { id: nextTurnId("user"), role: "user", question: spoken },
          { id: nextTurnId("system"), role: "system", text: message },
        ]);
        return;
      }

      await searchWeb(spoken, query);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "deep_research") {
      let query = resolved.outcome.query.trim();
      if (isContextualResearchQuery(query)) query = latestRealUserTopic();

      if (!hasMeaningfulQuery(query)) {
        const message = "Please name a focused topic to research. I do not have an earlier topic to use yet.";
        setNotice(message);
        setTurns((current) => [
          ...current,
          { id: nextTurnId("user"), role: "user", question: spoken },
          { id: nextTurnId("system"), role: "system", text: message },
        ]);
        return;
      }

      await researchDeeply(spoken, query);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "diagram") {
      const diagramSource = resolveDiagramRequest({
        diagramType: resolved.outcome.diagramType,
        source: resolved.outcome.source,
        topic: resolved.outcome.topic,
      });

      if ("error" in diagramSource) {
        setNotice(diagramSource.error);
        setTurns((current) => [
          ...current,
          { id: nextTurnId("user"), role: "user", question: spoken },
          { id: nextTurnId("system"), role: "system", text: diagramSource.error },
        ]);
        return;
      }

      await generateDiagram(spoken, diagramSource.request, diagramSource.label);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "notes") {
      setTurns((current) => [
        ...current,
        { id: nextTurnId("user"), role: "user", question: spoken },
        { id: nextTurnId("system"), role: "system", text: resolved.outcome.message },
      ]);

      if (resolved.outcome.action === "create") {
        await prepareNotesPreview(resolved.outcome.source ?? "auto", resolved.outcome.style ?? "standard");
      } else if (resolved.outcome.action === "save") {
        await savePreparedNote();
      } else if (resolved.outcome.format) {
        await downloadPreparedNote(resolved.outcome.format);
      }
      return;
    }

    // Anything else is a free-form study question -> chat API as-is.
    if (resolved.kind === "question") {
      const freeQuestion = resolved.question.trim();
      if (freeQuestion) await askStudyPilot(spoken);
    }
  }

  // -------------------------------------------------------------------------
  // Microphone: start / stop listening
  // -------------------------------------------------------------------------

  function clearSilenceTimer() {
    if (silenceTimerRef.current !== null) {
      silenceTimerRef.current.dispose();
      silenceTimerRef.current = null;
    }
  }

  function stopListening() {
    clearSilenceTimer();
    recognitionCleanupRef.current?.();
    recognitionCleanupRef.current = null;
    // Invalidate this recognition session so a duplicate/late onend cannot
    // dispatch handleSpokenText after a manual stop.
    recognitionSessionRef.current = null;
    const active = recognitionRef.current;
    if (active) {
      try {
        active.stop();
      } catch {
        // Ignore stop errors; the recognition may already have ended.
      }
    }
    recognitionRef.current = null;
    setListening(false);
  }

  function startListening() {
    const currentRequestId = telemetryStartRequest();
    requestIdRef.current = currentRequestId;
    setError("");
    setNotice("");

    if (speaking) {
      stopSpeaking();
    }

    if (loading || notesLoading || searching || researching || visualizing) {
      setNotice("Please wait for the current StudyPilot action to finish before listening again.");
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge, or type your question in AI Chat instead.");
      return;
    }

    // Never more than one recognition session at a time (no always-listening).
    if (recognitionRef.current) {
      stopListening();
    }

    setInterim("");

    const recognition = new SpeechRecognition();
    // Chrome is more reliable with an explicit locale. Auto follows the
    // browser language instead of assigning an empty SpeechRecognition lang.
    recognition.lang = activeLanguage.recognitionLocale || window.navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    // ── Per-session guard ──────────────────────────────────────────────────
    // A unique token identifies this mic instance. onend checks it before
    // dispatching handleSpokenText so a duplicate onend (or one from a stale,
    // prior session that fired after a new session already started) is
    // ignored. A handled-set, scoped to this single session, blocks the same
    // normalized final transcript from being processed twice. The set lives
    // only here, so a user may legitimately say the same phrase again later
    // in a new mic session — it is never globally blocked.
    const sessionToken = (recognitionSessionRef.current?.token ?? 0) + 1;
    const handled = new Set<string>();
    recognitionSessionRef.current = { token: sessionToken, handled };

    let finalTranscript = "";
    let latestTranscript = "";
    let recognitionHadError = false;
    let hasDispatchedFinal = false;

    const silenceTimer = new RecordingSilenceTimer({
      silenceMs: VOICE_RECORDING_SILENCE_MS,
      onSilence: () => {
        if (recognitionRef.current !== recognition) return;
        try {
          recognition.stop();
        } catch {
          // Ignore stop errors; the browser may have already ended.
        }
      },
    });
    silenceTimerRef.current = silenceTimer;

    function cleanupRecognitionListeners() {
      silenceTimer.dispose();
      if (silenceTimerRef.current === silenceTimer) silenceTimerRef.current = null;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onaudiostart = null;
      recognition.onaudioend = null;
      recognition.onsoundstart = null;
      recognition.onsoundend = null;
      recognition.onspeechstart = null;
      recognition.onspeechend = null;
      if (recognitionCleanupRef.current === cleanupRecognitionListeners) {
        recognitionCleanupRef.current = null;
      }
    }
    recognitionCleanupRef.current = cleanupRecognitionListeners;

    recognition.onstart = () => {
      telemetryStartStage(currentRequestId, "speech_start");
      setListening(true);
      silenceTimer.start();
    };

    recognition.onaudiostart = () => silenceTimer.speechActivity();
    recognition.onsoundstart = () => silenceTimer.speechStart();
    recognition.onspeechstart = () => {
      telemetryEndStage(currentRequestId, "speech_start");
      telemetryStartStage(currentRequestId, "speech_end");
      silenceTimer.speechStart();
    };
    recognition.onspeechend = () => {
      telemetryEndStage(currentRequestId, "speech_end");
      telemetryStartStage(currentRequestId, "final_transcript");
      silenceTimer.speechEnd();
    };
    recognition.onsoundend = () => silenceTimer.speechEnd();
    recognition.onaudioend = () => {
      if (latestTranscript) silenceTimer.speechEnd();
      else silenceTimer.speechActivity();
    };

    recognition.onresult = (event) => {
      let interimText = "";
      const resultIndex = event.resultIndex ?? 0;
      for (let index = resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        } else {
          interimText = `${interimText} ${transcript}`.trim();
        }
      }
      latestTranscript = [finalTranscript, interimText].filter(Boolean).join(" ").trim();
      // Interim transcripts are shown live but never persisted — only the
      // final transcript is dispatched onend.
      setInterim(latestTranscript);
      if (latestTranscript) silenceTimer.speechActivity();
    };

    recognition.onerror = (event) => {
      cleanupRecognitionListeners();
      recognitionHadError = true;
      const code = event.error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        setError("Microphone access was blocked. Allow microphone permission in your browser, then try again.");
      } else if (code === "no-speech") {
        setError("I did not hear anything. Tap Start listening and speak again.");
      } else if (code === "audio-capture") {
        setError("No microphone was found. Connect a microphone and try again.");
      } else if (code === "network") {
        setError("Speech recognition failed because of a network issue. Check your connection and try again.");
      } else {
        setError("Speech recognition stopped. Please try again.");
      }
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
      // Drop the session token so a subsequent onend for this session is
      // not mistaken for a valid dispatch.
      recognitionSessionRef.current = null;
    };

    recognition.onend = () => {
      cleanupRecognitionListeners();
      setListening(false);
      recognitionRef.current = null;

      // Per-session guard: ignore a duplicate onend (some browsers fire it
      // twice for a single session) or an onend from a prior session that
      // fired after a new mic session began. Verifying the token ensures only
      // the live session's final dispatch runs.
      const session = recognitionSessionRef.current;
      if (!session || session.token !== sessionToken || recognitionHadError) {
        return;
      }

      // Dispatch handleSpokenText exactly once per session. A browser that
      // calls onend a second time for the same "hi" cannot append a second
      // greeting turn, and a brand-new session gets a fresh session object so
      // the same words spoken legitimately later are not globally blocked.
      if (hasDispatchedFinal) {
        return;
      }
      hasDispatchedFinal = true;

      const spoken = finalTranscript.trim();
      setInterim("");
      if (spoken) {
        telemetryEndStage(currentRequestId, "final_transcript");
        // Final-transcript duplicate protection within this single session:
        // if a browser emits two final events for identical text, the second
        // normalized form already exists in `handled` and is skipped. The set
        // is per-session, so this never blocks the same phrase in a later
        // mic session.
        const dedupKey = normalizeTranscriptForDedup(spoken);
        if (dedupKey && !handled.has(dedupKey)) {
          handled.add(dedupKey);
          void handleSpokenText(spoken);
        }
      } else {
        setError("I did not catch that. Tap Start listening and try again.");
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      cleanupRecognitionListeners();
      setError("Could not start the microphone. Please try again.");
      setListening(false);
      recognitionRef.current = null;
      recognitionSessionRef.current = null;
    }
  }

  // -------------------------------------------------------------------------
  // Speech synthesis: read aloud / replay / stop speaking
  // -------------------------------------------------------------------------

  function speakText(text: string) {
    if (!isSpeechSynthesisSupported()) {
      setError("Read aloud is not supported in this browser.");
      return;
    }
    if (!text.trim()) return;

    const requestId = requestIdRef.current;
    telemetryStartStage(requestId, "tts_start");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoiceForLocale(activeLanguage.speechLocale);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (activeLanguage.speechLocale) {
      utterance.lang = activeLanguage.speechLocale;
    }
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    lastSpokenTextRef.current = text;
    setHasSpokenText(true);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
    telemetryEndStage(requestId, "tts_start");
  }

  function readAloud() {
    const lastAnswer = [...turns]
      .reverse()
      .find((turn) => turn.role === "assistant" && (turn.answer || turn.webSearch || turn.researchReport || turn.diagram));
    if (!lastAnswer) {
      setNotice("There is no answer to read aloud yet. Ask a question first.");
      return;
    }
    if (lastAnswer.diagram) {
      speakText(stripUrlsForSpeech(lastAnswer.diagram.explanation));
    } else if (lastAnswer.researchReport) {
      speakText(stripUrlsForSpeech(lastAnswer.researchReport.executive_summary));
    } else if (lastAnswer.webSearch) {
      speakText(stripUrlsForSpeech(lastAnswer.webSearch.concise_answer));
    } else if (lastAnswer.answer) {
      speakText(answerToSpokenText(lastAnswer.answer));
    }
  }

  function readFullResearchReport(report: DeepResearchReportValue) {
    speakText(stripUrlsForSpeech(deepResearchToText(report)));
  }

  function replay() {
    if (!lastSpokenTextRef.current) {
      setNotice("Nothing to replay yet. Use Read aloud first.");
      return;
    }
    speakText(lastSpokenTextRef.current);
  }

  function stopSpeaking() {
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const micBlocked = !recognitionSupported;
  const ttsBlocked = !synthesisSupported;
  const lastSpeakableAssistant = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant" && (turn.answer || turn.webSearch || turn.researchReport || turn.diagram));
  const lastStudyAssistant = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.answer);

  // Orb visual state is driven by real recognition, search, AI, and speech work.
  const orbState: VoiceOrbState = error
    ? "error"
    : listening
      ? "listening"
      : visualizing
        ? "visualizing"
        : researching
          ? "researching"
          : searching
            ? "searching"
            : loading || notesLoading
              ? "loading"
              : speaking
                ? "speaking"
                : "idle";

  const stateLabel = error
    ? "Error"
    : listening
      ? "Listening"
      : visualizing
        ? "Visualizing"
        : researching
          ? "Researching"
          : searching
            ? "Searching"
            : loading || notesLoading
              ? "Thinking"
              : speaking
                ? "Speaking"
                : micBlocked
                  ? "Microphone unavailable"
                  : "Ready";

  const stateSublabel = error
    ? "Something went wrong. Try again."
    : listening
      ? "Speak now, then tap Stop listening."
      : visualizing
        ? activeDiagramPrompt ? `Generating a grounded diagram from ${activeDiagramPrompt}...` : "Generating your diagram..."
        : researching
          ? activeResearchQuery
            ? `${RESEARCH_PROGRESS_CUES[researchProgressIndex]} for “${activeResearchQuery}”...`
            : `${RESEARCH_PROGRESS_CUES[researchProgressIndex]}...`
          : searching
            ? activeSearchQuery ? `Searching the web for “${activeSearchQuery}”...` : "Searching the web..."
            : loading || notesLoading
              ? notesLoading ? "Preparing your notes securely..." : "Thinking with your study context..."
              : speaking
                ? "Reading the answer aloud."
                : micBlocked
                  ? "Use a Chromium browser for voice input."
                  : "Tap Start listening, then ask a question or say a command.";

  const working = loading || notesLoading || searching || researching || visualizing;
  const activeStage = listening ? 1 : working ? 2 : speaking ? 3 : 0;
  const microphoneLabel = micBlocked ? "Unavailable" : listening ? "Listening" : "Ready";
  const controlButtonClass = "inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md border border-white/12 bg-[#080f1e]/80 px-3 text-sm font-semibold text-slate-200 transition hover:border-emerald-300/25 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex min-w-0 items-center gap-2 self-start rounded-md border border-white/10 bg-[#09111f]/80 px-3 py-2 text-xs text-slate-400">
          <IconFileText size={15} className="shrink-0 text-slate-300" />
          <span className="shrink-0">Active context</span>
          <span className="truncate font-semibold text-emerald-300">{activeContextText}</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {conversationId ? (
            <Link
              href={`/chat?conversationId=${encodeURIComponent(conversationId)}`}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            >
              <IconChat size={14} />
              Return to AI Chat
            </Link>
          ) : null}

        <div className="flex w-full items-center justify-between gap-4 rounded-lg border border-white/10 bg-[#09111f]/90 px-4 py-3 shadow-lg shadow-black/20 sm:w-56">
          <div>
            <p className="text-xs text-slate-400">Microphone</p>
            <p className="mt-1 inline-flex items-center gap-2 text-xs font-semibold text-slate-200">
              <span className={`h-2 w-2 rounded-full ${micBlocked ? "bg-amber-400" : listening ? "animate-pulse bg-red-400" : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"}`} />
              {microphoneLabel}
            </p>
          </div>
          <div className="flex h-8 items-center gap-1" aria-hidden="true">
            {[9, 15, 22, 30, 20, 27, 16, 24, 13].map((height, index) => (
              <span
                key={`${height}:${index}`}
                className="block w-0.5 rounded-full bg-emerald-300/70"
                style={{
                  height,
                  ...(listening ? { "--_delay": `${index * 0.06}s`, animation: "var(--anim-voice-orb-bar-mic)" } : {}),
                  opacity: micBlocked ? 0.25 : 1,
                } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-lg border border-emerald-300/20 bg-[#07101d] shadow-[0_18px_70px_rgba(0,0,0,0.28)]">
        <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(45,212,191,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.035)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative grid min-h-[350px] lg:grid-cols-[310px_minmax(380px,1fr)_250px]">
          <div className="flex flex-col justify-between border-b border-white/8 p-5 lg:border-b-0 lg:border-r lg:p-6">
            <div>
              <p className="text-sm text-slate-400">Voice assistant</p>
              <div className="mt-3 flex items-center gap-3" aria-live="polite">
                <span className={`h-3 w-3 rounded-full ${error ? "bg-amber-400" : listening ? "animate-pulse bg-red-400" : "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.75)]"}`} />
                <p className="text-2xl font-bold text-white">{stateLabel}</p>
              </div>
              <p className="mt-3 max-w-[250px] text-sm leading-6 text-slate-400">{stateSublabel}</p>
            </div>

            <div className="mt-6">
              <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-white/10 bg-[#07101c]/90">
                {[
                  { label: "Ready", icon: <IconCheck size={16} /> },
                  { label: "Listening", icon: <IconMic size={16} /> },
                  { label: "Thinking", icon: <IconBrain size={16} /> },
                  { label: "Speaking", icon: <IconVolume size={16} /> },
                ].map((stage, index) => (
                  <div
                    key={stage.label}
                    className={`grid min-h-16 place-items-center gap-1 border-r border-white/8 px-1 py-2 text-center last:border-r-0 ${activeStage === index ? "bg-emerald-400/15 text-emerald-200" : index < activeStage ? "text-emerald-300/70" : "text-slate-500"}`}
                  >
                    {stage.icon}
                    <span className="text-[10px] font-semibold">{stage.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-md border border-white/8 bg-white/[0.025] px-3 py-2.5 text-xs leading-5 text-slate-400">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-slate-500/50 text-[10px] font-bold text-slate-300">i</span>
                <span>I can help with explanations, summaries, concepts, web research, and diagrams.</span>
              </div>
            </div>
          </div>

          <div className="relative grid min-h-[330px] place-items-center overflow-hidden px-2 py-4 sm:px-5">
            <VoiceOrb state={orbState} ariaLabel={`Voice tutor is ${stateLabel.toLowerCase()}`} />
          </div>

          <div className="flex items-end border-t border-white/8 p-5 lg:border-l lg:border-t-0 lg:p-6">
            <label className="grid w-full gap-2 text-xs font-medium text-slate-300">
              <span className="uppercase text-slate-400">Speaking language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="h-11 w-full rounded-md border border-white/12 bg-[#080f1e] px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/10"
              >
                {VOICE_LANGUAGES.map((option) => (
                  <option key={option.code} value={option.code}>{option.label}</option>
                ))}
              </select>
              <span className="text-[11px] font-normal text-emerald-400">Voice output follows your selected language</span>
            </label>
          </div>
        </div>
      </section>

      <section className="grid gap-2 rounded-lg border border-white/10 bg-[#09111f]/80 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <button
          type="button"
          onClick={startListening}
          disabled={working || listening || micBlocked}
          className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-md bg-emerald-400 px-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <IconMic size={17} />
          {listening ? "Listening..." : "Start listening"}
        </button>
        <button
          type="button"
          onClick={listening ? stopListening : stopActiveRequest}
          disabled={!listening && !working}
          className={controlButtonClass}
        >
          <IconStop size={16} /> {listening ? "Stop listening" : "Stop activity"}
        </button>
        <button type="button" onClick={readAloud} disabled={ttsBlocked || !lastSpeakableAssistant || speaking || searching || researching || visualizing} className={controlButtonClass}>
          <IconVolume size={17} /> Read aloud
        </button>
        <button type="button" onClick={replay} disabled={ttsBlocked || !hasSpokenText || speaking || searching || researching || visualizing} className={controlButtonClass}>
          <IconRefresh size={16} /> Replay
        </button>
        <button type="button" onClick={stopSpeaking} disabled={!speaking} className={`${controlButtonClass} border-red-300/20 bg-red-300/[0.06] text-red-100 hover:border-red-300/35 hover:bg-red-300/10`}>
          <IconVolumeOff size={17} /> Stop speaking
        </button>
        <button
          type="button"
          onClick={() => void prepareNotesPreview("answer", "standard")}
          disabled={working || !lastStudyAssistant?.answerId}
          className={`${controlButtonClass} border-violet-300/20 text-violet-100 hover:border-violet-300/35`}
          data-testid="create-notes-from-voice-answer"
        >
          <IconFileText size={16} />
          {notesLoading ? "Preparing..." : "Create notes from answer"}
        </button>
      </section>

      {searching || researching || visualizing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-300/20 bg-sky-300/[0.06] px-4 py-3 text-sm text-sky-100">
          <span className="inline-flex items-center gap-2">
            {visualizing ? <IconImage size={16} /> : searching ? <IconSearch size={16} /> : <IconBrain size={16} />}
            {visualizing ? "Diagram generation is running" : researching ? "Deep research is running" : "Web search is running"}
          </span>
          <button
            type="button"
            onClick={visualizing ? stopDiagramGeneration : researching ? stopDeepResearch : stopWebSearch}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-sky-200/25 bg-sky-200/10 px-3 text-xs font-semibold hover:bg-sky-200/15"
          >
            <IconStop size={13} /> Stop activity
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#09111f]/65 px-4 py-3 text-xs leading-5 text-slate-400">
        <IconZap size={16} className="shrink-0 text-sky-300" />
        <span>For best results, speak clearly and wait for StudyPilot to finish speaking before asking another question.</span>
      </div>

      {interim || micBlocked || ttsBlocked || notice || error ? (
        <div className="grid gap-2" aria-live="polite">
          {interim ? <p className="rounded-md border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100">{interim}</p> : null}
          {micBlocked ? <p className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-6 text-amber-100">Your browser does not support speech recognition. StudyPilot voice input works best in Google Chrome or Microsoft Edge. You can still read answers aloud or use AI Chat.</p> : null}
          {ttsBlocked ? <p className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-6 text-amber-100">Your browser does not support text-to-speech. Voice questions and text answers remain available.</p> : null}
          {notice ? <p className="rounded-md border border-white/10 bg-white/5 p-3 text-xs leading-6 text-slate-300">{notice}</p> : null}
          {error ? <p className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs leading-6 text-red-200">{error}</p> : null}
        </div>
      ) : null}

      {noteDraft ? (
        <StudyNoteEditor
          key={noteDraft.id ?? noteDraft.metadata?.generated_at ?? "voice-note"}
          inline
          draft={noteDraft}
          onChange={setNoteDraft}
          onClose={() => setNoteDraft(null)}
          onSaved={(saved) => setNoteDraft(saved)}
          onDeleted={() => setNoteDraft(null)}
        />
      ) : null}

      {/* Conversation */}
      <section className="overflow-hidden rounded-lg border border-white/10 bg-[#09111f]/60">
        <header className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2">
            <IconClock size={16} className="text-slate-300" />
            <h2 className="text-sm font-semibold text-white">{conversationDisplayTitle(conversation)}</h2>
          </div>
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-slate-400">
            {turns.length} {turns.length === 1 ? "turn" : "turns"}
          </span>
        </header>
        <div className="grid gap-4 p-4">
        {!turns.length ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-center">
            <h2 className="text-lg font-bold text-white">Talk to StudyPilot</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Tap <span className="font-semibold text-emerald-200">Start listening</span>, then ask a question or say a command like &ldquo;give important notes&rdquo;. Answers are spoken aloud in the language you pick.
            </p>
          </div>
        ) : null}

        {turns.map((turn) => {
          if (turn.role === "user") {
            return (
              <article key={turn.id} className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-emerald-400 px-4 py-3 text-slate-950 shadow-xl shadow-emerald-950/20 sm:max-w-[80%]">
                <p className="break-words text-sm font-medium leading-6">{turn.question}</p>
              </article>
            );
          }
          if (turn.role === "system") {
            return (
              <article key={turn.id} className="max-w-[92%] rounded-2xl rounded-bl-md border border-sky-300/25 bg-sky-300/10 px-4 py-3 text-sky-100 shadow-xl shadow-black/15 sm:max-w-[88%]">
                <p className="break-words text-sm leading-6">{turn.text}</p>
              </article>
            );
          }
          if (turn.diagram) {
            const diagram = turn.diagram;
            const diagramRequest = turn.diagramRequest;
            return (
              <article key={turn.id} className="max-w-[100%] rounded-2xl rounded-bl-md border border-pink-300/20 bg-pink-300/[0.04] p-4 shadow-xl shadow-black/15 sm:max-w-[96%] sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-pink-300/25 bg-pink-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pink-200">
                    Generated diagram
                  </span>
                  <span className="break-words text-xs text-slate-400">
                    Voice request: {turn.diagramPrompt ?? turn.diagram.title}
                  </span>
                </div>
                <DiagramPreview
                  diagram={diagram}
                  onRegenerate={diagramRequest ? () => void generateDiagram(
                    turn.diagramPrompt ?? `Regenerate ${diagram.title}`,
                    diagramRequest,
                    diagram.title,
                  ) : undefined}
                  regenerating={visualizing}
                />
              </article>
            );
          }
          if (turn.researchReport) {
            return (
              <article key={turn.id} className="max-w-[100%] rounded-2xl rounded-bl-md border border-sky-300/20 bg-sky-300/[0.04] p-4 shadow-xl shadow-black/15 sm:max-w-[96%] sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-200">
                    Deep research
                  </span>
                  <span className="break-words text-xs text-slate-400">
                    Recognized topic: {turn.researchQuery ?? turn.researchReport.research_question}
                  </span>
                </div>
                <DeepResearchReportView report={turn.researchReport} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => readFullResearchReport(turn.researchReport!)}
                    disabled={ttsBlocked || speaking || searching || researching || visualizing}
                    className="h-9 rounded-md border border-sky-300/25 bg-sky-300/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Read full report
                  </button>
                </div>
              </article>
            );
          }
          if (turn.webSearch) {
            return (
              <article key={turn.id} className="max-w-[96%] rounded-2xl rounded-bl-md border border-violet-300/20 bg-violet-300/[0.055] p-4 shadow-xl shadow-black/15 sm:max-w-[92%] sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-200">
                    Web search
                  </span>
                  <span className="break-words text-xs text-slate-400">
                    Query: {turn.webQuery ?? turn.webSearch.query}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">
                  {turn.webSearch.concise_answer}
                </p>
                {turn.webSearch.web_citations.length ? (
                  <div className="mt-4">
                    <WebCitationList citations={turn.webSearch.web_citations} />
                  </div>
                ) : null}
              </article>
            );
          }
          const answer = turn.answer ?? {};
          const citations = normalizeSourceCitations(answer.source_citations);
          const hasCitations = citations.length > 0;
          const hasLegacyChips = !hasCitations && !!answer.source_chips?.length;
          return (
            <article key={turn.id} className="max-w-[96%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.045] p-4 shadow-xl shadow-black/15 sm:max-w-[92%] sm:p-5">
              {answer.response_mode === "offline_fallback" ? (
                <div className="mb-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-6 text-amber-100">
                  AI model limit reached. Showing an answer built from your saved study material.
                  {answer.fallback_notice ? <p className="mt-1 text-amber-100/80">{answer.fallback_notice}</p> : null}
                </div>
              ) : null}
              <div className="grid gap-3">
                <Section title="Short Answer">{answer.short_answer}</Section>
                <Section title="Simple Explanation">{answer.simple_explanation}</Section>
                {answer.step_by_step?.length ? (
                  <Section title="Step-by-Step">
                    <ol className="grid list-decimal gap-2 pl-4">
                      {answer.step_by_step.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </Section>
                ) : null}
                <Section title="Example">{answer.example}</Section>
                <Section title="Memory Line">{answer.memory_line}</Section>
                <Section title="Common Mistake">{answer.common_mistake}</Section>
                <Section title="Exam/Viva Answer">{answer.exam_viva_answer}</Section>
                <Section title="Practice Question">{answer.practice_question}</Section>
                <Section title="Next Step">{answer.next_step}</Section>
              </div>

              {/* Verified sources: structured citations preferred, legacy chips only when absent. */}
              {hasCitations ? (
                <div className="mt-4">
                  <SourceCitationChips citations={citations} />
                </div>
              ) : hasLegacyChips ? (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300/80">Sources</p>
                  <div className="flex flex-wrap gap-2">
                    {answer.source_chips!.map((source) => (
                      <span
                        key={`${source.type}:${source.id ?? source.label}`}
                        className="max-w-full break-words rounded-md border border-amber-200/20 bg-amber-200/10 px-2 py-1 text-xs font-medium text-amber-100"
                      >
                        {source.type}: {source.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}

        {loading || notesLoading || searching || researching || visualizing ? (
          <div className={`max-w-[92%] rounded-2xl rounded-bl-md border p-5 text-sm ${
            visualizing
              ? "border-pink-300/25 bg-pink-300/10 text-pink-100"
              : researching || searching
              ? "border-sky-300/25 bg-sky-300/10 text-sky-100"
              : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
          }`}>
            {visualizing ? (
              <div role="status" aria-live="polite">
                <p>{activeDiagramPrompt ? `Generating a diagram from ${activeDiagramPrompt}...` : "Generating your diagram..."}</p>
                <p className="mt-1 text-[11px] text-pink-100/65">Only approved Mermaid diagram types are rendered.</p>
              </div>
            ) : researching ? (
              <div role="status" aria-live="polite">
                <p>
                  {RESEARCH_PROGRESS_CUES[researchProgressIndex]}
                  {activeResearchQuery ? ` for “${activeResearchQuery}”` : ""}...
                </p>
                <p className="mt-1 text-[11px] text-sky-100/65">Bounded to 3–5 searches and at most 12 sources.</p>
              </div>
            ) : searching
              ? activeSearchQuery
                ? `Searching the web for “${activeSearchQuery}”...`
                : "Searching the web..."
              : notesLoading
                ? "Preparing an editable notes preview..."
                : "Thinking with your study context..."}
          </div>
        ) : null}
        </div>
      </section>

      {/* Command reference */}
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <h2 className="text-sm font-semibold text-white">Voice commands</h2>
        <p className="mt-1 text-xs text-slate-400">
          Try saying any of these. StudyPilot never deletes or changes your files by voice.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {VOICE_COMMANDS.map((command) => (
            <div key={command.id} className="rounded-md border border-white/10 bg-slate-950/55 p-3">
              <p className="text-sm font-semibold text-emerald-200">&ldquo;{command.label.toLowerCase()}&rdquo;</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{command.description}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
