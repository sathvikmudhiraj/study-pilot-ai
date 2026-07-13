import Link from "next/link";
import { getCurrentUser } from "@/backend/lib/auth";
import { LandingScene } from "@/frontend/components/LandingScene";

const navItems = [
  ["Features", "#features"],
  ["Workflow", "#workflow"],
  ["Security", "#security"],
];

const studySignals = [
  ["Uploaded notes", "14 files", "Files and typed notes organized by topic"],
  ["AI summary ready", "Ready", "Key points prepared for quick review"],
  ["Quiz generated", "8 MCQs", "Practice questions for recall checks"],
  ["Next revision topic", "Biology", "A focused topic for your next session"],
  ["Protected workspace", "Secured", "Private routes and user-owned records"],
];

const features = [
  ["SUM", "File Summaries", "Turn dense study material into clear briefs with exam-ready structure."],
  ["AI", "Ask My Notes", "Ask doubts from your own material and get focused explanations."],
  ["QZ", "Quiz Generator", "Create quick practice questions to test recall before exams."],
  ["RP", "Revision Planner", "Know what to revise next instead of guessing every session."],
];

const workflow = [
  ["Upload files or notes", "Bring class material, typed notes, and study files into the workspace."],
  ["Extract and organize content", "StudyPilot turns material into clean, searchable learning context."],
  ["Ask doubts and generate summaries", "Get explanations, summaries, and study outputs from your notes."],
  ["Practice with quizzes and revise with plans", "Move into active recall with quizzes and focused revision topics."],
];

const securityItems = [
  "Supabase Auth",
  "Row Level Security",
  "User-owned data",
  "Gemini key stays server-side",
  "Protected routes",
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  const primaryCta = user
    ? { href: "/dashboard", label: "Open workspace" }
    : { href: "/auth?mode=signup", label: "Start studying free" };
  const loginCta = { href: "/auth?mode=login", label: "Login" };

  return (
    <main className="min-h-screen overflow-hidden bg-[#040711] text-slate-100">
      <section className="relative min-h-svh border-b border-white/10">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_22%,rgba(20,184,166,0.18),transparent_30%),radial-gradient(circle_at_18%_82%,rgba(34,211,238,0.1),transparent_28%)]" />

        <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-emerald-300/35 bg-emerald-300/10 text-sm font-bold text-emerald-200 shadow-lg shadow-emerald-950/30">
              SP
            </div>
            <div>
              <div className="font-semibold text-white">StudyPilot AI</div>
              <div className="text-xs text-slate-400">Secure student workspace</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            {navItems.map(([label, href]) => (
              <a key={label} href={href} className="transition hover:text-emerald-200">
                {label}
              </a>
            ))}
            <Link href={loginCta.href} className="rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 font-semibold text-white transition hover:border-emerald-300/40 hover:bg-emerald-300/10 hover:text-emerald-100">
              {loginCta.label}
            </Link>
          </nav>

          <Link href={loginCta.href} className="inline-flex h-10 items-center rounded-lg border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:border-emerald-300/40 hover:bg-emerald-300/10 md:hidden">
            {loginCta.label}
          </Link>
        </header>

        <div className="relative z-10 mx-auto grid min-h-[calc(100svh-82px)] max-w-7xl items-center gap-10 px-5 pb-14 pt-6 sm:px-6 sm:pb-16 sm:pt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12 lg:pt-0">
          <div className="relative min-w-0 max-w-3xl">
            <div aria-hidden="true" className="pointer-events-none absolute -left-10 -top-10 hidden h-[520px] w-[620px] opacity-45 md:block">
              <div className="absolute left-8 top-16 h-36 w-52 rounded-lg border border-emerald-200/18 bg-emerald-200/[0.045] shadow-2xl shadow-emerald-950/30 backdrop-blur-sm [transform:perspective(760px)_rotateY(-26deg)_rotateX(12deg)_rotateZ(-8deg)]">
                <div className="ml-5 mt-7 h-1.5 w-28 rounded-full bg-emerald-200/35" />
                <div className="ml-5 mt-4 h-1.5 w-36 rounded-full bg-white/14" />
                <div className="ml-5 mt-3 h-1.5 w-24 rounded-full bg-white/12" />
              </div>
              <div className="absolute left-80 top-6 h-28 w-44 rounded-lg border border-cyan-200/16 bg-cyan-200/[0.035] shadow-2xl shadow-cyan-950/20 backdrop-blur-sm [transform:perspective(720px)_rotateY(24deg)_rotateX(14deg)_rotateZ(7deg)]">
                <div className="ml-5 mt-7 h-1.5 w-24 rounded-full bg-cyan-200/32" />
                <div className="ml-5 mt-4 h-1.5 w-28 rounded-full bg-white/12" />
              </div>
              <div className="absolute bottom-8 left-28 h-32 w-48 rounded-lg border border-emerald-200/14 bg-slate-900/22 shadow-2xl shadow-black/20 backdrop-blur-sm [transform:perspective(780px)_rotateY(-18deg)_rotateX(-10deg)_rotateZ(6deg)]">
                <div className="ml-5 mt-7 h-1.5 w-28 rounded-full bg-emerald-200/25" />
                <div className="ml-5 mt-4 h-1.5 w-32 rounded-full bg-white/12" />
                <div className="ml-5 mt-3 h-1.5 w-20 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="mb-6 inline-flex rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 shadow-lg shadow-emerald-950/20 backdrop-blur">
              AI study workspace for focused learners
            </div>
            <h1 className="max-w-4xl text-4xl font-bold leading-[1.08] tracking-normal text-white sm:text-5xl xl:text-[4rem]">
              Upload notes. Ask doubts. Revise smarter.
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
              StudyPilot AI turns your files and notes into summaries, quizzes, revision plans, and focused explanations inside a secure student workspace.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href={primaryCta.href} className="inline-flex h-12 items-center justify-center rounded-lg bg-emerald-300 px-6 text-sm font-bold text-slate-950 shadow-xl shadow-emerald-950/35 transition hover:-translate-y-0.5 hover:bg-emerald-200 hover:shadow-emerald-900/40">
                {primaryCta.label}
              </Link>
            </div>

            <div className="mt-11 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                ["Exam-ready", "Clear summaries and quizzes"],
                ["Fast revision", "Focused next study steps"],
                ["Private", "User-owned workspace"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-slate-950/58 p-4 shadow-xl shadow-black/15 backdrop-blur">
                  <div className="text-xs font-semibold uppercase text-emerald-200">{label}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-300">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative min-w-0">
            <div className="relative min-h-[640px] overflow-hidden rounded-lg border border-emerald-300/20 bg-slate-950/48 shadow-2xl shadow-emerald-950/25 backdrop-blur-xl sm:min-h-[660px] md:min-h-[600px]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_46%,rgba(16,185,129,0.2),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(34,211,238,0.14),transparent_24%)]" />
              <LandingScene />

              <div className="absolute left-4 right-4 top-4 rounded-lg border border-white/10 bg-slate-950/68 p-4 shadow-xl shadow-black/25 backdrop-blur-xl sm:left-5 sm:right-auto sm:w-[330px]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-emerald-200">StudyPilot workspace</div>
                    <div className="mt-2 text-lg font-bold text-white">Today&apos;s learning board</div>
                  </div>
                  <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[conic-gradient(#6ee7b7_78%,rgba(255,255,255,0.11)_0)]">
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-950 text-sm font-bold text-emerald-200">78%</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    ["Notes", "14"],
                    ["Quizzes", "6"],
                    ["Streak", "5d"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                      <div className="text-xs text-slate-500">{label}</div>
                      <div className="mt-1 text-base font-bold text-white">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="absolute right-5 top-[168px] hidden rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-100 backdrop-blur sm:block">
                Protected workspace
              </div>

              <div className="absolute inset-x-4 bottom-4 grid gap-3 sm:inset-x-5 md:grid-cols-2">
                {studySignals.map(([title, status, copy]) => (
                  <div key={title} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/62 p-3 shadow-xl shadow-black/20 backdrop-blur-xl transition hover:border-emerald-300/35 hover:bg-slate-900/72">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 break-words text-sm font-semibold text-white">{title}</div>
                      <div className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-xs font-semibold text-emerald-100">{status}</div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-400">{copy}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="text-sm font-semibold uppercase text-emerald-300">Features</div>
            <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">A cleaner way to study from your own material.</h2>
          </div>
          <div className="max-w-sm text-sm leading-6 text-slate-400">
            Designed for repeated student workflows: upload, understand, test, revise.
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {features.map(([icon, title, copy]) => (
            <article key={title} className="group min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/15 backdrop-blur transition hover:-translate-y-1 hover:border-emerald-300/35 hover:bg-white/[0.07] hover:shadow-emerald-950/25">
              <div className="grid h-11 w-11 place-items-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-sm font-bold text-emerald-100 transition group-hover:bg-emerald-300 group-hover:text-slate-950">
                {icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-400">{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="border-y border-white/10 bg-white/[0.025]">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-6">
          <div className="max-w-2xl">
            <div className="text-sm font-semibold uppercase text-cyan-300">Workflow</div>
            <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">From upload to active revision.</h2>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-4">
            {workflow.map(([title, copy], index) => (
              <div key={title} className="min-w-0 rounded-lg border border-white/10 bg-slate-950/58 p-5 shadow-xl shadow-black/15">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-300 text-sm font-bold text-slate-950">
                  {index + 1}
                </div>
                <div className="mt-8 text-lg font-semibold text-white">{title}</div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="mx-auto max-w-7xl px-5 py-20 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <div className="text-sm font-semibold uppercase text-emerald-300">Security</div>
            <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">Built around protected student workspaces.</h2>
            <p className="mt-4 text-sm leading-7 text-slate-400">
              The landing preview is static, while the real app keeps authentication, row ownership, and AI calls behind protected routes.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {securityItems.map((item) => (
              <div key={item} className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-xl shadow-black/15 transition hover:border-emerald-300/30 hover:bg-white/[0.065]">
                <div className="h-2 w-2 rounded-full bg-emerald-300 shadow-lg shadow-emerald-300/50" />
                <div className="mt-5 font-semibold text-white">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
