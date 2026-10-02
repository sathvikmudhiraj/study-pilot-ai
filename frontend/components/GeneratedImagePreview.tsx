"use client";

import { IconArrowDown, IconRefresh } from "./icons";
import type { GeneratedImageResult } from "@/frontend/lib/generatedImage";

export function GeneratedImagePreview({
  image,
  onRegenerate,
  regenerating = false,
}: {
  image: GeneratedImageResult;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-emerald-300/15 bg-[#070e19]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-emerald-300">Generated image</p>
          <h3 className="mt-1 break-words text-base font-bold text-white">{image.title}</h3>
        </div>
        <div className="flex gap-2">
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              title="Regenerate image"
              className="grid h-9 w-9 place-items-center rounded-md border border-white/12 text-slate-200 transition hover:bg-white/[0.06] disabled:opacity-40"
            >
              <IconRefresh size={16} />
            </button>
          ) : null}
          <a
            href={image.url}
            download
            title="Download image"
            className="grid h-9 w-9 place-items-center rounded-md border border-white/12 text-slate-200 transition hover:bg-white/[0.06]"
          >
            <IconArrowDown size={16} />
          </a>
        </div>
      </div>
      <div className="grid min-h-64 place-items-center bg-black/20 p-3">
        {/* Authenticated same-origin content route; dimensions keep layout stable. */}
        <img
          src={image.url}
          alt={image.prompt}
          width={image.width}
          height={image.height}
          className="max-h-[38rem] w-auto max-w-full rounded-md object-contain"
        />
      </div>
      <div className="border-t border-white/8 px-4 py-3">
        <p className="text-sm leading-6 text-slate-300">{image.explanation}</p>
        <p className="mt-2 break-words text-xs leading-5 text-slate-500">Prompt: {image.prompt}</p>
      </div>
    </section>
  );
}
