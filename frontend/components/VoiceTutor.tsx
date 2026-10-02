"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { GeneratedImagePreview } from "./GeneratedImagePreview";
import {
  normalizeGeneratedImage,
  runImageGeneration,
  type GeneratedImageResult,
} from "@/frontend/lib/generatedImage";
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
import type { SupportedLanguageCode } from "@/shared/languages";
import { requestedStudyLanguage } from "@/shared/studyIntent";
import { measureIntent } from "@/frontend/lib/intentTiming";
import { SentenceStreamBuffer, splitSpeechText } from "@/frontend/lib/speech/voicePlayback";
import { consumeAskResponse, type AskStreamEvent } from "@/frontend/lib/aiStream";
import {
  inferJarvisTask,
  inferJarvisTopic,
  matchJarvisFiles,
  resolveJarvisRuntimeState,
  resolveJarvisControlIntent,
  type JarvisSessionState,
  type JarvisTask,
  type JarvisToolCall,
  type JarvisRuntimeState,
} from "@/frontend/lib/speech/jarvisAgent";
import { detectSpokenLanguage, voiceLocale } from "@/shared/voiceLanguage";
import { createConversationResult, readConversationResult, withConversationResult } from "@/shared/conversationResults";
import type { LearningState } from "@/shared/learningMemory";

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
  voice_turn?: {
    kind: "web_search" | "deep_research" | "diagram" | "generated_image" | "system";
    payload?: unknown;
    text?: string;
  };
  conversation_result?: unknown;
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
  generatedImage?: GeneratedImageResult;
  imagePrompt?: string;
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
  const short = answer.short_answer?.trim() ?? "";
  const explanation = answer.simple_explanation?.trim() ?? "";
  const distinctExplanation = explanation && (!short || !explanation.toLowerCase().includes(short.toLowerCase())) ? explanation : "";
  const main = [short, distinctExplanation, ...(answer.step_by_step ?? []).slice(0, 5)].filter(Boolean);
  return (main.length ? main : [answer.exam_viva_answer, answer.next_step].filter(Boolean)).join(". ");
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
    voice_turn: record.voice_turn && typeof record.voice_turn === "object"
      ? record.voice_turn as Answer["voice_turn"]
      : undefined,
  };
}

function recordToTurns(message: ConversationMessage): Turn[] {
  const answer = normalizeAnswer(message.answer);
  const persistedResult = readConversationResult(message.answer);
  const voiceTurn = persistedResult
    ? { kind: persistedResult.kind, payload: persistedResult.payload, text: persistedResult.text }
    : answer.voice_turn;
  const assistant: Turn = {
    id: `${message.id}-assistant`,
    role: "assistant",
    answer,
    answerId: message.id,
  };
  if (voiceTurn?.kind === "web_search" && voiceTurn.payload) {
    assistant.answer = undefined;
    assistant.webSearch = voiceTurn.payload as WebSearchAnswer;
    assistant.webQuery = assistant.webSearch.query;
  } else if (voiceTurn?.kind === "deep_research" && voiceTurn.payload) {
    assistant.answer = undefined;
    assistant.researchReport = voiceTurn.payload as DeepResearchReportValue;
    assistant.researchQuery = assistant.researchReport.research_question;
  } else if (voiceTurn?.kind === "diagram" && voiceTurn.payload) {
    const diagramPayload = voiceTurn.payload as {
      diagram?: DiagramResult;
    };
    assistant.answer = undefined;
    assistant.diagram = diagramPayload.diagram ?? voiceTurn.payload as DiagramResult;
    assistant.diagramPrompt = message.question;
  } else if (voiceTurn?.kind === "generated_image" && voiceTurn.payload) {
    const image = normalizeGeneratedImage(voiceTurn.payload);
    if (image) {
      assistant.answer = undefined;
      assistant.generatedImage = image;
      assistant.imagePrompt = message.question;
    }
  } else if (voiceTurn?.kind === "system") {
    assistant.answer = undefined;
    assistant.role = "system";
    assistant.text = voiceTurn.text ?? answer.short_answer;
  }
  return [
    {
      id: `${message.id}-user`,
      role: "user",
      question: message.question,
    },
    assistant,
  ];
}

function conversationDisplayTitle(conversation: Conversation | null): string {
  return conversation?.title?.trim() || "New chat";
}

function initialJarvisContext(messages: ConversationMessage[]): {
  topic: string;
  task: JarvisTask;
  assistantIntent: string;
  artifact: JarvisSessionState["currentArtifact"];
  toolCalls: JarvisToolCall[];
} {
  let topic = "";
  let task: JarvisTask = "idle";
  let assistantIntent = "";
  let artifact: JarvisSessionState["currentArtifact"] = null;

  const toolCalls = messages.flatMap((message): JarvisToolCall[] => {
    const normalized = normalizeAnswer(message.answer);
    const persisted = readConversationResult(message.answer);
    const voiceTurn = persisted ? { kind: persisted.kind } : normalized.voice_turn;
    const tool = voiceTurn?.kind === "web_search"
      ? "web_search"
      : voiceTurn?.kind === "deep_research"
        ? "deep_research"
        : voiceTurn?.kind === "diagram"
          ? "diagram"
          : voiceTurn?.kind === "generated_image"
            ? "image"
          : null;
    return tool ? [{ id: `restored-${message.id}`, tool, status: "success", createdAt: message.created_at }] : [];
  }).slice(-6);

  for (const message of [...messages].reverse()) {
    const normalized = normalizeAnswer(message.answer);
    const persisted = readConversationResult(message.answer);
    const voiceTurn = persisted ? { kind: persisted.kind } : normalized.voice_turn;
    if (!artifact) {
      if (voiceTurn?.kind === "diagram") artifact = "diagram";
      else if (voiceTurn?.kind === "generated_image") artifact = "image";
      else if (voiceTurn?.kind === "web_search") artifact = "web";
      else if (voiceTurn?.kind === "deep_research") artifact = "research";
      else if (!voiceTurn && message.answer) artifact = "answer";
    }
    if (!assistantIntent && artifact) assistantIntent = artifact;

    const control = resolveJarvisControlIntent(message.question);
    if (control) continue;
    const inferredTask = inferJarvisTask(message.question);
    if (task === "idle") task = inferredTask;
    if (!topic && (inferredTask === "ask" || inferredTask === "explain")) {
      const inferredTopic = inferJarvisTopic(message.question);
      if (inferredTopic && !["this", "this topic", "next", "continue"].includes(inferredTopic.toLocaleLowerCase())) {
        topic = inferredTopic;
      }
    }
    if (topic && task !== "idle" && artifact) break;
  }

  return { topic, task, assistantIntent, artifact, toolCalls };
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
  preferredLanguage,
}: {
  initialFileId?: string | null;
  initialFileName?: string | null;
  initialConversation?: Conversation | null;
  initialMessages?: ConversationMessage[];
  initialConversationError?: string | null;
  files?: FileOption[];
  notes?: NoteOption[];
  preferredLanguage: SupportedLanguageCode;
}) {
  const router = useRouter();
  const restoredAgentContext = initialJarvisContext(initialMessages);
  const persistedStudyState = initialConversation?.study_state ?? {};
  const [language, setLanguage] = useState<string>(initialConversation?.language_code ?? preferredLanguage);
  const [detectedLanguage, setDetectedLanguage] = useState<SupportedLanguageCode>(
    initialConversation?.language_code ?? preferredLanguage,
  );
  const [jarvisMode, setJarvisMode] = useState(false);
  const [jarvisPaused, setJarvisPaused] = useState(false);
  const [activeSubject, setActiveSubject] = useState(
    persistedStudyState.active_subject ?? initialFileName?.replace(/\.[^.]+$/u, "") ?? "",
  );
  const [activeTopic, setActiveTopic] = useState(persistedStudyState.active_topic ?? restoredAgentContext.topic);
  const [activeTask, setActiveTask] = useState<JarvisTask>((persistedStudyState.active_task as JarvisTask | undefined) ?? restoredAgentContext.task);
  const [lastAssistantIntent, setLastAssistantIntent] = useState(persistedStudyState.last_meaningful_intent ?? restoredAgentContext.assistantIntent);
  const [recentToolCalls, setRecentToolCalls] = useState<JarvisToolCall[]>(restoredAgentContext.toolCalls);
  const [currentArtifact, setCurrentArtifact] = useState<JarvisSessionState["currentArtifact"]>(restoredAgentContext.artifact);
  const [currentArtifactId, setCurrentArtifactId] = useState(
    persistedStudyState.current_artifact_id ?? persistedStudyState.last_artifact_id ?? "",
  );
  const [learningStates, setLearningStates] = useState<LearningState[]>([]);
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
  const [streaming, setStreaming] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState | "unsupported">("unsupported");
  const [diagnosticEvents, setDiagnosticEvents] = useState<Array<{ id: number; at: string; event: string; detail: string }>>([]);
  const [currentVoiceRequestId, setCurrentVoiceRequestId] = useState("");
  const [hasSpokenText, setHasSpokenText] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialConversationError ?? "");
  const [conversation, setConversation] = useState<Conversation | null>(initialConversation ?? null);
  const [conversationId, setConversationId] = useState<string | null>(initialConversation?.id ?? null);
  const inheritedFileIds = initialConversation?.active_file_ids?.length
    ? initialConversation.active_file_ids
    : initialFileId
      ? [initialFileId]
      : [];
  const [contextMode, setContextMode] = useState<ContextMode>(
    initialConversation?.context_mode ?? (inheritedFileIds.length ? "file" : "general"),
  );
  const [activeFileIds, setActiveFileIds] = useState<string[]>(inheritedFileIds);
  const [activeNoteIds, setActiveNoteIds] = useState<string[]>(initialConversation?.active_note_ids ?? []);
  const contextModeRef = useRef<ContextMode>(
    initialConversation?.context_mode ?? (inheritedFileIds.length ? "file" : "general"),
  );
  const activeFileIdsRef = useRef<string[]>(inheritedFileIds);
  const activeNoteIdsRef = useRef<string[]>(initialConversation?.active_note_ids ?? []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<RecordingSilenceTimer | null>(null);
  const recognitionCleanupRef = useRef<(() => void) | null>(null);
  const askAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const diagramAbortRef = useRef<AbortController | null>(null);
  const lastSpokenTextRef = useRef<string>("");
  const speechRunRef = useRef(0);
  const streamSpeechRunRef = useRef(0);
  const streamSpeechPendingRef = useRef(0);
  const streamSentenceBufferRef = useRef(new SentenceStreamBuffer());
  const jarvisModeRef = useRef(false);
  const jarvisPausedRef = useRef(false);
  const detectedLanguageRef = useRef<SupportedLanguageCode>(initialConversation?.language_code ?? preferredLanguage);
  const autoListenTimerRef = useRef<number | null>(null);
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
  const diagnosticEventIdRef = useRef(0);

  function recordVoiceDiagnostic(event: string, detail = "") {
    diagnosticEventIdRef.current += 1;
    setDiagnosticEvents((current) => [
      ...current.slice(-11),
      { id: diagnosticEventIdRef.current, at: new Date().toISOString(), event, detail: detail.slice(0, 180) },
    ]);
  }
  const requestIdRef = useRef<string>("");
  const contextRevisionRef = useRef(0);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

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

  useEffect(() => {
    let active = true;
    let status: PermissionStatus | null = null;
    const update = () => {
      if (active && status) setMicrophonePermission(status.state);
    };
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((result) => {
      if (!active) return;
      status = result;
      update();
      result.addEventListener("change", update);
    }).catch(() => {
      if (active) setMicrophonePermission("unsupported");
    });
    return () => {
      active = false;
      status?.removeEventListener("change", update);
    };
  }, []);

  const selectedVoiceLanguage = useMemo(() => findVoiceLanguage(language), [language]);
  const activeLanguage = useMemo(
    () => selectedVoiceLanguage.code === "auto" ? findVoiceLanguage(detectedLanguage) : selectedVoiceLanguage,
    [detectedLanguage, selectedVoiceLanguage],
  );
  const autoLanguage = selectedVoiceLanguage.code === "auto";
  const effectiveLanguageCode: SupportedLanguageCode = activeLanguage.code === "auto"
    ? detectedLanguage
    : activeLanguage.code;
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
  const activeFileId = contextMode === "file" || contextMode === "image" ? activeFileIds[0] ?? null : null;
  const contextFileForCommands = activeFileId;
  const contextFileNameForCommands =
    (contextFileForCommands ? fileNamesById.get(contextFileForCommands) : null) ?? initialFileName ?? null;
  const studyFileIds =
    contextMode === "file" || contextMode === "image" ? activeFileIds : [];
  const studyNoteIds =
    contextMode === "file" || contextMode === "image" ? activeNoteIds : [];

  // Stop any active recognition/synthesis when the component unmounts.
  useEffect(() => {
    return () => {
      if (autoListenTimerRef.current !== null) {
        window.clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
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
          speechRunRef.current += 1;
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
    if (!isSpeechSynthesisSupported()) return;
    const synthesis = window.speechSynthesis;
    const refreshVoices = () => setAvailableVoices(synthesis.getVoices?.() ?? []);
    refreshVoices();
    synthesis.addEventListener?.("voiceschanged", refreshVoices);
    return () => synthesis.removeEventListener?.("voiceschanged", refreshVoices);
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

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: "8" });
    if (activeTopic) query.set("topic", activeTopic);
    else if (activeFileId) query.set("fileId", activeFileId);
    void fetch(`/api/learning-memory?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (Array.isArray(data?.states)) setLearningStates(data.states as LearningState[]);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLearningStates([]);
      });
    return () => controller.abort();
  }, [activeFileId, activeTopic, turns]);

  useEffect(() => {
    if (!conversationId) return;
    const lastGeneratedImageId = [...turns].reverse().find((turn) => turn.generatedImage?.id)?.generatedImage?.id;
    const timer = window.setTimeout(() => {
      void patchConversation(conversationId, {
        studyState: {
          active_topic: activeTopic,
          active_subject: activeSubject,
          active_task: activeTask,
          active_mode: jarvisMode ? "jarvis" : "manual",
          preferred_language: preferredLanguage,
          detected_language: detectedLanguage,
          voice_preference: availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(activeLanguage.speechLocale.slice(0, 2).toLowerCase()))?.name,
          last_meaningful_intent: lastAssistantIntent,
          current_artifact_id: currentArtifactId || lastGeneratedImageId,
          last_artifact_id: lastGeneratedImageId,
          last_artifact_kind: currentArtifact ?? undefined,
          generated_asset_ids: turns.flatMap((turn) => turn.generatedImage?.id ? [turn.generatedImage.id] : []).slice(-20),
        },
      }).then((result) => {
        if (result.ok) setConversation((current) => current?.id === result.conversation.id ? result.conversation : current);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeLanguage.speechLocale, activeSubject, activeTask, activeTopic, availableVoices, conversationId, currentArtifact, currentArtifactId, detectedLanguage, jarvisMode, lastAssistantIntent, preferredLanguage, turns]);

  function nextTurnId(prefix: string): string {
    turnCounterRef.current += 1;
    return `${prefix}-${turnCounterRef.current}`;
  }

  function beginToolCall(tool: string): string {
    const id = nextTurnId(`tool-${tool}`);
    setRecentToolCalls((current) => [
      ...current.slice(-5),
      { id, tool, status: "running", createdAt: new Date().toISOString() },
    ]);
    return id;
  }

  function finishToolCall(id: string, status: JarvisToolCall["status"]) {
    setRecentToolCalls((current) => current.map((call) => call.id === id ? { ...call, status } : call));
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
    setStreaming(false);
  }

  async function ensureConversationForQuestion(question: string) {
    if (conversationId && conversation) return conversation;

    const title = shortTitleFromQuestion(question);
    const result = await createConversation({
      title: title ?? undefined,
      contextMode: contextModeRef.current,
      activeFileIds: activeFileIdsRef.current,
      activeNoteIds: activeNoteIdsRef.current,
      language: effectiveLanguageCode,
      studyState: {
        active_topic: activeTopic,
        active_subject: activeSubject,
        active_task: activeTask,
        active_mode: jarvisMode ? "jarvis" : "manual",
        preferred_language: preferredLanguage,
        detected_language: detectedLanguage,
        last_meaningful_intent: lastAssistantIntent,
        current_artifact_id: currentArtifactId || undefined,
        last_artifact_kind: currentArtifact ?? undefined,
      },
    });
    if (!result.ok) throw new Error(result.message);

    const conversationWithCurrentContext: Conversation = {
      ...result.conversation,
      context_mode: contextModeRef.current,
      active_file_ids: activeFileIdsRef.current,
      active_note_ids: activeNoteIdsRef.current,
    };
    setConversation(conversationWithCurrentContext);
    setConversationId(result.conversation.id);
    setContextMode(contextModeRef.current);
    setActiveFileIds(activeFileIdsRef.current);
    setActiveNoteIds(activeNoteIdsRef.current);
    if (title) titledConversationIdsRef.current.add(result.conversation.id);
    return conversationWithCurrentContext;
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

  async function changeActiveFile(fileId: string) {
    const contextRevision = ++contextRevisionRef.current;
    const previousFileId = activeFileIdsRef.current[0] ?? "";
    const nextFileIds = fileId ? [fileId] : [];
    const nextMode: ContextMode = fileId ? "file" : "general";
    contextModeRef.current = nextMode;
    activeFileIdsRef.current = nextFileIds;
    activeNoteIdsRef.current = [];
    if (fileId !== previousFileId) {
      setActiveSubject(fileId ? (fileNamesById.get(fileId) ?? "").replace(/\.[^.]+$/u, "") : "");
      setActiveTopic("");
      setActiveTask("idle");
      setCurrentArtifact(null);
    }
    setContextMode(nextMode);
    setActiveFileIds(nextFileIds);
    setActiveNoteIds([]);
    setNotice(fileId ? `Using ${fileNamesById.get(fileId) ?? "selected file"}.` : "No active file selected.");
    if (!conversationId) return;
    const result = await patchConversation(conversationId, {
      contextMode: nextMode,
      activeFileIds: nextFileIds,
      activeNoteIds: [],
      studyState: fileId !== previousFileId
        ? { active_subject: fileId ? (fileNamesById.get(fileId) ?? "").replace(/\.[^.]+$/u, "") : "", active_topic: "", active_task: "idle", current_artifact_id: "", last_artifact_kind: "" }
        : undefined,
    });
    if (result.ok) {
      if (contextRevision === contextRevisionRef.current) setConversation(result.conversation);
    } else {
      setError(result.message);
    }
  }

  async function persistVoiceTurn(question: string, answer: Answer) {
    const activeConversation = await ensureConversationForQuestion(question);
    const response = await fetch(`/api/conversations/${encodeURIComponent(activeConversation.id)}/messages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        answer,
        related_file_ids: activeFileIdsRef.current,
        related_note_ids: activeNoteIdsRef.current,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || "Could not save this Voice Tutor turn.");
    }
    return (await response.json()) as { message: ConversationMessage };
  }

  // -------------------------------------------------------------------------
  // Ask the existing StudyPilot chat API (declared before the mic handler so
  // there is no forward reference)
  // -------------------------------------------------------------------------

  async function askStudyPilot(displayQuestion: string, studyQuestion = displayQuestion) {
    setError("");
    setNotice("");
    const requestId = requestIdRef.current;
    let endTelemetryInFinally = Boolean(requestId);

    // This is a new voice turn. Invalidate any older async work first so a
    // late-resolving prior request cannot append stale content. Abort the
    // active controller (if any) before issuing the new one.
    const epoch = invalidateVoiceTurnEpoch();
    setInterrupted(false);
    abortActiveAskRequest();
    const toolCallId = beginToolCall("ask");

    setLoading(true);
    setTurns((current) => [...current, { id: nextTurnId("user"), role: "user", question: displayQuestion }]);
    const requestedLanguage = requestedStudyLanguage(displayQuestion);
    const answerLanguage: SupportedLanguageCode = requestedLanguage ?? effectiveLanguageCode;
    if (requestedLanguage && requestedLanguage !== activeLanguage.code) {
      detectedLanguageRef.current = requestedLanguage;
      setDetectedLanguage(requestedLanguage);
      setLanguage(requestedLanguage);
    }

    const controller = new AbortController();
    askAbortRef.current = controller;
    const streamingTurnId = nextTurnId("assistant-stream");
    let streamedText = "";
    let receivedStreamDelta = false;
    streamSentenceBufferRef.current.reset();
    stopSpeaking();
    streamSpeechRunRef.current = speechRunRef.current;
    streamSpeechPendingRef.current = 0;

    // Client-side hard timeout (25s) slightly above server interactive budget (20s).
    // If exceeded, abort the request and show a concise retry message.
    const CLIENT_TIMEOUT_MS = 25_000;
    const clientTimeoutId = window.setTimeout(() => {
      if (askAbortRef.current === controller) {
        controller.abort(new Error("Client timeout: request took too long"));
        setNotice("Request timed out. Please try again or use a shorter question.");
      }
    }, CLIENT_TIMEOUT_MS);

    try {
      telemetryStartStage(requestId, "conversation_loading");
      const activeConversation = await ensureConversationForQuestion(displayQuestion);
      if (requestedLanguage) void patchConversation(activeConversation.id, { language: requestedLanguage });
      telemetryEndStage(requestId, "conversation_loading");

      telemetryStartStage(requestId, "api_request_start");
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: studyQuestion,
          fileIds: activeFileIdsRef.current,
          noteIds: activeNoteIdsRef.current,
          conversationId: activeConversation.id,
          language: answerLanguage,
          stream: true,
        }),
        signal: controller.signal,
      });
      telemetryEndStage(requestId, "api_request_start");
      window.clearTimeout(clientTimeoutId);

      telemetryStartStage(requestId, "response_parsing");
      const data = await consumeAskResponse(response, {
        onEvent: (event: AskStreamEvent) => {
          if (event.type === "start") {
            requestIdRef.current = event.requestId;
            setCurrentVoiceRequestId(event.requestId);
            recordVoiceDiagnostic("request-start", event.requestId);
          }
          if (event.type === "provider") {
            recordVoiceDiagnostic("provider", `${event.provider}:${event.model}${event.fallback ? ":fallback" : ""}`);
            telemetrySetMetadata(requestId, { provider: event.provider, providerModel: event.model, fallback: event.fallback });
          }
        },
        onDelta: (delta) => {
          if (askAbortRef.current !== controller || voiceTurnEpochRef.current !== epoch) return;
          if (!receivedStreamDelta) recordVoiceDiagnostic("first-stream-text", `${delta.length} chars`);
          receivedStreamDelta = true;
          setStreaming(true);
          streamedText += delta;
          const partial = normalizeAnswer({ short_answer: streamedText, simple_explanation: streamedText, response_mode: "ai" });
          setTurns((current) => {
            const nextTurn: Turn = { id: streamingTurnId, role: "assistant", answer: partial };
            return current.some((turn) => turn.id === streamingTurnId)
              ? current.map((turn) => turn.id === streamingTurnId ? nextTurn : turn)
              : [...current, nextTurn];
          });
          const speechChunks = streamSentenceBufferRef.current.push(delta);
          if (speechChunks.length) queueStreamingSpeech(speechChunks, voiceLocale(answerLanguage));
        },
        onReset: () => {
          recordVoiceDiagnostic("stream-reset", "provider fallback");
          streamedText = "";
          receivedStreamDelta = false;
          streamSentenceBufferRef.current.reset();
          stopSpeaking();
          streamSpeechRunRef.current = speechRunRef.current;
          streamSpeechPendingRef.current = 0;
          setTurns((current) => current.filter((turn) => turn.id !== streamingTurnId));
        },
      }) as {
        chat: { id: string | null; answer: Answer; created_at: string };
        mode?: string;
        debug?: { timings?: unknown };
      };
      setStreaming(false);
      telemetryEndStage(requestId, "response_parsing");
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
      if (!stillActive) {
        finishToolCall(toolCallId, "cancelled");
        return;
      }

      const answer = normalizeAnswer({
        ...(data.chat?.answer ?? {}),
        // Prefer the answer-level response_mode ("ai" | "cache" |
        // "offline_fallback"): the top-level data.mode carries the context
        // strategy ("selected-context" | "keyword-context" | ...) and would
        // mislabel a genuine AI answer.
        response_mode: data.chat?.answer?.response_mode ?? data.mode,
      });
      const answerId = typeof data.chat?.id === "string" ? data.chat.id : undefined;

      // Re-verify after resolve/json — a concurrent turn could have advanced
      // the epoch during the await before the stale check above ran. The
      // controller check above already short-circuits the common case.
      if (askAbortRef.current !== controller || voiceTurnEpochRef.current !== epoch) {
        finishToolCall(toolCallId, "cancelled");
        return;
      }

      setTurns((current) => current.filter((turn) => turn.id !== streamingTurnId));

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
      setCurrentArtifact("answer");
      setLastAssistantIntent("answer");
      finishToolCall(toolCallId, "success");
      if (receivedStreamDelta) {
        const tail = streamSentenceBufferRef.current.flush();
        if (tail.length) queueStreamingSpeech(tail, voiceLocale(answerLanguage));
        lastSpokenTextRef.current = spokenAnswer;
        setHasSpokenText(Boolean(spokenAnswer));
      } else if (spokenAnswer) {
        speakText(spokenAnswer, voiceLocale(answerLanguage));
      }

      void maybeAutoTitleConversation(activeConversation.id, displayQuestion);
      void touchConversationUpdatedAt(activeConversation.id);
    } catch (err) {
      setStreaming(false);
      setTurns((current) => current.filter((turn) => turn.id !== streamingTurnId));
      streamSentenceBufferRef.current.reset();
      finishToolCall(toolCallId, isAbortError(err) ? "cancelled" : "failed");
      window.clearTimeout(clientTimeoutId);
      if (!isAbortError(err) && voiceTurnEpochRef.current === epoch) {
        const message = err instanceof Error ? err.message : "AI request failed. Please try again.";
        // If client timeout triggered, show a friendlier message.
        if (message.includes("Client timeout")) {
          setNotice("Request timed out. Please try again or use a shorter question.");
        } else {
          setError(message);
        }
      }
    } finally {
      window.clearTimeout(clientTimeoutId);
      if (askAbortRef.current === controller && voiceTurnEpochRef.current === epoch) {
        askAbortRef.current = null;
        setLoading(false);
        setStreaming(false);
      }
      if (endTelemetryInFinally) {
        telemetryEndRequest(requestId, { completed: false });
      }
    }
  }

  async function searchWeb(displayQuestion: string, query: string) {
    const toolCallId = beginToolCall("web_search");
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
      const saved = await persistVoiceTurn(displayQuestion, withConversationResult(
        { short_answer: result.concise_answer },
        createConversationResult("web_search", result, { title: result.query, status: "completed", provenance: { file_ids: activeFileIdsRef.current, language: effectiveLanguageCode } }),
      ));
      loadedAssistantIdsRef.current.add(saved.message.id);
      setTurns((current) => [
        ...current,
        {
          id: `${saved.message.id}-assistant`,
          role: "assistant",
          webSearch: result,
          webQuery: query,
        },
      ]);

      const spokenAnswer = stripUrlsForSpeech(result.concise_answer);
      setCurrentArtifact("web");
      setLastAssistantIntent("web_search");
      finishToolCall(toolCallId, "success");
      if (spokenAnswer) speakText(spokenAnswer);
    } catch (caught) {
      finishToolCall(toolCallId, isAbortError(caught) ? "cancelled" : "failed");
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
    const toolCallId = beginToolCall("deep_research");
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
      const saved = await persistVoiceTurn(displayQuestion, withConversationResult(
        { short_answer: report.executive_summary },
        createConversationResult("deep_research", report, { title: report.research_question, status: "completed", provenance: { file_ids: activeFileIdsRef.current, language: effectiveLanguageCode } }),
      ));
      loadedAssistantIdsRef.current.add(saved.message.id);
      setTurns((current) => [
        ...current,
        {
          id: `${saved.message.id}-assistant`,
          role: "assistant",
          researchReport: report,
          researchQuery: query,
        },
      ]);

      const spokenSummary = stripUrlsForSpeech(report.executive_summary);
      setCurrentArtifact("research");
      setLastAssistantIntent("deep_research");
      finishToolCall(toolCallId, "success");
      if (spokenSummary) speakText(spokenSummary);
    } catch (caught) {
      finishToolCall(toolCallId, isAbortError(caught) ? "cancelled" : "failed");
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
    const toolCallId = beginToolCall("diagram");
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
      const saved = await persistVoiceTurn(displayQuestion, withConversationResult(
        { short_answer: diagram.explanation },
        createConversationResult("diagram", { diagram, request, sourceLabel }, { artifact_id: diagram.id, title: diagram.title, status: "completed", provenance: { file_ids: activeFileIdsRef.current, language: effectiveLanguageCode } }),
      ));
      loadedAssistantIdsRef.current.add(saved.message.id);
      setTurns((current) => [
        ...current,
        {
          id: `${saved.message.id}-assistant`,
          role: "assistant",
          diagram,
          diagramRequest: request,
          diagramPrompt: displayQuestion,
        },
      ]);

      const spokenExplanation = stripUrlsForSpeech(diagram.explanation);
      setCurrentArtifact("diagram");
      setCurrentArtifactId(diagram.id ?? saved.message.id);
      setLastAssistantIntent("diagram");
      finishToolCall(toolCallId, "success");
      if (spokenExplanation) speakText(spokenExplanation);
    } catch (caught) {
      finishToolCall(toolCallId, isAbortError(caught) ? "cancelled" : "failed");
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

  async function generateStudyImage(displayQuestion: string, topic: string) {
    const cleanTopic = topic.trim();
    if (!cleanTopic) {
      const message = "Name a topic before generating an image.";
      setNotice(message);
      await appendPersistedSystemExchange(displayQuestion, message);
      return;
    }

    const toolCallId = beginToolCall("image");
    diagramAbortRef.current?.abort();
    const controller = new AbortController();
    diagramAbortRef.current = controller;
    setError("");
    setNotice("");
    setVisualizing(true);
    setActiveDiagramPrompt(cleanTopic);
    setTurns((current) => [...current, { id: nextTurnId("user"), role: "user", question: displayQuestion }]);

    try {
      const activeConversation = await ensureConversationForQuestion(displayQuestion);
      const result = await runImageGeneration({
        prompt: displayQuestion,
        topic: cleanTopic,
        conversationId: activeConversation.id,
        fileId: activeFileIdsRef.current[0],
        language: activeLanguage.code,
      }, { signal: controller.signal });
      const assistantId = result.messageId ?? nextTurnId("image-assistant");
      if (result.messageId) loadedAssistantIdsRef.current.add(result.messageId);
      setTurns((current) => [...current, {
        id: `${assistantId}-assistant`,
        role: "assistant",
        generatedImage: result.image,
        imagePrompt: displayQuestion,
      }]);
      setActiveTopic(cleanTopic);
      setCurrentArtifact("image");
      setCurrentArtifactId(result.image.id);
      setLastAssistantIntent("image");
      finishToolCall(toolCallId, "success");
      speakText(result.image.explanation);
    } catch (caught) {
      finishToolCall(toolCallId, isAbortError(caught) ? "cancelled" : "failed");
      if (!isAbortError(caught)) setError(caught instanceof Error ? caught.message : "Image generation failed. Please try again.");
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
      setStreaming(false);
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

  function addSystemTurn(text: string, question = "Voice Tutor") {
    setTurns((current) => [...current, { id: nextTurnId("system"), role: "system", text }]);
    void persistVoiceTurn(question, withConversationResult(
      { short_answer: text },
      createConversationResult("system", undefined, { text, status: "completed" }),
    )).then(({ message }) => loadedAssistantIdsRef.current.add(message.id)).catch((error) => {
      setNotice(error instanceof Error ? error.message : "Could not save this Voice Tutor turn.");
    });
  }

  async function appendPersistedSystemExchange(question: string, text: string) {
    setTurns((current) => [
      ...current,
      { id: nextTurnId("user"), role: "user", question },
      { id: nextTurnId("system"), role: "system", text },
    ]);
    try {
      const { message } = await persistVoiceTurn(question, withConversationResult(
        { short_answer: text },
        createConversationResult("system", undefined, { text, status: "completed" }),
      ));
      loadedAssistantIdsRef.current.add(message.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this Voice Tutor turn.");
    }
  }

  function selectedNotesLanguage() {
    return effectiveLanguageCode;
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

    const toolCallId = beginToolCall("notes");
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
      setCurrentArtifact("notes");
      setLastAssistantIntent("notes");
      finishToolCall(toolCallId, "success");
      addSystemTurn("Your editable notes preview is ready. Review it before saving or downloading.");
    } catch (caught) {
      finishToolCall(toolCallId, "failed");
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
    setInterrupted(false);
    if (autoLanguage) {
      const decision = detectSpokenLanguage(spoken, detectedLanguageRef.current);
      if (decision.language && decision.confidence >= 0.7) {
        detectedLanguageRef.current = decision.language;
        setDetectedLanguage(decision.language);
        if (conversationId) void patchConversation(conversationId, { language: decision.language });
      }
    }

    const controlIntent = resolveJarvisControlIntent(spoken);
    if (controlIntent?.kind === "change_language") {
      detectedLanguageRef.current = controlIntent.language;
      setDetectedLanguage(controlIntent.language);
      setLanguage(controlIntent.language);
      if (conversationId) void patchConversation(conversationId, { language: controlIntent.language });
      const hasContext = Boolean(activeTopic || turns.some((turn) => turn.role === "assistant"));
      if (hasContext) {
        await askStudyPilot(spoken, spoken);
      } else {
        const message = `I will continue in ${findVoiceLanguage(controlIntent.language).label}.`;
        await appendPersistedSystemExchange(spoken, message);
        speakText(message, voiceLocale(controlIntent.language));
      }
      return;
    }

    if (controlIntent?.kind === "select_file") {
      const matches = matchJarvisFiles(files, controlIntent.query);
      if (matches.length !== 1) {
        const message = matches.length > 1
          ? `I found more than one matching file: ${matches.slice(0, 4).map((file) => file.file_name).join(", ")}. Please choose one from Active study file.`
          : `I could not find a file matching "${controlIntent.query}". Please choose one from Active study file.`;
        await appendPersistedSystemExchange(spoken, message);
        speakText(message);
        return;
      }
      await changeActiveFile(matches[0].id);
      const message = `Using ${matches[0].file_name}.`;
      await appendPersistedSystemExchange(spoken, message);
      speakText(message);
      return;
    }

    if (controlIntent?.kind === "pause") {
      jarvisPausedRef.current = true;
      setJarvisPaused(true);
      stopSpeaking();
      const message = "Jarvis mode paused. Your conversation and study context are preserved.";
      await appendPersistedSystemExchange(spoken, message);
      return;
    }

    if (controlIntent?.kind === "resume") {
      jarvisPausedRef.current = false;
      setJarvisPaused(false);
      const message = "Jarvis mode resumed with your saved study context.";
      await appendPersistedSystemExchange(spoken, message);
      speakText(message);
      return;
    }

    if (controlIntent?.kind === "stop") {
      stopSpeaking();
      stopActiveRequest();
      await appendPersistedSystemExchange(spoken, "Current Voice Tutor activity stopped.");
      return;
    }

    if (controlIntent?.kind === "save_result") {
      const message = currentArtifact
        ? `The current ${currentArtifact} is already saved in this conversation.`
        : "There is no current result to save yet.";
      await appendPersistedSystemExchange(spoken, message);
      speakText(message);
      return;
    }

    if (controlIntent?.kind === "show_source") {
      const latestCitedAnswer = [...turns].reverse().find((turn) => turn.answer?.source_citations?.length);
      const citations = normalizeSourceCitations(latestCitedAnswer?.answer?.source_citations);
      const message = citations.length
        ? `Current sources: ${citations.map((citation) => {
            const locator = citation.locator_type && citation.locator_start !== undefined
              ? `, ${citation.locator_type} ${citation.locator_start}`
              : "";
            return `${citation.source_name}${locator}`;
          }).join("; ")}.`
        : "The current result does not include saved source citations.";
      await appendPersistedSystemExchange(spoken, message);
      speakText(message);
      return;
    }

    if (controlIntent?.kind === "repeat") {
      await appendPersistedSystemExchange(spoken, "Repeating the latest answer.");
      replay();
      return;
    }

    if (controlIntent?.kind === "follow_up") {
      setActiveTask((current) => current === "idle" ? "ask" : current);
      await askStudyPilot(spoken, spoken);
      return;
    }

    if (controlIntent?.kind === "generate_image") {
      setActiveTask("image");
      const subject = controlIntent.topic || activeTopic || latestRealUserTopic();
      await generateStudyImage(spoken, subject);
      return;
    }

    if (currentArtifact === "image" && /\b(?:explain|describe) (?:this|the current) image\b/iu.test(spoken)) {
      const imageTopic = activeTopic || latestRealUserTopic();
      await askStudyPilot(spoken, imageTopic
        ? `Explain the current generated study image about ${imageTopic}, using the saved conversation context.`
        : "Explain the current generated study image using the saved conversation context.");
      return;
    }

    const lastAssistant = [...turns].reverse().find((turn) => turn.role === "assistant");
    const lastWebQuery = lastAssistant?.webSearch
      ? lastAssistant.webQuery ?? lastAssistant.webSearch.query
      : undefined;
    const resolved = measureIntent("studypilot.voice.intent", () => resolveVoiceCommand(spoken, { lastWebQuery }));

    if (resolved.kind === "blocked") {
      await appendPersistedSystemExchange(spoken, resolved.message);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "study_workflow") {
      setActiveTask(resolved.outcome.workflow);
      if (!contextFileForCommands) {
        const message = "Select an uploaded file before generating a quiz or revision plan.";
        await appendPersistedSystemExchange(spoken, message);
        return;
      }
      const destination = resolved.outcome.workflow === "quiz" ? "/quiz" : "/revision";
      const query = new URLSearchParams({ fileId: contextFileForCommands, autoGenerate: "1" });
      await appendPersistedSystemExchange(spoken, resolved.outcome.message);
      router.push(`${destination}?${query.toString()}`);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "navigate") {
      const destination = resolved.outcome.href;
      await appendPersistedSystemExchange(spoken, resolved.outcome.message);
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
      await appendPersistedSystemExchange(spoken, reply);
      if (synthesisSupported) speakText(reply);
      return;
    }

    // A documented "ask" command resolves to a fixed study question.
    if (resolved.kind === "command" && resolved.outcome.kind === "ask") {
      setActiveTask(inferJarvisTask(spoken));
      await askStudyPilot(spoken, resolved.outcome.question);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "web_search") {
      setActiveTask("web_search");
      let query = resolved.outcome.query.trim();
      if (isContextualWebQuery(query)) query = latestRealUserTopic();

      if (!hasMeaningfulQuery(query)) {
        const message = "Please name a topic to search for. I do not have an earlier question to use yet.";
        setNotice(message);
        await appendPersistedSystemExchange(spoken, message);
        return;
      }

      setActiveTopic(query);
      await searchWeb(spoken, query);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "deep_research") {
      setActiveTask("deep_research");
      let query = resolved.outcome.query.trim();
      if (isContextualResearchQuery(query)) query = latestRealUserTopic();

      if (!hasMeaningfulQuery(query)) {
        const message = "Please name a focused topic to research. I do not have an earlier topic to use yet.";
        setNotice(message);
        await appendPersistedSystemExchange(spoken, message);
        return;
      }

      setActiveTopic(query);
      await researchDeeply(spoken, query);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "diagram") {
      setActiveTask("diagram");
      setCurrentArtifact("diagram");
      if (resolved.outcome.topic?.trim()) setActiveTopic(resolved.outcome.topic.trim());
      const diagramSource = resolveDiagramRequest({
        diagramType: resolved.outcome.diagramType,
        source: resolved.outcome.source,
        topic: resolved.outcome.topic,
      });

      if ("error" in diagramSource) {
        setNotice(diagramSource.error);
        await appendPersistedSystemExchange(spoken, diagramSource.error);
        return;
      }

      await generateDiagram(spoken, diagramSource.request, diagramSource.label);
      return;
    }

    if (resolved.kind === "command" && resolved.outcome.kind === "notes") {
      setActiveTask("notes");
      setCurrentArtifact("notes");
      await appendPersistedSystemExchange(spoken, resolved.outcome.message);

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
      if (freeQuestion) {
        const task = inferJarvisTask(freeQuestion);
        const topic = inferJarvisTopic(freeQuestion);
        setActiveTask(task);
        if (topic && !["next", "continue", "this", "this topic"].includes(topic.toLocaleLowerCase())) {
          setActiveTopic(topic);
        }
        const referencesCurrent = /\b(?:this|that|same|current|previous)\b/iu.test(freeQuestion);
        const topicDependentTask = task === "viva" || task === "exam_questions" || task === "explain" || task === "notes";
        const resolvedQuestion = activeTopic && (referencesCurrent || topicDependentTask)
          ? `${freeQuestion}\nResolve the current reference as topic "${activeTopic}"${currentArtifact ? ` and current ${currentArtifact} artifact${currentArtifactId ? ` ${currentArtifactId}` : ""}` : ""}. Keep the selected file context.`
          : freeQuestion;
        await askStudyPilot(spoken, resolvedQuestion);
      }
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
    const active = recognitionRef.current;
    if (active) {
      try {
        active.stop();
      } catch {
        // Ignore stop errors; the recognition may already have ended.
      }
    }
  }

  function cancelListening() {
    const active = recognitionRef.current;
    recognitionCleanupRef.current?.();
    recognitionCleanupRef.current = null;
    recognitionRef.current = null;
    recognitionSessionRef.current = null;
    clearSilenceTimer();
    setListening(false);
    setInterim("");
    if (active) {
      try {
        active.abort();
      } catch {
        // The browser may already have closed this recognition session.
      }
    }
  }

  function setJarvisEnabled(enabled: boolean) {
    jarvisModeRef.current = enabled;
    jarvisPausedRef.current = false;
    setJarvisMode(enabled);
    setJarvisPaused(false);
    if (!enabled) cancelListening();
  }

  function toggleJarvisPause() {
    const nextPaused = !jarvisPausedRef.current;
    jarvisPausedRef.current = nextPaused;
    setJarvisPaused(nextPaused);
    if (nextPaused) {
      cancelListening();
      stopSpeaking();
    }
  }

  function startListening(options: { bargeIn?: boolean } = {}) {
    const bargeIn = options.bargeIn === true;
    const currentRequestId = telemetryStartRequest();
    requestIdRef.current = currentRequestId;
    setError("");
    setNotice("");

    if (speaking && !bargeIn) {
      stopSpeaking();
    }

    if ((loading || notesLoading || searching || researching || visualizing) && !bargeIn) {
      setNotice("Please wait for the current StudyPilot action to finish before listening again.");
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge, or type your question in AI Chat instead.");
      return;
    }

    // Never more than one recognition session at a time (no always-listening).
    if (recognitionRef.current) return;

    setInterim("");

    const recognition = new SpeechRecognition();
    // Chrome is more reliable with an explicit locale. Auto follows the
    // browser language instead of assigning an empty SpeechRecognition lang.
    recognition.lang = activeLanguage.recognitionLocale || voiceLocale(detectedLanguageRef.current) || window.navigator.language || "en-US";
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
    let latestInterimTranscript = "";
    let recognitionHadError = false;
    let hasDispatchedFinal = false;
    let interruptedSpeech = false;

    const silenceTimer = new RecordingSilenceTimer({
      silenceMs: VOICE_RECORDING_SILENCE_MS,
      onSilence: () => {
        if (recognitionRef.current !== recognition) return;
        recordVoiceDiagnostic("silence-stop", `session ${sessionToken}`);
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
      recordVoiceDiagnostic("recognition-start", `${recognition.lang}; session ${sessionToken}`);
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
      latestInterimTranscript = interimText.trim();
      if (interimText) recordVoiceDiagnostic("interim-transcript", interimText);
      if (bargeIn && latestTranscript && !interruptedSpeech) {
        interruptedSpeech = true;
        setInterrupted(true);
        recordVoiceDiagnostic("interruption", `session ${sessionToken}`);
        invalidateVoiceTurnEpoch();
        abortActiveAskRequest();
        stopSpeaking();
      }
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
      } else if (code === "no-speech" && !jarvisModeRef.current) {
        setError("I did not hear anything. Tap Start listening and speak again.");
      } else if (code === "audio-capture") {
        setError("No microphone was found. Connect a microphone and try again.");
      } else if (code === "network") {
        setError("Speech recognition failed because of a network issue. Check your connection and try again.");
      } else if (!(jarvisModeRef.current && (code === "aborted" || code === "no-speech"))) {
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

      const spoken = finalTranscript.trim() || latestInterimTranscript.trim() || latestTranscript.trim();
      setInterim("");
      if (spoken) {
        recordVoiceDiagnostic("final-transcript", spoken);
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
      } else if (!jarvisModeRef.current) {
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

  function queueStreamingSpeech(chunks: string[], locale: string) {
    if (!isSpeechSynthesisSupported() || !chunks.length) return;
    const run = streamSpeechRunRef.current;
    const requestId = requestIdRef.current;
    if (streamSpeechPendingRef.current === 0) telemetryStartStage(requestId, "tts_start");
    setSpeaking(true);
    setHasSpokenText(true);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      streamSpeechPendingRef.current += 1;
      const utterance = new SpeechSynthesisUtterance(chunk);
      const voice = pickVoiceForLocale(locale, availableVoices);
      if (voice && voice.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase())) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = locale;
      }
      const chunkIndex = streamSpeechPendingRef.current;
      const voiceName = utterance.voice?.name ?? `browser-default:${utterance.lang}`;
      recordVoiceDiagnostic("tts-queued", `${chunkIndex}:${voiceName}`);
      utterance.onstart = () => {
        recordVoiceDiagnostic("tts-start", `${chunkIndex}:${voiceName}`);
        telemetryEndStage(requestId, "tts_start");
      };
      const finish = () => {
        if (streamSpeechRunRef.current !== run) return;
        recordVoiceDiagnostic("tts-end", `${chunkIndex}:${voiceName}`);
        streamSpeechPendingRef.current = Math.max(0, streamSpeechPendingRef.current - 1);
        if (streamSpeechPendingRef.current === 0) setSpeaking(false);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    }
  }

  function speakText(text: string, localeOverride?: string) {
    if (!isSpeechSynthesisSupported()) {
      setError("Read aloud is not supported in this browser.");
      return;
    }
    if (!text.trim()) return;

    const chunks = splitSpeechText(text);
    if (!chunks.length) return;
    const requestId = requestIdRef.current;
    telemetryStartStage(requestId, "tts_start");
    speechRunRef.current += 1;
    const run = speechRunRef.current;
    window.speechSynthesis.cancel();
    const locale = /[\u0c00-\u0c7f]/u.test(text) ? "te-IN" : localeOverride ?? activeLanguage.speechLocale;
    lastSpokenTextRef.current = text;
    setHasSpokenText(true);
    setSpeaking(true);

    const speakChunk = (index: number) => {
      if (speechRunRef.current !== run) return;
      if (index >= chunks.length) {
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      const voice = pickVoiceForLocale(locale, availableVoices);
      if (voice && (!locale || voice.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase()))) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (locale) {
        utterance.lang = locale;
      }
      utterance.onend = () => speakChunk(index + 1);
      utterance.onerror = () => {
        if (speechRunRef.current === run) setSpeaking(false);
      };
      window.speechSynthesis.speak(utterance);
    };
    speakChunk(0);
    telemetryEndStage(requestId, "tts_start");
  }

  function readAloud() {
    const lastAnswer = [...turns]
      .reverse()
      .find((turn) => turn.role === "assistant" && (turn.answer || turn.webSearch || turn.researchReport || turn.diagram || turn.generatedImage));
    if (!lastAnswer) {
      setNotice("There is no answer to read aloud yet. Ask a question first.");
      return;
    }
    if (lastAnswer.diagram) {
      speakText(stripUrlsForSpeech(lastAnswer.diagram.explanation));
    } else if (lastAnswer.generatedImage) {
      speakText(lastAnswer.generatedImage.explanation);
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
    speechRunRef.current += 1;
    streamSpeechRunRef.current = speechRunRef.current;
    streamSpeechPendingRef.current = 0;
    streamSentenceBufferRef.current.reset();
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
    .find((turn) => turn.role === "assistant" && (turn.answer || turn.webSearch || turn.researchReport || turn.diagram || turn.generatedImage));
  const lastStudyAssistant = [...turns].reverse().find((turn) => turn.role === "assistant" && turn.answer);
  const jarvisRuntimeState: JarvisRuntimeState = resolveJarvisRuntimeState({
    error: Boolean(error),
    paused: jarvisMode && jarvisPaused,
    interrupted,
    userSpeaking: listening && Boolean(interim.trim()),
    listening,
    toolRunning: notesLoading || searching || researching || visualizing,
    streaming,
    processing: loading,
    speaking,
  });

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

  const stateLabel = micBlocked && jarvisRuntimeState === "IDLE"
    ? "Microphone unavailable"
    : jarvisRuntimeState === "TOOL_RUNNING"
      ? visualizing ? "Visualizing" : researching ? "Researching" : searching ? "Searching" : "Running tool"
      : jarvisRuntimeState === "USER_SPEAKING"
        ? "Hearing you"
        : jarvisRuntimeState === "PROCESSING"
          ? "Thinking"
          : jarvisRuntimeState.charAt(0) + jarvisRuntimeState.slice(1).toLowerCase();

  const stateSublabel = error
    ? "Something went wrong. Try again."
    : jarvisMode && jarvisPaused
      ? "Resume Jarvis mode when you are ready."
    : interrupted
      ? "The previous response was cancelled. Listening for your new request."
    : listening
      ? "Speak now, then tap Stop listening."
      : streaming
        ? "Showing the answer as the provider generates it."
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
  const currentCitations = useMemo(() => {
    const citedTurn = [...turns].reverse().find((turn) => turn.answer?.source_citations?.length);
    return normalizeSourceCitations(citedTurn?.answer?.source_citations).slice(0, 4);
  }, [turns]);

  const agentSessionState = useMemo<JarvisSessionState>(() => {
    const latestUserTurn = [...turns].reverse().find((turn) => turn.role === "user" && turn.question?.trim());
    return {
      conversationId,
      activeFileIds,
      activeFileNames: activeFileIds.map((id) => fileNamesById.get(id) ?? "File"),
      activeSubject,
      activeTopic,
      activeSubtopic: persistedStudyState.active_subtopic ?? "",
      activeTask,
      activeMode: jarvisMode ? "jarvis" : "manual",
      preferredLanguage,
      detectedLanguage,
      voicePreference: availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(activeLanguage.speechLocale.slice(0, 2).toLowerCase()))?.name ?? null,
      lastMeaningfulUserIntent: latestUserTurn?.question ?? "",
      lastAssistantIntent,
      recentToolCalls,
      generatedAssetIds: turns.flatMap((turn) => turn.generatedImage?.id ? [turn.generatedImage.id] : []),
      currentArtifactId: currentArtifactId || null,
      currentArtifact,
      lastQuizId: persistedStudyState.last_quiz_id ?? null,
      lastRevisionPlanId: persistedStudyState.last_revision_plan_id ?? null,
      unfinishedTask: persistedStudyState.unfinished_task ?? null,
      learningContext: learningStates.map((state) => ({ topic: state.topic, status: state.status, revisionStatus: state.revision_status })),
      followUpState: "none",
    };
  }, [activeFileIds, activeLanguage.speechLocale, activeSubject, activeTask, activeTopic, availableVoices, conversationId, currentArtifact, currentArtifactId, detectedLanguage, fileNamesById, jarvisMode, lastAssistantIntent, learningStates, persistedStudyState.active_subtopic, persistedStudyState.last_quiz_id, persistedStudyState.last_revision_plan_id, persistedStudyState.unfinished_task, preferredLanguage, recentToolCalls, turns]);

  useEffect(() => {
    jarvisModeRef.current = jarvisMode;
    jarvisPausedRef.current = jarvisPaused;
    if (autoListenTimerRef.current !== null) {
      window.clearTimeout(autoListenTimerRef.current);
      autoListenTimerRef.current = null;
    }
    if (!jarvisMode || jarvisPaused || micBlocked || error || listening || (working && !speaking)) return;

    autoListenTimerRef.current = window.setTimeout(() => {
      autoListenTimerRef.current = null;
      if (!jarvisModeRef.current || jarvisPausedRef.current || recognitionRef.current) return;
      startListening({ bargeIn: speaking });
    }, speaking ? 250 : 450);

    return () => {
      if (autoListenTimerRef.current !== null) {
        window.clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
    };
  }, [error, jarvisMode, jarvisPaused, listening, micBlocked, speaking, working]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2 self-stretch sm:flex-row sm:items-center">
          <div className="inline-flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-[#09111f]/80 px-3 py-2 text-xs text-slate-400">
            <IconFileText size={15} className="shrink-0 text-slate-300" />
            <span className="shrink-0">Active context</span>
            <span className="truncate font-semibold text-emerald-300">{activeContextText}</span>
          </div>
          <label className="min-w-0">
            <span className="sr-only">Active study file</span>
            <select
              aria-label="Active study file"
              value={activeFileId ?? ""}
              onChange={(event) => void changeActiveFile(event.target.value)}
              disabled={working || listening}
              className="h-9 w-full min-w-0 rounded-md border border-white/12 bg-[#080f1e] px-3 text-xs text-slate-100 outline-none transition focus:border-emerald-300 disabled:opacity-50 sm:w-64"
            >
              <option value="">No active file</option>
              {files.map((file) => <option key={file.id} value={file.id}>{file.file_name}</option>)}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            role="switch"
            aria-checked={jarvisMode}
            onClick={() => setJarvisEnabled(!jarvisMode)}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold transition ${jarvisMode ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100" : "border-white/12 bg-[#080f1e] text-slate-300 hover:border-emerald-300/25"}`}
          >
            <IconZap size={14} /> Jarvis {jarvisMode ? "On" : "Off"}
          </button>
          {jarvisMode ? (
            <button
              type="button"
              onClick={toggleJarvisPause}
              className="inline-flex h-9 items-center justify-center rounded-md border border-white/12 bg-[#080f1e] px-3 text-xs font-semibold text-slate-200 hover:border-emerald-300/25"
            >
              {jarvisPaused ? "Resume" : "Pause"}
            </button>
          ) : null}
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
                onChange={(event) => {
                  const value = event.target.value;
                  setLanguage(value);
                  if (conversationId && value !== "auto") {
                    detectedLanguageRef.current = value as SupportedLanguageCode;
                    setDetectedLanguage(value as SupportedLanguageCode);
                    void patchConversation(conversationId, { language: value as SupportedLanguageCode });
                  }
                }}
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
          onClick={() => startListening()}
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
            {visualizing ? (activeTask === "image" ? "Image generation is running" : "Diagram generation is running") : researching ? "Deep research is running" : "Web search is running"}
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

      {/* Conversation and its shared Jarvis context */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
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

        {turns.map((turn, turnIndex) => {
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
          if (turn.generatedImage) {
            const image = turn.generatedImage;
            return (
              <article key={turn.id} className="max-w-[100%] rounded-2xl rounded-bl-md border border-emerald-300/20 bg-emerald-300/[0.035] p-4 shadow-xl shadow-black/15 sm:max-w-[96%] sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-200">Generated image</span>
                  <span className="break-words text-xs text-slate-400">Voice request: {turn.imagePrompt ?? image.prompt}</span>
                </div>
                <GeneratedImagePreview
                  image={image}
                  onRegenerate={() => void generateStudyImage(turn.imagePrompt ?? `Generate an image for ${image.prompt}`, image.prompt)}
                  regenerating={visualizing && activeTask === "image"}
                />
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
          const previousTurn = turns[turnIndex - 1];
          const previousQuestion = previousTurn?.role === "user" ? previousTurn.question ?? "" : "";
          const conversational = !/^(?:give|generate|make|create|summari[sz]e|list|show)\b/i.test(previousQuestion);
          const shortAnswer = answer.short_answer?.trim() ?? "";
          const explanation = answer.simple_explanation?.trim() ?? "";
          const conversationalExplanation = shortAnswer && explanation.startsWith(shortAnswer)
            ? explanation.slice(shortAnswer.length).trim()
            : explanation;
          const firstStep = answer.step_by_step?.[0] ?? "";
          const explanationIncludesSteps = Boolean(firstStep && explanation.includes(firstStep));
          return (
            <article key={turn.id} className="max-w-[96%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.045] p-4 shadow-xl shadow-black/15 sm:max-w-[92%] sm:p-5">
              {answer.response_mode === "offline_fallback" ? (
                <div className="mb-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs leading-6 text-amber-100">
                  AI model limit reached. Showing an answer built from your saved study material.
                  {answer.fallback_notice ? <p className="mt-1 text-amber-100/80">{answer.fallback_notice}</p> : null}
                </div>
              ) : null}
              <div className="grid gap-3">
                {conversational ? (
                  <>
                    {answer.short_answer ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">{answer.short_answer}</p> : null}
                    {conversationalExplanation ? (
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{conversationalExplanation}</p>
                    ) : null}
                    {answer.step_by_step?.length && !explanationIncludesSteps ? (
                      <ul className="grid list-disc gap-1 pl-4 text-sm leading-6 text-slate-300">
                        {answer.step_by_step.map((step) => <li key={step}>{step}</li>)}
                      </ul>
                    ) : null}
                    {answer.example ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{answer.example}</p> : null}
                    {answer.next_step ? <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-400">{answer.next_step}</p> : null}
                  </>
                ) : (
                  <>
                    <Section title="Short Answer">{answer.short_answer}</Section>
                    <Section title="Simple Explanation">{answer.simple_explanation}</Section>
                    {answer.step_by_step?.length ? (
                      <Section title="Step-by-Step">
                        <ol className="grid list-decimal gap-2 pl-4">
                          {answer.step_by_step.map((step) => <li key={step}>{step}</li>)}
                        </ol>
                      </Section>
                    ) : null}
                    <Section title="Example">{answer.example}</Section>
                    <Section title="Memory Line">{answer.memory_line}</Section>
                    <Section title="Common Mistake">{answer.common_mistake}</Section>
                    <Section title="Exam/Viva Answer">{answer.exam_viva_answer}</Section>
                    <Section title="Practice Question">{answer.practice_question}</Section>
                    <Section title="Next Step">{answer.next_step}</Section>
                  </>
                )}
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

      <aside aria-label="Jarvis context" className="grid gap-4 rounded-lg border border-white/10 bg-[#09111f]/60 p-4 xl:sticky xl:top-4">
        <div>
          <p className="text-xs font-semibold uppercase text-emerald-300">Current context</p>
          <dl className="mt-3 grid gap-3 text-xs">
            <div><dt className="text-slate-500">Active file</dt><dd className="mt-1 break-words font-medium text-slate-200">{agentSessionState.activeFileNames.join(", ") || "None selected"}</dd></div>
            <div><dt className="text-slate-500">Subject</dt><dd className="mt-1 break-words font-medium text-slate-200">{activeSubject || "Not established"}</dd></div>
            <div><dt className="text-slate-500">Topic</dt><dd className="mt-1 break-words font-medium text-slate-200">{agentSessionState.activeTopic || "Not established"}</dd></div>
            <div><dt className="text-slate-500">Task</dt><dd className="mt-1 capitalize text-slate-200">{agentSessionState.activeTask.replaceAll("_", " ")}</dd></div>
            <div><dt className="text-slate-500">Language</dt><dd className="mt-1 text-slate-200">{findVoiceLanguage(agentSessionState.detectedLanguage).label}{autoLanguage ? " (auto)" : ""}</dd></div>
            <div><dt className="text-slate-500">Artifact</dt><dd className="mt-1 capitalize text-slate-200">{currentArtifact?.replaceAll("_", " ") || "None"}</dd></div>
          </dl>
        </div>

        <div className="border-t border-white/8 pt-3">
          <p className="text-xs font-semibold uppercase text-slate-400">Sources</p>
          {currentCitations.length ? (
            <ul className="mt-2 grid gap-1.5 text-xs text-slate-300">
              {currentCitations.map((citation) => <li key={citation.id} className="break-words">{citation.source_name}</li>)}
            </ul>
          ) : <p className="mt-2 text-xs text-slate-500">No citations on the current answer.</p>}
        </div>

        {recentToolCalls.length ? (
          <div className="border-t border-white/8 pt-3">
            <p className="text-xs font-semibold uppercase text-slate-400">Recent tools</p>
            <div className="mt-2 grid gap-2">
              {recentToolCalls.slice(-3).reverse().map((call) => (
                <div key={call.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate capitalize text-slate-300">{call.tool.replaceAll("_", " ")}</span>
                  <span className={call.status === "success" ? "text-emerald-300" : call.status === "failed" ? "text-red-300" : "text-sky-300"}>{call.status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-t border-white/8 pt-3">
          <p className="text-xs font-semibold uppercase text-slate-400">Learning evidence</p>
          {learningStates.length ? (
            <div className="mt-2 grid gap-2">
              {learningStates.slice(0, 4).map((state) => (
                <div key={state.id} className="rounded-md border border-white/8 bg-white/[0.03] p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words font-medium text-slate-200">{state.topic}</span>
                    <span className={state.status === "NEEDS_REVISION" ? "shrink-0 text-amber-300" : "shrink-0 text-emerald-300"}>
                      {state.status.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-500">
                    {state.quiz_attempts
                      ? `${state.correct_count} correct, ${state.incorrect_count} incorrect from ${state.quiz_attempts} topic quiz attempt${state.quiz_attempts === 1 ? "" : "s"}.`
                      : "Saved from explicit study activity."}
                  </p>
                </div>
              ))}
            </div>
          ) : <p className="mt-2 text-xs text-slate-500">No recorded learning evidence for this context yet.</p>}
        </div>

        <div className="border-t border-white/8 pt-3">
          <p className="text-xs font-semibold uppercase text-slate-400">Suggested actions</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {["Explain further", "Generate quiz", "Viva questions", "Create revision plan", "Create notes", "Generate diagram"].map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => void handleSpokenText(action)}
                disabled={working}
                className="min-h-9 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left text-[11px] font-medium leading-4 text-slate-300 transition hover:border-emerald-300/25 hover:text-white disabled:opacity-40"
              >
                {action}
              </button>
            ))}
          </div>
        </div>

        <details className="border-t border-white/8 pt-3 text-xs">
          <summary className="cursor-pointer font-semibold uppercase text-slate-400">Voice diagnostics</summary>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-slate-400">
            <div><dt>Runtime state</dt><dd className="mt-0.5 font-medium text-slate-200">{jarvisRuntimeState}</dd></div>
            <div><dt>Microphone permission</dt><dd className="mt-0.5 font-medium text-slate-200">{microphonePermission}</dd></div>
            <div><dt>Recognition locale</dt><dd className="mt-0.5 font-medium text-slate-200">{activeLanguage.recognitionLocale}</dd></div>
            <div><dt>TTS locale</dt><dd className="mt-0.5 font-medium text-slate-200">{activeLanguage.speechLocale}</dd></div>
            <div className="col-span-2"><dt>Request ID</dt><dd className="mt-0.5 break-all font-mono text-[10px] text-slate-300">{currentVoiceRequestId || "None"}</dd></div>
          </dl>
          <ol className="mt-3 grid max-h-40 gap-1 overflow-y-auto border-t border-white/8 pt-2 font-mono text-[10px] text-slate-500">
            {diagnosticEvents.length ? diagnosticEvents.map((entry) => (
              <li key={entry.id} className="break-words">
                {entry.at.slice(11, 19)} {entry.event}{entry.detail ? `: ${entry.detail}` : ""}
              </li>
            )) : <li>No voice events recorded yet.</li>}
          </ol>
        </details>
      </aside>
      </div>

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
