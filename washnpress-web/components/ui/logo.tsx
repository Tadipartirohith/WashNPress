import { cn } from "@/lib/utils";

// The wordmark. A small glassy droplet mark with a spark of accent, set beside the
// name in the display face. Decorative, so the SVG is hidden from assistive tech and
// the accessible name comes from the text.
export function Logo({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative grid size-9 place-items-center rounded-xl bg-primary/15 shadow-glow ring-1 ring-primary/40">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none">
          <path
            d="M12 3.2c3.4 3.9 5.6 6.9 5.6 9.8A5.6 5.6 0 0 1 12 18.6a5.6 5.6 0 0 1-5.6-5.6c0-2.9 2.2-5.9 5.6-9.8Z"
            fill="hsl(var(--primary))"
          />
          <path
            d="M12 3.2c3.4 3.9 5.6 6.9 5.6 9.8A5.6 5.6 0 0 1 12 18.6"
            stroke="hsl(var(--accent))"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="14.5" cy="9" r="1.3" fill="hsl(var(--accent))" />
        </svg>
      </span>
      <span className={cn("font-display text-lg font-bold tracking-tight text-foreground", textClassName)}>
        Wash<span className="text-primary">N</span>Press
      </span>
    </span>
  );
}
