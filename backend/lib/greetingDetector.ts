/**
 * Lightweight conversational-intent detector.
 *
 * Matches casual greetings and social phrases BEFORE any file-context lookup or
 * offline fallback so the AI never gets a trivial greeting wrapped in PDF text.
 *
 * Rules:
 *  - Strip punctuation and normalise to lowercase before matching.
 *  - Match by prefix or exact set – never substring-only, to avoid false
 *    positives on real study questions.
 *  - File-reference phrases ("explain this file", "my notes", "this PDF")
 *    are purposely NOT matched here and fall through to the normal pipeline.
 */

/** Phrases that are pure conversational intents with no study content. */
const GREETING_PATTERNS: RegExp[] = [
  // Plain hellos
  /^hel+o+[!?.,\s]*$/i,
  /^h[iíì]+[!?.,\s]*$/i,
  /^hey+(\s+(?:there|studypilot|study\s*pilot))?[!?.,\s]*$/i,
  /^h[ae]llo+(\s+(?:there|studypilot|study\s*pilot))?[!?.,\s]*$/i,

  // Time-of-day greetings
  /^good\s+(morning|afternoon|evening|night)[!?.,\s]*$/i,
  /^good\s+day[!?.,\s]*$/i,
  /^sup[!?.,\s]*$/i,
  /^yo[!?.,\s]*$/i,
  /^greetings[!?.,\s]*$/i,
  /^howdy[!?.,\s]*$/i,
  /^namaste[!?.,\s]*$/i,
  /^vanakkam[!?.,\s]*$/i,

  // How are you
  /^how\s+are\s+(you|u)\??[!?.,\s]*$/i,
  /^how\s+r\s+u\??[!?.,\s]*$/i,
  /^what['']?s\s+up[!?.,\s]*$/i,
  /^how\s+do\s+you\s+do[!?.,\s]*$/i,
  /^you\s+there\??[!?.,\s]*$/i,

  // Thanks
  /^thank(s|\s+you|\s+u)?[!?.,\s]*$/i,
  /^thank(s|\s+you|\s+u)?(\s+so\s+much|\s+a\s+lot|\s+very\s+much)?[!?.,\s]*$/i,
  /^ty[!?.,\s]*$/i,
  /^thx[!?.,\s]*$/i,
  /^dhanyavaad(am)?[!?.,\s]*$/i,
  /^shukriya[!?.,\s]*$/i,

  // Bye / closing
  /^bye[!?.,\s]*$/i,
  /^good\s+bye[!?.,\s]*$/i,
  /^goodbye[!?.,\s]*$/i,
  /^see\s+(you|ya)\s*(later|soon|around)?[!?.,\s]*$/i,
  /^cya[!?.,\s]*$/i,
  /^take\s+care[!?.,\s]*$/i,
  /^later[!?.,\s]*$/i,

  // Affirmations
  /^ok(ay)?[!?.,\s]*$/i,
  /^sure[!?.,\s]*$/i,
  /^alright[!?.,\s]*$/i,
  /^cool[!?.,\s]*$/i,
  /^great[!?.,\s]*$/i,
  /^nice[!?.,\s]*$/i,
  /^got\s+it[!?.,\s]*$/i,
  /^sounds\s+good[!?.,\s]*$/i,
];

/**
 * Test whether the trimmed question is a casual conversational phrase.
 * Matches after stripping leading/trailing punctuation and whitespace.
 */
export function isGreeting(question: string): boolean {
  const cleaned = question.trim();
  return GREETING_PATTERNS.some((pattern) => pattern.test(cleaned));
}

// ---------------------------------------------------------------------------
// Natural short responses
// ---------------------------------------------------------------------------

const HELLO_VARIANTS = ["hi", "hey", "hello", "helo", "hii", "heya"];
const BYE_VARIANTS = ["bye", "goodbye", "cya", "later", "see you", "see ya", "take care"];
const THANKS_VARIANTS = ["thank", "thanks", "ty", "thx", "dhanya", "shukriya"];
const HOW_ARE_VARIANTS = ["how are", "how r u", "how do you", "what's up", "whats up", "sup", "yo"];
const AFFIRM_VARIANTS = ["ok", "okay", "sure", "alright", "cool", "great", "nice", "got it", "sounds good"];

function containsAny(lower: string, list: string[]): boolean {
  return list.some((v) => lower.includes(v));
}

/**
 * Return a concise, friendly response for a conversational message.
 * Never includes PDF content, citations, or previous answers.
 */
export function greetingResponse(question: string): string {
  const lower = question.toLowerCase().replace(/[^a-z\s]/g, " ").trim();

  if (containsAny(lower, BYE_VARIANTS)) {
    return "Goodbye! Come back anytime you need study help. Best of luck! 🎓";
  }

  if (containsAny(lower, THANKS_VARIANTS)) {
    return "You're welcome! Let me know if you have any study questions.";
  }

  if (containsAny(lower, HOW_ARE_VARIANTS)) {
    return "I'm doing great and ready to help you study! What topic are we covering today?";
  }

  if (containsAny(lower, AFFIRM_VARIANTS)) {
    return "Great! Ask me anything about your study material — I'm here to help.";
  }

  if (containsAny(lower, HELLO_VARIANTS)) {
    return "Hello! How can I help you study today?";
  }

  // Namaste / time-of-day greetings
  if (lower.includes("good morning")) {
    return "Good morning! Ready to make today's study session count? What would you like to learn?";
  }
  if (lower.includes("good afternoon")) {
    return "Good afternoon! What are we studying today?";
  }
  if (lower.includes("good evening")) {
    return "Good evening! What topic should we revise tonight?";
  }
  if (lower.includes("namaste") || lower.includes("vanakkam")) {
    return "Namaste! How can I help you study today?";
  }

  // Generic fallback for any other matched greeting
  return "Hello! How can I help you study today?";
}
