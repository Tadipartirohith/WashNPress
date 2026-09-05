"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// One modal for every confirm/create/edit dialog across the staff portals. `variant`
// covers both a centered dialog (forms, confirmations) and a side drawer (a longer
// detail view, e.g. an order or an issue thread) without a second component to keep
// in sync with this one.
export function Modal({
  open,
  onClose,
  title,
  description,
  variant = "center",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  variant?: "center" | "drawer";
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex" role="presentation">
          <motion.button
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={variant === "drawer" ? { x: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
            animate={variant === "drawer" ? { x: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={variant === "drawer" ? { x: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cn(
              "relative z-10 flex max-h-[100dvh] flex-col overflow-y-auto glass-strong outline-none",
              variant === "drawer"
                ? "ml-auto h-full w-full max-w-md rounded-l-3xl p-6"
                : "m-auto w-[min(92vw,32rem)] rounded-3xl p-6",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="modal-title" className="font-display text-lg font-bold">{title}</h2>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
              <button onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
