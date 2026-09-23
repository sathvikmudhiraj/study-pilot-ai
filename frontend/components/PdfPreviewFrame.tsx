"use client";

import { useState } from "react";

type PdfPreviewFrameProps = {
  fileId: string;
  title: string;
  variant?: "original" | "generated";
};

export function PdfPreviewFrame({ fileId, title, variant = "original" }: PdfPreviewFrameProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const src = `/api/files/${encodeURIComponent(fileId)}/preview?variant=${variant}&r=${refreshKey}#toolbar=1&navpanes=0`;

  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-slate-950/80 px-4 py-2">
        <p className="text-xs text-slate-400">Preview session expires automatically for security.</p>
        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          className="h-8 shrink-0 rounded-md border border-white/10 px-3 text-xs font-semibold text-slate-200 transition hover:border-emerald-300/50 hover:text-emerald-200"
        >
          Refresh preview
        </button>
      </div>
      <iframe src={src} title={title} className="h-[70vh] min-h-[400px] w-full" />
    </div>
  );
}
