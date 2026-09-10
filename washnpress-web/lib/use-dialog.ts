import { useCallback, useEffect, useRef } from "react";

// Everything a modal owes the keyboard, in one hook.
//
// The staff portals get this from components/portal/modal.tsx, but the resident app
// builds its overlays as plain divs — the booking wizard, plan change, edit profile,
// sign out, delete account — and so had none of it: no Escape, no focus trap, and
// nothing to send focus back to when the dialog closed. A keyboard or screen-reader
// user who opened the booking wizard was left tabbing through the page underneath it
// with no way out but the mouse (WCAG 2.2 SC 2.1.2 and 2.4.3).
//
// Returns a ref to put on the dialog panel. Attach it to the element that carries
// role="dialog", not to the backdrop.
export function useDialog(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Read once on mount: by the time the dialog closes, the element that had focus is
  // long gone from document.activeElement.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  // Held in a ref so the setup effect runs exactly once. A caller that passes a fresh
  // closure each render — the booking wizard's Escape means different things before
  // and after the booking is confirmed — would otherwise re-run setup, and the
  // second run would record a control *inside* the dialog as the element to restore
  // focus to when it closes.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const focusable = useCallback((): HTMLElement[] => {
    const root = panelRef.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, []);

  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    // The page behind must not scroll away under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // The first control, or the panel itself when the dialog is pure text. Deferred
    // a frame so it wins over any autofocus the browser applies on mount.
    const focusFirst = requestAnimationFrame(() => {
      const [first] = focusable();
      (first ?? panelRef.current)?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) { e.preventDefault(); panelRef.current?.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it has escaped the panel —
      // which it has whenever the dialog opened over an already-focused control.
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(focusFirst);
      document.body.style.overflow = previousOverflow;
      returnFocusTo.current?.focus?.();
    };
  }, [focusable]);

  return panelRef;
}
