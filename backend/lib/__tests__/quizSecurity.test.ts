import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { gradeQuizAttempt } from "../quizAnalytics";
import {
  buildReviewAnswerKey,
  findUnknownAnswerQuestionIds,
  normalizeSubmittedAnswers,
  sanitizeQuizForClient,
} from "../quizSecurity";

const questions = [
  {
    id: "q1",
    type: "mcq",
    topic: "Hill Cipher",
    question: "Which operation is used in Hill Cipher encryption?",
    options: ["XOR", "Matrix multiplication mod 26", "Prime factorization"],
    correct_index: 1,
    explanation: "Hill Cipher multiplies a plaintext vector by a key matrix modulo 26.",
    grading_rubric: "Choose the matrix multiplication option.",
    metadata: {
      safe_label: "linear algebra",
      correct_answer: "Matrix multiplication mod 26",
    },
  },
  {
    id: "q2",
    type: "short",
    topic: "Hill Cipher",
    question: "What must the key matrix have modulo 26?",
    acceptable_answers: ["an inverse", "invertible matrix"],
    explanation: "Decryption needs the inverse of the key matrix modulo 26.",
  },
];

const answerKey = [
  {
    id: "q1",
    type: "mcq",
    topic: "Hill Cipher",
    correct_index: 1,
    acceptable_answers: [],
    explanation: "Hill Cipher multiplies a plaintext vector by a key matrix modulo 26.",
  },
  {
    id: "q2",
    type: "short",
    topic: "Hill Cipher",
    correct_index: null,
    acceptable_answers: ["an inverse", "invertible matrix"],
    explanation: "Decryption needs the inverse of the key matrix modulo 26.",
  },
];

describe("quiz response security", () => {
  it("sanitizes saved quiz load responses before submission", () => {
    const quiz = sanitizeQuizForClient({
      id: "quiz-1",
      file_id: "file-1",
      note_id: null,
      quiz_title: "Hill Cipher quiz",
      title: "Hill Cipher quiz",
      difficulty: "medium",
      questions,
      answer_key: answerKey,
      created_at: "2026-07-14T00:00:00.000Z",
    });

    const serialized = JSON.stringify(quiz);
    expect(serialized).not.toContain("answer_key");
    expect(serialized).not.toContain("correct_index");
    expect(serialized).not.toContain("acceptable_answers");
    expect(serialized).not.toContain("grading_rubric");
    expect(serialized).not.toContain("Decryption needs the inverse");
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0]).toMatchObject({
      id: "q1",
      question: "Which operation is used in Hill Cipher encryption?",
      options: ["XOR", "Matrix multiplication mod 26", "Prime factorization"],
      display_order: 1,
    });
  });

  it("sanitizes generated quiz responses before submission", () => {
    const quiz = sanitizeQuizForClient(
      {
        id: "quiz-2",
        quiz_title: "Generated quiz",
        title: "Generated quiz",
        difficulty: "easy",
        questions: [],
        created_at: "2026-07-14T00:00:00.000Z",
      },
      { questions, source_summary: "Generated from selected material." },
    );

    const serialized = JSON.stringify(quiz);
    expect(serialized).not.toContain("answer_key");
    expect(serialized).not.toContain("correct_index");
    expect(serialized).not.toContain("acceptable_answers");
    expect(serialized).not.toContain("explanation");
    expect(quiz.source_summary).toBe("Generated from selected material.");
  });

  it("returns correct answers only from the post-submit review mapper", () => {
    const review = buildReviewAnswerKey({ questions, answerKey });

    expect(review).toEqual(answerKey);
    expect(JSON.stringify(review)).toContain("correct_index");
    expect(JSON.stringify(review)).toContain("Decryption needs the inverse");
  });
});

describe("quiz server-side grading inputs", () => {
  it("grades from the authoritative database answer key", () => {
    const graded = gradeQuizAttempt({
      questions,
      answerKey,
      answers: { q1: "1", q2: "invertible matrix" },
    });

    expect(graded.score).toBe(2);
    expect(graded.total_questions).toBe(2);
    expect(graded.user_answers).toEqual([
      { question_id: "q1", topic: "Hill Cipher", user_answer: "1", is_correct: true },
      { question_id: "q2", topic: "Hill Cipher", user_answer: "invertible matrix", is_correct: true },
    ]);
  });

  it("ignores fake client-provided answer keys while grading", () => {
    const submitted = normalizeSubmittedAnswers([
      { questionId: "q1", selectedAnswer: "0", correct_index: 0 },
      { questionId: "q2", selectedAnswer: "wrong", acceptable_answers: ["wrong"] },
    ]);
    const graded = gradeQuizAttempt({ questions, answerKey, answers: submitted.answers });

    expect(submitted.invalid).toBe(false);
    expect(graded.score).toBe(0);
  });

  it("rejects unknown question IDs before grading", () => {
    const submitted = normalizeSubmittedAnswers([{ questionId: "q999", selectedAnswer: "1" }]);

    expect(findUnknownAnswerQuestionIds(questions, submitted.answers)).toEqual(["q999"]);
  });

  it("rejects duplicate question IDs in pair submissions", () => {
    const submitted = normalizeSubmittedAnswers([
      { questionId: "q1", selectedAnswer: "1" },
      { questionId: "q1", selectedAnswer: "0" },
    ]);

    expect(submitted.duplicateQuestionIds).toEqual(["q1"]);
  });
});
