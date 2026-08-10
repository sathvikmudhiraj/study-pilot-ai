"use client";

import type { ReactNode } from "react";
import { Button } from "../ui";

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  actionLabel = "Retry",
  icon,
}: {
  title?: string;
  description?: string;
  action?: () => void;
  actionLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-8 text-center sm:p-10 animate-fade-in">
      {icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-300">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-red-100">{title}</h3>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-red-200">{description}</p> : null}
      {action ? (
        <Button variant="danger" onClick={action} className="mt-5">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}