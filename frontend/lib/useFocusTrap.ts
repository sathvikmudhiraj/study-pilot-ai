"use client";

import { useEffect, type RefObject } from "react";

/**
 * Trap keyboard focus inside a container while `active` is true, restoring the
 * previously-focused element when the trap is released. The container must
 * have at least one tabbable element. Used by modal dialogs (e.g.
 * StudyNoteEditor) to keep Tab cycles within the dialog.
 *
 * Behavior:
 * - On activation, records `document.activeElement` for later restoration.
 * - Moves focus to the first tabbable descendant (or the container itself).
 * - Listens for Tab/Shift+Tab and cycles within the container.
 * - Listens for Escape and calls `onEscape` (does nothing by default).
 * - On deactivation, restores focus to the previously-focused element.
 *
 * The fallback-expression parser below intentionally avoids `:focus-visible`
 * and similar selectors that older engines choke on inside <select>/<input>.
 */
const TABBABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, audio[controls], video[controls], [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function queryTabbable(container: HTMLElement): HTMLElement[] {
  const found = Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR));
  return found.filter((el) => {
    const style = typeof window !== "undefined" ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === "hidden" || style.display === "none")) return false;
    return el.offsetParent !== null || el.getClientRects().length > 0;
  });
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container || typeof document === "undefined") return;

    // Re-bind to a narrowed const so closures created below retain the
    // non-null type (TS does not carry the outer narrowing into nested fns).
    const scope: HTMLElement = container;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus to the first tabbable descendant, falling back to the
    // container itself (which should carry a tabindex of -1 when used).
    const initialFocusTimer = window.setTimeout(() => {
      const tabbable = queryTabbable(scope);
      const target = tabbable[0] ?? scope;
      target.focus({ preventScroll: true });
    }, 0);

    function cleanup() {
      window.clearTimeout(initialFocusTimer);
    }

    function isInside(node: Node | null): boolean {
      return !!node && scope.contains(node);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" && event.key !== "Escape") return;
      if (event.key === "Escape") {
        if (onEscape) {
          event.preventDefault();
          onEscape();
        }
        return;
      }

      const tabbable = queryTabbable(scope);
      if (!tabbable.length) {
        event.preventDefault();
        scope.focus({ preventScroll: true });
        return;
      }

      const firstEl = tabbable[0];
      const lastEl = tabbable[tabbable.length - 1];
      const activeEl = document.activeElement;

      if (event.shiftKey) {
        if (activeEl === firstEl || !isInside(activeEl)) {
          event.preventDefault();
          lastEl.focus({ preventScroll: true });
        }
      } else if (activeEl === lastEl || !isInside(activeEl)) {
        event.preventDefault();
        firstEl.focus({ preventScroll: true });
      }
    }

    // Intercept focus attempts that originate from outside the container
    // (e.g. autofocus on a late-mounting child) and route them back inside.
    function handleFocusIn(event: FocusEvent) {
      if (!isInside(event.target as Node | null)) {
        const tabbable = queryTabbable(scope);
        const fallback = tabbable[0] ?? scope;
        event.preventDefault?.();
        fallback.focus({ preventScroll: true });
      }
    }

    scope.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      cleanup();
      scope.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [ref, active, onEscape]);
}
