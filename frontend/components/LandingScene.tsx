"use client";

import dynamic from "next/dynamic";

function SceneFallback() {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-70">
      <div className="absolute right-[12%] top-[22%] h-52 w-52 rounded-full border border-emerald-300/15 bg-emerald-300/10 blur-2xl" />
      <div className="absolute right-[22%] top-[38%] hidden h-32 w-48 rotate-6 rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur md:block" />
      <div className="absolute right-[8%] top-[52%] hidden h-28 w-44 -rotate-3 rounded-2xl border border-cyan-200/10 bg-cyan-200/[0.04] backdrop-blur md:block" />
    </div>
  );
}

const ClientStudyScene = dynamic(
  () => import("@/frontend/components/StudyScene").then((mod) => mod.StudyScene),
  {
    ssr: false,
    loading: () => <SceneFallback />,
  },
);

export function LandingScene() {
  return <ClientStudyScene fallback={<SceneFallback />} />;
}
