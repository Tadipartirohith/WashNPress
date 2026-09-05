"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "./modal";
import { FormField } from "./form-field";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  label: string;
  placeholder?: string;
  required?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  promptText: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type PendingState =
  | { kind: "confirm"; options: ConfirmOptions }
  | { kind: "prompt"; options: PromptOptions; value: string }
  | null;

// Native window.confirm/window.prompt don't render inside the app's own DOM — they
// look out of place against this design system, and some embedded/automated
// browser contexts suppress them outright (a click that should confirm silently
// does nothing). This is the in-app replacement every destructive or reason-needing
// action should use instead.
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState>(null);
  const resolver = useRef<(value: boolean | string | null) => void>(undefined);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve as (value: boolean | string | null) => void;
      setPending({ kind: "confirm", options });
    });
  }, []);

  const promptText = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve as (value: boolean | string | null) => void;
      setPending({ kind: "prompt", options, value: "" });
    });
  }, []);

  const settle = (value: boolean | string | null) => {
    resolver.current?.(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, promptText }}>
      {children}
      <Modal
        open={pending !== null}
        onClose={() => settle(pending?.kind === "prompt" ? null : false)}
        title={pending?.options.title ?? ""}
        description={pending?.options.description}
      >
        {pending?.kind === "prompt" && (
          <FormField
            as="textarea"
            label={pending.options.label}
            placeholder={pending.options.placeholder}
            value={pending.value}
            onChange={(e) => setPending({ ...pending, value: e.target.value })}
            autoFocus
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => settle(pending?.kind === "prompt" ? null : false)}
            className="rounded-full glass px-4 py-2 text-sm font-medium hover:ring-1 hover:ring-foreground/20"
          >
            {pending?.options.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => {
              if (pending?.kind === "prompt") {
                if (pending.options.required && !pending.value.trim()) return;
                settle(pending.value.trim());
              } else {
                settle(true);
              }
            }}
            className={
              pending?.options.danger
                ? "rounded-full bg-danger px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
                : "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110"
            }
          >
            {pending?.options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
