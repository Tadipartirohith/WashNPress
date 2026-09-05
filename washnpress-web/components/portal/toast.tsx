"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Toast { id: number; message: string; tone: "success" | "danger" }
interface ToastContextValue { push: (message: string, tone?: Toast["tone"]) => void }

const ToastContext = createContext<ToastContextValue | null>(null);

// A success/error notice that appears and clears itself, for actions that don't
// otherwise change what's on screen (e.g. "Operator moved to leave", "Slot
// cancelled") so the staff portals aren't left guessing whether a click did anything.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex flex-col items-center gap-2 sm:bottom-6" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={cn(
                "pointer-events-auto flex items-center gap-2 rounded-full glass-strong px-4 py-2.5 text-sm font-medium shadow-glass",
                t.tone === "success" ? "text-success" : "text-danger",
              )}
            >
              {t.tone === "success" ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
              <span className="text-foreground">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
