"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

const controlClass =
  "w-full rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface BaseProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
}

// One label/hint/error wrapper for every input in every staff portal form, so a
// field is never just a bare <input> with no associated label.
export function FormField({
  label,
  hint,
  error,
  required,
  className,
  as = "input",
  ...props
}: BaseProps &
  (
    | ({ as?: "input" } & React.InputHTMLAttributes<HTMLInputElement>)
    | ({ as: "textarea" } & React.TextareaHTMLAttributes<HTMLTextAreaElement>)
    | ({ as: "select"; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>)
  )) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {as === "textarea" ? (
        <textarea id={id} aria-describedby={describedBy} aria-invalid={!!error} className={cn(controlClass, "min-h-24")} {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : as === "select" ? (
        <select id={id} aria-describedby={describedBy} aria-invalid={!!error} className={controlClass} {...(props as React.SelectHTMLAttributes<HTMLSelectElement>)} />
      ) : (
        <input id={id} aria-describedby={describedBy} aria-invalid={!!error} className={controlClass} {...(props as React.InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
