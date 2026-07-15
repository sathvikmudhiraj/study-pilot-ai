"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types (mirror backend, but nullable for initial state from server)
// ---------------------------------------------------------------------------

type DayPlan = {
  day: number;
  date: string;
  focus_topics: string[];
  tasks: string[];
  estimated_time: string;
};

type PlanMeta = {
  total_days: number;
  next_steps: string[];
  study_tips: string[];
  strong_topics: string[];
  weak_topics: string[];
  last_quiz_score: {
    score: number;
    total: number;
    percentage: number;
    attempted_at: string;
  } | null;
};

type RevisionPlan = {
  id?: string;
  title: string | null;
  important_topics: string[];
  revise_first: string[];
  pending_topics: string[];
  daily_plan: DayPlan[];
  plan: PlanMeta | Record<string, unknown>;
  starts_on: string | null;
  ends_on: string | null;
  created_at?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function dayPlans(value: unknown): DayPlan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const d = item as Record<string, unknown>;
      return {
        day: Number(d.day ?? d.day_number) || 1,
        date: String(d.date ?? "").trim(),
        focus_topics: list(d.focus_topics ?? d.focusTopics ?? d.topics),
        tasks: list(d.tasks ?? d.study_tasks ?? d.activities),
        estimated_time: String(d.estimated_time ?? d.time ?? d.duration ?? "1 hour").trim() || "1 hour",
      };
    })
    .filter((d): d is DayPlan => Boolean(d));
}

function planMeta(value: unknown): PlanMeta {
  if (!value || typeof value !== "object") {
    return { total_days: 0, next_steps: [], study_tips: [], strong_topics: [], weak_topics: [], last_quiz_score: null };
  }
  const p = value as Record<string, unknown>;
  const rawScore = p.last_quiz_score ?? p.lastQuizScore;
  const score = rawScore && typeof rawScore === "object" ? (rawScore as Record<string, unknown>) : null;
  return {
    total_days: Number(p.total_days ?? p.totalDays) || 0,
    next_steps: list(p.next_steps ?? p.nextSteps),
    study_tips: list(p.study_tips ?? p.studyTips),
    strong_topics: list(p.strong_topics ?? p.strongTopics),
    weak_topics: list(p.weak_topics ?? p.weakTopics),
    last_quiz_score: score
      ? {
          score: Number(score.score) || 0,
          total: Number(score.total) || 0,
          percentage: Number(score.percentage) || 0,
          attempted_at: String(score.attempted_at ?? score.attemptedAt ?? ""),
        }
      : null,
  };
}

function normalizePlan(raw: RevisionPlan | null): RevisionPlan | null {
  if (!raw) return null;
  return {
    ...raw,
    title: raw.title ?? "Revision Plan",
    important_topics: list(raw.important_topics),
    revise_first: list(raw.revise_first),
    pending_topics: list(raw.pending_topics),
    daily_plan: dayPlans(raw.daily_plan),
    plan: planMeta(raw.plan),
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TopicBadgeList({ items, color }: { items: string[]; color: "emerald" | "amber" | "slate" }) {
  if (!items.length) return null;
  const borderColor = color === "emerald" ? "border-emerald-400/30 bg-emerald-400/10" : color === "amber" ? "border-amber-400/30 bg-amber-400/10" : "border-white/10 bg-white/[0.04]";
  const textColor = color === "emerald" ? "text-emerald-200" : color === "amber" ? "text-amber-200" : "text-slate-300";

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span key={item} className={`max-w-full break-words rounded-md border ${borderColor} px-3 py-1 text-sm ${textColor}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function DayCard({ day }: { day: DayPlan }) {
  return (
    <article className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-lg font-bold text-white">Day {day.day}</h4>
          {day.date ? <p className="text-xs text-slate-500">{formatDate(day.date)}</p> : null}
        </div>
        {day.estimated_time ? (
          <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
            {day.estimated_time}
          </span>
        ) : null}
      </div>

      {day.focus_topics.length ? (
        <div className="mt-4">
          <h5 className="text-xs font-semibold uppercase text-emerald-300">Focus topics</h5>
          <div className="mt-2 flex flex-wrap gap-2">
            {day.focus_topics.map((topic) => (
              <span key={topic} className="max-w-full break-words rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
                {topic}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {day.tasks.length ? (
        <ul className="mt-4 grid gap-2 text-sm text-slate-300">
          {day.tasks.map((task) => (
            <li key={task} className="flex min-w-0 items-start gap-2 break-words">
              <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              {task}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RevisionPlanPanel({ initialPlan }: { initialPlan: RevisionPlan | null }) {
  const [plan, setPlan] = useState<RevisionPlan | null>(() => normalizePlan(initialPlan));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/revision", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not generate revision plan.");
      }

      setPlan(normalizePlan(data.plan));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not generate revision plan.";
      if (plan) {
        setNotice(`Could not refresh the plan. Your saved plan is still shown. ${message}`);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="grid min-w-0 gap-5">
      {/* Header */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase text-emerald-300">AI Revision Planner</div>
          <h2 className="mt-2 break-words text-xl font-bold text-white sm:text-2xl">{plan?.title || "Revision Plan"}</h2>
          {plan?.starts_on && plan?.ends_on ? (
            <p className="mt-1 text-sm text-slate-400">
              {formatDate(plan.starts_on)} - {formatDate(plan.ends_on)}
            </p>
          ) : null}
          {plan?.created_at ? (
            <p className="text-xs text-slate-500">Generated {new Date(plan.created_at).toLocaleDateString()}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="h-10 w-full rounded-md bg-emerald-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {loading ? "Generating..." : plan ? "Regenerate Plan" : "Generate Plan"}
        </button>
      </div>

      {/* Error */}
      {error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200">{error}</div>
      ) : null}

      {/* Notice */}
      {notice ? (
        <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">{notice}</div>
      ) : null}

      {/* Empty state */}
      {!plan && !loading ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/70 p-8 text-center">
          <h3 className="text-lg font-semibold text-white">No revision plan yet</h3>
          <p className="mt-2 max-w-md mx-auto text-sm leading-6 text-slate-400">
            Generate a structured 7-day revision plan from your uploaded files, notes, AI summaries, and quiz results. StudyPilot will analyze your material and create a daily schedule with focused topics and tasks.
          </p>
        </div>
      ) : null}

      {/* Loading */}
      {loading ? (
        <div
          className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-5 text-sm text-emerald-100"
          role="status"
          aria-live="polite"
        >
          Analyzing your study material and generating a revision plan...
        </div>
      ) : null}

      {/* Plan content */}
      {plan ? (
        <>
          {((plan.plan as PlanMeta).last_quiz_score || (plan.plan as PlanMeta).weak_topics.length || (plan.plan as PlanMeta).strong_topics.length) ? (
            <section className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-xs font-semibold uppercase text-slate-400">Last quiz score</h3>
                <div className="mt-2 text-2xl font-bold text-white">
                  {(plan.plan as PlanMeta).last_quiz_score
                    ? `${Math.round((plan.plan as PlanMeta).last_quiz_score!.percentage)}%`
                    : "No attempt"}
                </div>
              </div>
              <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-4">
                <h3 className="text-xs font-semibold uppercase text-amber-200">Weak topics</h3>
                <div className="mt-3">
                  {(plan.plan as PlanMeta).weak_topics.length
                    ? <TopicBadgeList items={(plan.plan as PlanMeta).weak_topics} color="amber" />
                    : <p className="text-sm text-slate-400">None tracked yet.</p>}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
                <h3 className="text-xs font-semibold uppercase text-emerald-200">Strong topics</h3>
                <div className="mt-3">
                  {(plan.plan as PlanMeta).strong_topics.length
                    ? <TopicBadgeList items={(plan.plan as PlanMeta).strong_topics} color="emerald" />
                    : <p className="text-sm text-slate-400">None tracked yet.</p>}
                </div>
              </div>
            </section>
          ) : null}

          {/* Revise first — priority */}
          {plan.revise_first.length ? (
            <section className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 sm:p-5">
              <h3 className="text-sm font-semibold uppercase text-amber-200">Revise first - high priority</h3>
              <p className="mt-1 text-xs text-slate-400">These topics are most exam-critical or need the most attention.</p>
              <div className="mt-3">
                <TopicBadgeList items={plan.revise_first} color="amber" />
              </div>
            </section>
          ) : null}

          {/* Important topics */}
          {plan.important_topics.length ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <h3 className="text-sm font-semibold uppercase text-emerald-200">Important topics</h3>
              <div className="mt-3">
                <TopicBadgeList items={plan.important_topics} color="emerald" />
              </div>
            </section>
          ) : null}

          {/* Pending topics */}
          {plan.pending_topics.length ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <h3 className="text-sm font-semibold uppercase text-slate-300">Pending topics</h3>
              <p className="mt-1 text-xs text-slate-500">Topics to schedule after the initial revision cycle.</p>
              <div className="mt-3">
                <TopicBadgeList items={plan.pending_topics} color="slate" />
              </div>
            </section>
          ) : null}

          {/* Daily plan */}
          {plan.daily_plan.length ? (
            <section>
              <h3 className="mb-4 text-sm font-semibold uppercase text-emerald-200">Daily plan</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {plan.daily_plan.map((day) => (
                  <DayCard key={day.day} day={day} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Next steps */}
          {plan.plan && (plan.plan as PlanMeta).next_steps?.length ? (
            <section className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-4 sm:p-5">
              <h3 className="text-sm font-semibold uppercase text-cyan-200">Next steps</h3>
              <ul className="mt-3 grid gap-2 text-sm text-slate-300">
                {(plan.plan as PlanMeta).next_steps.map((step) => (
                  <li key={step} className="flex min-w-0 items-start gap-2 break-words">
                    <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                    {step}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Study tips */}
          {plan.plan && (plan.plan as PlanMeta).study_tips?.length ? (
            <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <h3 className="text-sm font-semibold uppercase text-emerald-200">Study tips</h3>
              <ul className="mt-3 grid gap-2 text-sm text-slate-400">
                {(plan.plan as PlanMeta).study_tips.map((tip) => (
                  <li key={tip} className="flex min-w-0 items-start gap-2 break-words">
                    <span className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/60" />
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
