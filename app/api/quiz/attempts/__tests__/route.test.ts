import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/backend/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { POST } from "../route";

const questions = [
  {
    id: "q1",
    type: "mcq",
    topic: "Hill Cipher",
    question: "Which operation is used in Hill Cipher encryption?",
    options: ["XOR", "Matrix multiplication mod 26"],
    correct_index: 1,
    explanation: "Hill Cipher uses matrix multiplication modulo 26.",
  },
];

const answerKey = [
  {
    id: "q1",
    type: "mcq",
    topic: "Hill Cipher",
    correct_index: 1,
    acceptable_answers: [],
    explanation: "Hill Cipher uses matrix multiplication modulo 26.",
  },
];

function request(body: unknown) {
  return new Request("http://localhost/api/quiz/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function queryChain(result: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
}

function attemptsTable(savedResult = { data: { id: "attempt-1", quiz_id: "quiz-1", score: 1, total_questions: 1, percentage: 100, wrong_questions: [], weak_topics: [], strong_topics: ["Hill Cipher"], created_at: "2026-07-14T00:00:00.000Z" }, error: null }) {
  return {
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => savedResult),
      })),
    })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    })),
  };
}

function supabaseForQuiz(quizResult: unknown) {
  const quizzes = queryChain(quizResult);
  const attempts = attemptsTable();
  const client = {
    from: vi.fn((table: string) => {
      if (table === "quizzes") return quizzes;
      if (table === "quiz_attempts") return attempts;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client, quizzes, attempts };
}

describe("quiz attempt route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
  });

  it("rejects invalid quiz IDs before attempt persistence", async () => {
    const { client, attempts } = supabaseForQuiz({ data: null, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const response = await POST(request({ quizId: "foreign-quiz", answers: [{ questionId: "q1", selectedAnswer: "1" }] }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
    expect(attempts.insert).not.toHaveBeenCalled();
  });

  it("rejects tampered score submissions", async () => {
    const { client, attempts } = supabaseForQuiz({ data: { id: "quiz-1", file_id: "file-1", questions, answer_key: answerKey }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const response = await POST(request({
      quizId: "quiz-1",
      fileId: "file-1",
      score: 999,
      answers: [{ questionId: "q1", selectedAnswer: "0" }],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/scores are not accepted/i);
    expect(attempts.insert).not.toHaveBeenCalled();
  });

  it("rejects missing answers", async () => {
    const { client, attempts } = supabaseForQuiz({ data: { id: "quiz-1", file_id: "file-1", questions, answer_key: answerKey }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const response = await POST(request({ quizId: "quiz-1", fileId: "file-1" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/submit answers/i);
    expect(attempts.insert).not.toHaveBeenCalled();
  });

  it("rejects unknown question IDs before grading", async () => {
    const { client, attempts } = supabaseForQuiz({ data: { id: "quiz-1", file_id: "file-1", questions, answer_key: answerKey }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const response = await POST(request({ quizId: "quiz-1", answers: [{ questionId: "q999", selectedAnswer: "1" }] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/unknown questions/i);
    expect(attempts.insert).not.toHaveBeenCalled();
  });

  it("grades normal submissions on the server and saves the verified result", async () => {
    const { client, attempts } = supabaseForQuiz({ data: { id: "quiz-1", file_id: "file-1", questions, answer_key: answerKey }, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue(client);

    const response = await POST(request({ quizId: "quiz-1", fileId: "file-1", answers: [{ questionId: "q1", selectedAnswer: "1", correct_index: 0 }] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(attempts.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", quiz_id: "quiz-1", score: 1 }));
    expect(body).toMatchObject({
      score: 1,
      totalQuestions: 1,
      percentage: 100,
      correctAnswers: [{ questionId: "q1", userAnswer: "1" }],
      wrongAnswers: [],
    });
    expect(body.answer_key).toEqual(answerKey);
    expect(body.attempt.user_answers).toEqual([{ question_id: "q1", topic: "Hill Cipher", user_answer: "1", is_correct: true }]);
  });
});
