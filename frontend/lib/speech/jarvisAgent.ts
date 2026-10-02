import type { SupportedLanguageCode } from "@/shared/languages";
import { explicitVoiceLanguageCommand } from "@/shared/voiceLanguage";

export type JarvisTask =
  | "idle"
  | "explain"
  | "ask"
  | "quiz"
  | "revision"
  | "viva"
  | "exam_questions"
  | "notes"
  | "diagram"
  | "image"
  | "web_search"
  | "deep_research";

export type JarvisToolStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export type JarvisToolCall = {
  id: string;
  tool: string;
  status: JarvisToolStatus;
  createdAt: string;
};

export type JarvisSessionState = {
  conversationId: string | null;
  activeFileIds: string[];
  activeFileNames: string[];
  activeSubject: string;
  activeTopic: string;
  activeSubtopic: string;
  activeTask: JarvisTask;
  activeMode: "manual" | "jarvis";
  preferredLanguage: SupportedLanguageCode;
  detectedLanguage: SupportedLanguageCode;
  voicePreference: string | null;
  lastMeaningfulUserIntent: string;
  lastAssistantIntent: string;
  recentToolCalls: JarvisToolCall[];
  generatedAssetIds: string[];
  currentArtifactId: string | null;
  currentArtifact: "answer" | "notes" | "diagram" | "image" | "web" | "research" | null;
  lastQuizId: string | null;
  lastRevisionPlanId: string | null;
  unfinishedTask: Record<string, unknown> | null;
  learningContext: Array<{ topic: string; status: string; revisionStatus: string }>;
  followUpState: "none" | "continue" | "next" | "simplify" | "expand";
};

export type JarvisControlIntent =
  | { kind: "change_language"; language: SupportedLanguageCode }
  | { kind: "select_file"; query: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" }
  | { kind: "save_result" }
  | { kind: "show_source" }
  | { kind: "repeat" }
  | { kind: "follow_up"; action: "continue" | "next" | "simplify" | "expand" }
  | { kind: "generate_image"; topic?: string };

function clean(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s._-]/gu, " ").replace(/\s+/g, " ").trim();
}

export function resolveJarvisControlIntent(text: string): JarvisControlIntent | null {
  const language = explicitVoiceLanguageCommand(text);
  if (language) return { kind: "change_language", language };

  const normalized = clean(text).replace(/[.]+$/u, "").trim();
  if (/^(?:pause|pause jarvis|stop listening|go to sleep)$/u.test(normalized)) return { kind: "pause" };
  if (/^(?:resume|resume jarvis|wake up|start listening)$/u.test(normalized)) return { kind: "resume" };
  if (/^(?:stop|cancel|stop that|cancel that)$/u.test(normalized)) return { kind: "stop" };
  if (/^(?:save|save this|save this result|keep this result)$/u.test(normalized)) return { kind: "save_result" };
  if (/^(?:show (?:me )?(?:the )?(?:source|sources)|where did this come from|show citations)$/u.test(normalized)) return { kind: "show_source" };
  if (/^(?:repeat|repeat that|say that again)$/u.test(normalized)) return { kind: "repeat" };
  if (/^(?:next|next batch|more questions)$/u.test(normalized)) return { kind: "follow_up", action: "next" };
  if (/^(?:continue|continue from where we stopped|go on)$/u.test(normalized)) return { kind: "follow_up", action: "continue" };
  if (/^(?:explain simpler|explain it simpler|simplify|make it simple|wait explain simpler)$/u.test(normalized)) return { kind: "follow_up", action: "simplify" };
  if (/^(?:expand|explain further|go deeper|give more detail)$/u.test(normalized)) return { kind: "follow_up", action: "expand" };
  if (/^(?:generate|create|make) (?:an? )?(?:study )?image$/u.test(normalized)) return { kind: "generate_image" };
  const imageMatch = normalized.match(/^(?:generate|create|make) (?:an? )?(?:study )?image(?: for| of)? (.+)$/u);
  if (imageMatch?.[1]) {
    const topic = imageMatch[1].trim();
    return /^(?:this|this concept|this topic)$/u.test(topic)
      ? { kind: "generate_image" }
      : { kind: "generate_image", topic };
  }

  const fileMatch = normalized.match(/^(?:open|use|switch to|select) (?:my )?(.+?)(?: notes| file)?$/u);
  if (fileMatch?.[1] && !["dashboard", "files", "quiz", "revision"].includes(fileMatch[1])) {
    return { kind: "select_file", query: fileMatch[1] };
  }
  return null;
}

export function inferJarvisTask(text: string): JarvisTask {
  const normalized = clean(text);
  if (/\bviva\b/u.test(normalized)) return "viva";
  if (/\bexam (?:question|questions)\b/u.test(normalized)) return "exam_questions";
  if (/\bquiz\b/u.test(normalized)) return "quiz";
  if (/\brevision\b/u.test(normalized)) return "revision";
  if (/\bnotes?\b/u.test(normalized)) return "notes";
  if (/\b(?:diagram|flowchart|mind map)\b/u.test(normalized)) return "diagram";
  if (/\bimage\b/u.test(normalized)) return "image";
  if (/\b(?:web|online)\b/u.test(normalized)) return "web_search";
  if (/\bresearch\b/u.test(normalized)) return "deep_research";
  if (/\b(?:explain|describe|what is|what are)\b/u.test(normalized)) return "explain";
  return "ask";
}

export function inferJarvisTopic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/^(?:please\s+)?(?:explain|describe|define|what\s+(?:is|are)|tell\s+me\s+about|give\s+me|generate|create|make)\s+/iu, "")
    .replace(/\b(?:in|using|from)\s+(?:this|the)\s+(?:file|document|notes)\b.*$/iu, "")
    .replace(/[\s.!?]+$/gu, "")
    .trim()
    .slice(0, 160);
}

export function matchJarvisFiles<T extends { id: string; file_name: string }>(files: T[], query: string): T[] {
  const target = clean(query).replace(/\b(?:file|notes?)\b/gu, "").trim();
  if (!target) return [];
  const tokens = target.split(" ").filter(Boolean);
  return files
    .map((file) => {
      const name = clean(file.file_name).replace(/\.[a-z0-9]+$/u, "").replace(/[-_]+/gu, " ");
      const exact = name === target ? 100 : 0;
      const contains = name.includes(target) || target.includes(name) ? 40 : 0;
      const tokenScore = tokens.filter((token) => name.includes(token)).length * 10;
      return { file, score: exact + contains + tokenScore };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((entry, _index, all) => entry.score === all[0]?.score)
    .map((entry) => entry.file);
}
