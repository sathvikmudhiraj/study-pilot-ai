"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownProps = {
  children: string;
  className?: string;
};

/**
 * Clean conversational Markdown renderer.
 * Renders headings, lists, tables, inline + block code, blockquotes.
 * No raw HTML (safe by default). Pure CSS, respects reduced-motion.
 */
function MarkdownBase({ children, className = "" }: MarkdownProps) {
  return (
    <div className={`sp-md min-w-0 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={
          /* eslint-disable @typescript-eslint/no-unused-vars */
          {
            h1: ({ node: _node, ...props }) => <h3 className="mt-4 mb-2 text-base font-semibold text-white first:mt-0" {...props} />,
            h2: ({ node: _node, ...props }) => <h3 className="mt-4 mb-2 text-base font-semibold text-white first:mt-0" {...props} />,
            h3: ({ node: _node, ...props }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold text-slate-100 first:mt-0" {...props} />,
            h4: ({ node: _node, ...props }) => <h4 className="mt-3 mb-1 text-sm font-semibold text-slate-200 first:mt-0" {...props} />,
            h5: ({ node: _node, ...props }) => <h5 className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-300 first:mt-0" {...props} />,
            h6: ({ node: _node, ...props }) => <h6 className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 first:mt-0" {...props} />,
            p: ({ node: _node, ...props }) => <p className="my-2 leading-6 first:mt-0 last:mb-0" {...props} />,
            ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
            ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
            li: ({ node: _node, ...props }) => <li className="leading-6 marker:text-slate-500" {...props} />,
            a: ({ node: _node, ...props }) => (
              <a
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200"
                {...props}
              />
            ),
            strong: ({ node: _node, ...props }) => <strong className="font-semibold text-white" {...props} />,
            em: ({ node: _node, ...props }) => <em className="text-slate-200" {...props} />,
            blockquote: ({ node: _node, ...props }) => (
              <blockquote className="my-3 border-l-2 border-emerald-400/40 bg-white/[0.03] py-1 pl-3 pr-2 text-slate-300" {...props} />
            ),
            hr: () => <hr className="my-4 border-white/10" />,
            table: ({ node: _node, ...props }) => (
              <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full border-collapse text-left text-xs" {...props} />
              </div>
            ),
            thead: ({ node: _node, ...props }) => <thead className="bg-white/[0.05]" {...props} />,
            th: ({ node: _node, ...props }) => <th className="border-b border-white/10 px-3 py-2 font-semibold text-slate-100" {...props} />,
            td: ({ node: _node, ...props }) => <td className="border-b border-white/5 px-3 py-2 align-top text-slate-300" {...props} />,
            code: ({ className: codeClassName, children, ...props }) => {
              const isBlock = /language-/.test(codeClassName ?? "") || String(children).includes("\n");
              if (isBlock) {
                return (
                  <code className={codeClassName} {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code
                  className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.85em] text-emerald-200"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre: ({ node: _node, ...props }) => (
              <pre className="my-3 overflow-x-auto rounded-lg border border-white/10 bg-slate-950/80 p-3 text-xs leading-5" {...props} />
            ),
          }
          /* eslint-enable @typescript-eslint/no-unused-vars */
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownBase);
