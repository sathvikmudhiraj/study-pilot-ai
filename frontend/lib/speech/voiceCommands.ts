// StudyPilot voice command definitions and matching.
//
// Voice commands here are intentionally safe and limited:
//   - Navigation: open dashboard / files / quiz / revision.
//   - AI-assisted study helpers (important notes, explain, generate quiz,
//     revision plan) are turned into a plain-language study question and sent
//     to the existing StudyPilot chat API.
//   - Notes commands only prepare an editable preview, or operate on a preview
//     that is already open. Saving still requires an explicit confirmation.
//
// Hard safety rules:
//   - No destructive actions (delete, remove, overwrite, reset, clear, wipe).
//   - No file deletion by voice.
//   - Only the documented commands resolve to a VoiceCommand; anything else is
//     treated as a free-form question and sent to the chat API as-is.

export type VoiceCommandId =
  | "open_dashboard"
  | "open_files"
  | "open_quiz"
  | "open_revision"
  | "important_notes"
  | "explain_file"
  | "generate_quiz"
  | "create_revision_plan"
  | "web_search"
  | "deep_research"
  | "generate_diagram"
  | "create_notes_answer"
  | "create_notes_summary"
  | "create_exam_notes"
  | "create_revision_notes"
  | "save_notes"
  | "download_notes_pdf"
  | "download_notes_docx"
  | "download_notes_markdown"
  | "download_notes_text";

export type VoiceNoteSource = "answer" | "summary" | "auto";
export type VoiceNoteStyle = "standard" | "exam" | "one_page";
export type VoiceNoteExportFormat = "pdf" | "docx" | "markdown" | "text";
export type VoiceDiagramType =
  | "flowchart"
  | "mind_map"
  | "concept_map"
  | "sequence_diagram"
  | "timeline"
  | "comparison_diagram"
  | "study_process";
export type VoiceDiagramSourceIntent = "topic" | "answer" | "summary" | "file" | "auto";

export type VoiceCommandOutcome =
  | {
      kind: "navigate";
      href: string;
      message: string;
    }
  | {
      kind: "ask";
      /** Question text sent to the existing StudyPilot chat API. */
      question: string;
      message: string;
    }
  | {
      kind: "web_search";
      /** Exact query extracted from the recognized command. */
      query: string;
      message: string;
    }
  | {
      kind: "deep_research";
      /** Exact research question extracted from the recognized command. */
      query: string;
      message: string;
    }
  | {
      kind: "diagram";
      diagramType: VoiceDiagramType;
      source: VoiceDiagramSourceIntent;
      topic?: string;
      message: string;
    }
  | {
      kind: "notes";
      action: "create" | "save" | "download";
      source?: VoiceNoteSource;
      style?: VoiceNoteStyle;
      format?: VoiceNoteExportFormat;
      message: string;
    }
  | {
      /** Casual greeting / social phrase — reply inline, no API call. */
      kind: "greeting";
      reply: string;
      message: string;
    };

export type VoiceCommand = {
  id: VoiceCommandId;
  label: string;
  /** Phrases the user might say to trigger the command. */
  phrases: string[];
  /** Short description shown in the command reference UI. */
  description: string;
  /** Side-effect-adjacent commands must match the whole transcript. */
  exact?: boolean;
  /** Dynamic commands are resolved by their dedicated anchored parser. */
  dynamic?: boolean;
};

// Normalizes spoken text so matching is forgiving while retaining letters from
// Telugu and the other languages supported by Voice Tutor.
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text: string, phrases: string[]): boolean {
  const paddedText = ` ${text} `;
  return phrases.some((phrase) => {
    const normalizedPhrase = normalize(phrase);
    if (!normalizedPhrase) return false;
    // Normalization turns punctuation into spaces, so padded whitespace gives
    // us language-neutral token boundaries without JavaScript's ASCII-only \b.
    return paddedText.includes(` ${normalizedPhrase} `);
  });
}

function matchesCommand(text: string, command: VoiceCommand): boolean {
  if (command.dynamic) return false;
  if (!command.exact) return matchesAny(text, command.phrases);
  return command.phrases.some((phrase) => text === normalize(phrase));
}

/**
 * Extracts only explicitly requested web-search commands. Patterns are anchored
 * so a normal study question that merely mentions web search is not rerouted.
 * The captured query keeps the recognized wording rather than the normalized
 * matching form.
 */
function webSearchQuery(text: string): string | null {
  const spoken = text.normalize("NFKC").trim();
  const patterns = [
    /^search\s+the\s+web\s+for(?:\s+(.*?))?[\s.!?।]*$/iu,
    /^search\s+online\s+for(?:\s+(.*?))?[\s.!?।]*$/iu,
    /^find\s+current\s+information\s+about(?:\s+(.*?))?[\s.!?।]*$/iu,
    /^web\s+lo(?:\s+(.*?))?\s+search\s+cheyyi[\s.!?।]*$/iu,
  ];

  for (const pattern of patterns) {
    const match = spoken.match(pattern);
    if (match) return (match[1] ?? "").trim();
  }

  return null;
}

/** Extracts the bounded deep-research intents documented in Voice Tutor. */
function deepResearchQuery(text: string): string | null {
  const spoken = text.normalize("NFKC").trim();
  const patterns = [
    /^research(?:\s+(.*?))?\s+deeply[\s.!?।]*$/iu,
    /^(?:do\s+)?deep\s+research(?:\s+(?:on|about|into)(?:\s+(.*?))?)?[\s.!?।]*$/iu,
    /^(ee\s+topic)\s+meeda\s+detailed\s+research\s+cheyyi[\s.!?।]*$/iu,
    /^(ఈ\s+టాపిక్)\s+మీద\s+detailed\s+research\s+చేయి[\s.!?।]*$/iu,
    /^compare\s+(.+?)\s+using\s+web\s+sources[\s.!?।]*$/iu,
  ];

  for (const pattern of patterns) {
    const match = spoken.match(pattern);
    if (match) return (match[1] ?? "").trim();
  }

  return null;
}

function approvedDiagramType(value: string): VoiceDiagramType {
  const normalized = normalize(value);
  if (normalized === "mind map") return "mind_map";
  if (normalized === "concept map") return "concept_map";
  if (normalized === "sequence diagram") return "sequence_diagram";
  if (normalized === "timeline") return "timeline";
  if (normalized === "comparison diagram") return "comparison_diagram";
  if (normalized === "study process diagram") return "study_process";
  return "flowchart";
}

function diagramSource(value: string): { source: VoiceDiagramSourceIntent; topic?: string } {
  const sourceText = value.trim();
  const normalized = normalize(sourceText);
  if (["this answer", "the answer", "current answer", "latest answer"].includes(normalized)) {
    return { source: "answer" };
  }
  if (["this summary", "the summary", "current summary", "ee summary", "ఈ సమ్మరీ"].includes(normalized)) {
    return { source: "summary" };
  }
  if (["this file", "the file", "current file", "uploaded file", "this document"].includes(normalized)) {
    return { source: "file" };
  }
  if (["this", "this topic", "this concept", "the concept"].includes(normalized) || !normalized) {
    return { source: "auto" };
  }
  return { source: "topic", topic: sourceText };
}

/** Extracts only explicit, anchored requests for an approved diagram type. */
function diagramCommand(text: string): {
  diagramType: VoiceDiagramType;
  source: VoiceDiagramSourceIntent;
  topic?: string;
} | null {
  const spoken = text.normalize("NFKC").trim();

  const mixedSummary = spoken.match(
    /^(?:ee\s+summary|ఈ\s+సమ్మరీ)\s+ki\s+mind\s+map\s+create\s+cheyyi[\s.!?।]*$/iu,
  );
  if (mixedSummary) return { diagramType: "mind_map", source: "summary" };

  if (/^show\s+this\s+concept\s+visually[\s.!?।]*$/iu.test(spoken)) {
    return { diagramType: "concept_map", source: "auto" };
  }

  const generic = spoken.match(
    /^(?:generate|create|make)\s+(?:a\s+|an\s+)?(study[-\s]+process\s+diagram|sequence\s+diagram|comparison\s+diagram|concept\s+map|mind\s+map|flowchart|timeline|diagram)(?:\s+(?:for|from|about|of)\s+(.+?))?[\s.!?।]*$/iu,
  );
  if (!generic) return null;

  const source = diagramSource(generic[2] ?? "");
  return {
    diagramType: approvedDiagramType(generic[1]),
    ...source,
  };
}

export const VOICE_COMMANDS: VoiceCommand[] = [
  {
    id: "open_dashboard",
    label: "Open dashboard",
    phrases: ["open dashboard", "go to dashboard", "show dashboard", "open home"],
    description: "Navigate to your study command center.",
  },
  {
    id: "open_files",
    label: "Open files",
    phrases: ["open files", "go to files", "show files", "open my files", "show my files"],
    description: "Navigate to your uploaded files and notes.",
  },
  {
    id: "open_quiz",
    label: "Open quiz",
    phrases: ["open quiz", "go to quiz", "show quiz", "open quizzes"],
    description: "Navigate to the quiz generator.",
  },
  {
    id: "open_revision",
    label: "Open revision",
    phrases: ["open revision", "go to revision", "show revision", "open revise"],
    description: "Navigate to your revision plan.",
  },
  {
    id: "important_notes",
    label: "Give important notes",
    phrases: ["give important notes", "important notes", "give me important notes", "key points", "important points"],
    description: "Ask StudyPilot for the key points across your material.",
  },
  {
    id: "explain_file",
    label: "Explain this file",
    phrases: ["explain this file", "explain the file", "explain this", "explain this document"],
    description: "Ask StudyPilot to explain your most recent file.",
  },
  {
    id: "generate_quiz",
    label: "Generate quiz",
    phrases: ["generate quiz", "create quiz", "make a quiz", "generate questions", "quiz me"],
    description: "Ask StudyPilot to generate practice questions from your material.",
  },
  {
    id: "create_revision_plan",
    label: "Create revision plan",
    phrases: ["create revision plan", "make revision plan", "revision plan", "plan my revision"],
    description: "Ask StudyPilot to build a revision plan from your material.",
  },
  {
    id: "web_search",
    label: "Search the web for a topic",
    phrases: [
      "search the web for",
      "search online for",
      "find current information about",
      "web lo search cheyyi",
    ],
    description: "Search current web sources and return a concise cited answer.",
    dynamic: true,
  },
  {
    id: "deep_research",
    label: "Research a topic deeply",
    phrases: [
      "research this topic deeply",
      "do deep research on",
      "ee topic meeda detailed research cheyyi",
      "compare these technologies using web sources",
    ],
    description: "Research a focused question across multiple current web sources.",
    dynamic: true,
  },
  {
    id: "generate_diagram",
    label: "Generate a diagram for a topic",
    phrases: [
      "generate a diagram for",
      "create a flowchart from this answer",
      "ee summary ki mind map create cheyyi",
      "make a sequence diagram",
      "show this concept visually",
    ],
    description: "Create a grounded study diagram from a topic, answer, summary, or file.",
    dynamic: true,
  },
  {
    id: "create_notes_answer",
    label: "Create notes from this answer",
    phrases: ["create notes from this answer"],
    description: "Prepare editable notes from the latest Voice Tutor answer.",
    exact: true,
  },
  {
    id: "create_notes_summary",
    label: "Create notes from this summary",
    phrases: ["create notes from this summary"],
    description: "Prepare editable notes from the saved summary for this file.",
    exact: true,
  },
  {
    id: "create_exam_notes",
    label: "Make exam notes",
    phrases: ["make exam notes"],
    description: "Prepare an exam-focused notes preview from the current source.",
    exact: true,
  },
  {
    id: "create_revision_notes",
    label: "Create one-page revision notes",
    phrases: ["create one page revision notes", "create one-page revision notes"],
    description: "Prepare a compact one-page revision notes preview.",
    exact: true,
  },
  {
    id: "save_notes",
    label: "Save this as notes",
    phrases: ["save this as notes"],
    description: "Ask for confirmation before saving the prepared note.",
    exact: true,
  },
  {
    id: "download_notes_pdf",
    label: "Download notes as PDF",
    phrases: ["download notes as pdf"],
    description: "Download the prepared note as a PDF.",
    exact: true,
  },
  {
    id: "download_notes_docx",
    label: "Download notes as DOCX",
    phrases: ["download notes as docx", "download notes as word"],
    description: "Download the prepared note as a Word document.",
    exact: true,
  },
  {
    id: "download_notes_markdown",
    label: "Download notes as Markdown",
    phrases: ["download notes as markdown"],
    description: "Download the prepared note as Markdown.",
    exact: true,
  },
  {
    id: "download_notes_text",
    label: "Download notes as text",
    phrases: ["download notes as text", "download notes as txt"],
    description: "Download the prepared note as plain text.",
    exact: true,
  },
];

// ── Greeting / conversational-intent helpers ──────────────────────────────

const GREETING_EXACT: string[] = [
  "hello", "hi", "hey", "helo", "hii", "heya", "howdy",
  "good morning", "good afternoon", "good evening", "good night", "good day",
  "how are you", "how r u", "how are u", "how do you do", "you there",
  "thanks", "thank you", "thank u", "thank you so much", "ty", "thx",
  "bye", "goodbye", "see you", "see ya", "see you later", "take care", "cya", "later",
  "ok", "okay", "sure", "alright", "cool", "great", "nice", "got it", "sounds good",
  "namaste", "vanakkam", "sup", "yo", "greetings",
  "shukriya", "dhanyavad", "dhanyavadam",
];

// Prefix tokens: if normalized starts with any of these words and nothing else
// substantial follows (≤ 3 extra words), treat as a greeting.
const GREETING_PREFIX_WORDS: string[] = ["hello", "hi", "hey", "helo"];

function isGreetingNormalized(normalized: string): boolean {
  if (GREETING_EXACT.includes(normalized)) return true;
  // "hey studypilot", "hello there", "hi study pilot" etc.
  const firstWord = normalized.split(" ")[0];
  if (GREETING_PREFIX_WORDS.includes(firstWord) && normalized.split(" ").length <= 3) {
    return true;
  }
  return false;
}

function greetingReplyForNormalized(normalized: string): string {
  if (normalized.startsWith("bye") || normalized.startsWith("goodbye") || normalized === "cya" || normalized === "see you" || normalized.startsWith("see you") || normalized === "take care" || normalized === "later") {
    return "Goodbye! Come back anytime you need study help. Best of luck!";
  }
  if (normalized.startsWith("thank") || normalized === "ty" || normalized === "thx" || normalized.startsWith("shukriya") || normalized.startsWith("dhanya")) {
    return "You're welcome! Let me know if you have any study questions.";
  }
  if (normalized.startsWith("how are") || normalized.startsWith("how r") || normalized.startsWith("how do you") || normalized === "you there") {
    return "I'm doing great and ready to help you study! What topic are we covering today?";
  }
  if (normalized === "ok" || normalized === "okay" || normalized === "sure" || normalized === "alright" || normalized === "cool" || normalized === "great" || normalized === "nice" || normalized === "got it" || normalized === "sounds good") {
    return "Great! Ask me anything about your study material — I'm here to help.";
  }
  if (normalized.startsWith("good morning")) return "Good morning! Ready to make today's study session count? What would you like to learn?";
  if (normalized.startsWith("good afternoon")) return "Good afternoon! What are we studying today?";
  if (normalized.startsWith("good evening")) return "Good evening! What topic should we revise tonight?";
  if (normalized === "namaste" || normalized === "vanakkam") return "Namaste! How can I help you study today?";
  // Default: any hello variant
  return "Hello! How can I help you study today?";
}

// ─────────────────────────────────────────────────────────────────────────────

// Phrases that must never be performed by voice. These are blocked at the
// command layer so a recognized destructive intent is rejected before it can
// reach the chat API or any navigation.
const BLOCKED_PHRASES = [
  "delete",
  "remove",
  "erase",
  "destroy",
  "wipe",
  "clear all",
  "clear my",
  "reset",
  "format",
  "empty",
  "permanently",
  "drop table",
  "truncate",
  "overwrite",
];

/** True when the spoken text contains a destructive intent we never act on. */
export function isDestructiveCommand(text: string): boolean {
  const normalized = normalize(text);
  return matchesAny(normalized, BLOCKED_PHRASES);
}

/**
 * Resolves recognized speech into a safe VoiceCommandOutcome.
 *
 * Returns `{ kind: "blocked" }` for destructive intents so the UI can warn the
 * user, `{ kind: "command", outcome }` for a documented StudyPilot command,
 * and `{ kind: "question" }` for any other free-form study question.
 */
export function resolveVoiceCommand(
  text: string,
): { kind: "blocked"; message: string } | { kind: "command"; outcome: VoiceCommandOutcome } | { kind: "question"; question: string } {
  const normalized = normalize(text);
  if (!normalized) return { kind: "question", question: text.trim() };

  // ── Greeting / conversational-intent fast path ───────────────────────────
  // Resolve before any other matching so the API is never called for casual
  // social phrases.
  if (isGreetingNormalized(normalized)) {
    const reply = greetingReplyForNormalized(normalized);
    return {
      kind: "command",
      outcome: { kind: "greeting", reply, message: reply },
    };
  }
  // ──────────────────────────────────────────────────────────────────────────

  // These anchored intents are read-only. Resolve them before destructive-word
  // blocking so a safe query such as "APA format" is not mistaken for an
  // actionable "format my files" command.
  const diagram = diagramCommand(text);
  if (diagram) {
    return {
      kind: "command",
      outcome: {
        kind: "diagram",
        ...diagram,
        message: "Generating your diagram...",
      },
    };
  }

  const researchQuery = deepResearchQuery(text);
  if (researchQuery !== null) {
    return {
      kind: "command",
      outcome: {
        kind: "deep_research",
        query: researchQuery,
        message: "Starting deep research...",
      },
    };
  }

  const query = webSearchQuery(text);
  if (query !== null) {
    return {
      kind: "command",
      outcome: {
        kind: "web_search",
        query,
        message: "Searching the web...",
      },
    };
  }

  if (isDestructiveCommand(normalized)) {
    return {
      kind: "blocked",
      message: "For your safety, StudyPilot cannot delete, remove, or change files by voice. Destructive actions are not available through the Voice Tutor.",
    };
  }

  const matched = VOICE_COMMANDS.find((command) => matchesCommand(normalized, command));
  if (!matched) return { kind: "question", question: text.trim() };

  switch (matched.id) {
    case "open_dashboard":
      return { kind: "command", outcome: { kind: "navigate", href: "/dashboard", message: "Opening your dashboard..." } };
    case "open_files":
      return { kind: "command", outcome: { kind: "navigate", href: "/files", message: "Opening your files..." } };
    case "open_quiz":
      return { kind: "command", outcome: { kind: "navigate", href: "/quiz", message: "Opening the quiz generator..." } };
    case "open_revision":
      return { kind: "command", outcome: { kind: "navigate", href: "/revision", message: "Opening your revision plan..." } };
    case "important_notes":
      return {
        kind: "command",
        outcome: {
          kind: "ask",
          question: "Give me the important notes and key points from my study material. Cover all major topics fairly.",
          message: "Asking StudyPilot for important notes...",
        },
      };
    case "explain_file":
      return {
        kind: "command",
        outcome: {
          kind: "ask",
          question: "Explain this file in simple words. Cover the main ideas and how they connect.",
          message: "Asking StudyPilot to explain your latest file...",
        },
      };
    case "generate_quiz":
      return {
        kind: "command",
        outcome: {
          kind: "ask",
          question: "Generate a short practice quiz with questions and answers from my study material.",
          message: "Asking StudyPilot to generate a quiz...",
        },
      };
    case "create_revision_plan":
      return {
        kind: "command",
        outcome: {
          kind: "ask",
          question: "Create a revision plan from my study material, ordered by priority for exam preparation.",
          message: "Asking StudyPilot to create a revision plan...",
        },
      };
    case "create_notes_answer":
      return {
        kind: "command",
        outcome: {
          kind: "notes",
          action: "create",
          source: "answer",
          style: "standard",
          message: "Preparing editable notes from the latest answer...",
        },
      };
    case "create_notes_summary":
      return {
        kind: "command",
        outcome: {
          kind: "notes",
          action: "create",
          source: "summary",
          style: "standard",
          message: "Preparing editable notes from the saved summary...",
        },
      };
    case "create_exam_notes":
      return {
        kind: "command",
        outcome: {
          kind: "notes",
          action: "create",
          source: "auto",
          style: "exam",
          message: "Preparing editable exam notes...",
        },
      };
    case "create_revision_notes":
      return {
        kind: "command",
        outcome: {
          kind: "notes",
          action: "create",
          source: "auto",
          style: "one_page",
          message: "Preparing editable one-page revision notes...",
        },
      };
    case "save_notes":
      return {
        kind: "command",
        outcome: {
          kind: "notes",
          action: "save",
          message: "A prepared note is required before saving.",
        },
      };
    case "download_notes_pdf":
    case "download_notes_docx":
    case "download_notes_markdown":
    case "download_notes_text": {
      const format: VoiceNoteExportFormat =
        matched.id === "download_notes_pdf"
          ? "pdf"
          : matched.id === "download_notes_docx"
            ? "docx"
            : matched.id === "download_notes_markdown"
              ? "markdown"
              : "text";
      return {
        kind: "command",
        outcome: {
          kind: "notes",
          action: "download",
          format,
          message: "A prepared note is required before downloading.",
        },
      };
    }
    default:
      return { kind: "question", question: text.trim() };
  }
}

/**
 * Wraps a free-form study question with the selected language instruction so
 * the AI replies in the same language style as the user. Used for both normal
 * questions and "ask" command outcomes.
 */
export function withLanguageStyle(question: string, languageName: string): string {
  if (!languageName) return question;
  return `Reply in ${languageName}, matching the language and style of the question.\n\n${question}`;
}
