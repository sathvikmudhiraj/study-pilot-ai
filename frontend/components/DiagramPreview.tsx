"use client";

import { useEffect, useId, useRef, useState } from "react";
import { validateMermaidSource, type DiagramResult } from "@/frontend/lib/diagram";
import { IconCheck, IconCopy, IconImage, IconRefresh } from "./icons";

type DiagramPreviewProps = {
  diagram: DiagramResult;
  onRegenerate?: () => void;
  regenerating?: boolean;
};

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeFileName(title: string, extension: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "studypilot-diagram";
  return `${base}.${extension}`;
}

export function DiagramPreview({ diagram, onRegenerate, regenerating = false }: DiagramPreviewProps) {
  const renderId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const currentUrlRef = useRef("");
  const [imageUrl, setImageUrl] = useState("");
  const [svgSource, setSvgSource] = useState("");
  const [renderError, setRenderError] = useState("");
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      const validationError = validateMermaidSource(diagram.mermaid);
      if (validationError) {
        if (!cancelled) setRenderError(validationError);
        return;
      }

      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          flowchart: { htmlLabels: false, useMaxWidth: true },
          sequence: { useMaxWidth: true },
          suppressErrorRendering: true,
        });
        const rendered = await mermaid.render(`studypilot-${renderId}`, diagram.mermaid);
        if (cancelled) return;

        const blob = new Blob([rendered.svg], { type: "image/svg+xml;charset=utf-8" });
        const nextUrl = URL.createObjectURL(blob);
        if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = nextUrl;
        setSvgSource(rendered.svg);
        setImageUrl(nextUrl);
        setRenderError("");
      } catch (error) {
        if (!cancelled) {
          setRenderError(error instanceof Error ? "This diagram could not be rendered safely." : "Diagram preview is unavailable.");
        }
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [diagram.mermaid, renderId]);

  useEffect(() => {
    return () => {
      if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current);
    };
  }, []);

  async function copyMermaid() {
    setExportError("");
    try {
      await navigator.clipboard.writeText(diagram.mermaid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setExportError("Could not copy the Mermaid source in this browser.");
    }
  }

  function downloadSvg() {
    setExportError("");
    if (!svgSource) {
      setExportError("Render the diagram before downloading SVG.");
      return;
    }
    downloadBlob(
      new Blob([svgSource], { type: "image/svg+xml;charset=utf-8" }),
      safeFileName(diagram.title, "svg"),
    );
  }

  async function downloadPng() {
    setExportError("");
    if (!imageUrl) {
      setExportError("Render the diagram before downloading PNG.");
      return;
    }

    try {
      const image = new Image();
      image.decoding = "async";
      image.src = imageUrl;
      await image.decode();

      const maxDimension = 2_400;
      const width = Math.max(1, image.naturalWidth || 1_200);
      const height = Math.max(1, image.naturalHeight || 800);
      const scale = Math.min(2, maxDimension / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.fillStyle = "#07111f";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG export failed.");
      downloadBlob(blob, safeFileName(diagram.title, "png"));
    } catch {
      setExportError("PNG export is not supported for this diagram in your browser. SVG download is still available.");
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-pink-300/20 bg-[#07101d]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase text-pink-200">{diagram.diagram_type.replaceAll("_", " ")}</p>
          <h3 className="mt-1 break-words text-base font-bold text-white">{diagram.title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRegenerate ? (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-200 transition hover:border-pink-300/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <IconRefresh size={14} className={regenerating ? "animate-spin" : ""} />
              Regenerate
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copyMermaid()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-200 transition hover:border-pink-300/35 hover:text-white"
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? "Copied" : "Copy Mermaid"}
          </button>
          <button
            type="button"
            onClick={downloadSvg}
            className="h-9 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-200 transition hover:border-pink-300/35 hover:text-white"
          >
            SVG
          </button>
          <button
            type="button"
            onClick={() => void downloadPng()}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-200 transition hover:border-pink-300/35 hover:text-white"
          >
            <IconImage size={14} />
            PNG
          </button>
        </div>
      </div>

      {imageUrl && !renderError ? (
        <div className="flex min-h-64 items-center justify-center overflow-auto bg-[#07111f] p-4 sm:p-6">
          {/* Blob-backed image keeps generated SVG markup outside the document DOM. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={`${diagram.title} diagram`} className="max-h-[36rem] max-w-full object-contain" />
        </div>
      ) : renderError ? (
        <div className="space-y-3 p-4">
          <p className="rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
            {renderError} Mermaid source is available below.
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/25 p-3 text-xs leading-5 text-slate-300">
            {diagram.mermaid}
          </pre>
        </div>
      ) : (
        <div className="flex min-h-64 items-center justify-center p-6 text-sm text-slate-400">Rendering diagram...</div>
      )}

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-sm leading-6 text-slate-300">{diagram.explanation}</p>
        {exportError ? <p className="mt-2 text-xs text-amber-200">{exportError}</p> : null}
      </div>
    </section>
  );
}
