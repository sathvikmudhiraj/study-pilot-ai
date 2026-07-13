"use client";

import { useState } from "react";

export function Generator({ type }: { type: "summary" | "quiz" }) {
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isQuiz = type === "quiz";

  async function generate() {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isQuiz ? { count: 8 } : { style: "exam-focused" }),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }
    setOutput(isQuiz ? data.quiz.content : data.summary);
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{isQuiz ? "MCQ quiz builder" : "Summary generator"}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {isQuiz ? "Generate practice questions with answers from your notes." : "Create a structured revision summary from your notes."}
            </p>
          </div>
          <button onClick={generate} disabled={loading} className="h-10 rounded-md bg-emerald-400 px-5 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60">
            {loading ? "Generating..." : isQuiz ? "Generate quiz" : "Generate summary"}
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      </div>
      {output ? (
        <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-slate-950/70 p-5 text-sm leading-7 text-slate-200">{output}</pre>
      ) : null}
    </div>
  );
}
