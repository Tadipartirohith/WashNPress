import { cn } from "@/lib/utils";
import { stateLabel } from "@/lib/format";

export type StatusTone = "primary" | "accent" | "success" | "warning" | "danger" | "muted";

const toneClass: Record<StatusTone, string> = {
  primary: "bg-primary/15 text-primary ring-primary/30",
  accent: "bg-accent/15 text-accent ring-accent/30",
  success: "bg-success/15 text-success ring-success/30",
  warning: "bg-warning/15 text-warning ring-warning/30",
  danger: "bg-danger/15 text-danger ring-danger/30",
  muted: "bg-foreground/5 text-muted-foreground ring-foreground/10",
};

// Default guess when a caller doesn't supply an explicit tone map: terminal/negative
// states read as danger, in-progress as primary, anything else as muted. Screens
// that know their domain (order states, verification status, integration health)
// should pass `toneMap` instead of relying on this heuristic.
function guessTone(status: string): StatusTone {
  if (/(fail|reject|cancel|hold|block|dispute)/.test(status)) return "danger";
  if (/(deliver|approved|complete|resolved|live|active)/.test(status)) return "success";
  if (/(pending|wait|queue)/.test(status)) return "warning";
  if (/(progress|wash|iron|qc|out_for)/.test(status)) return "primary";
  return "muted";
}

export function StatusBadge({
  status,
  label,
  toneMap,
}: {
  status: string;
  label?: string;
  toneMap?: Partial<Record<string, StatusTone>>;
}) {
  const tone = toneMap?.[status] ?? guessTone(status);
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1", toneClass[tone])}>
      {label ?? stateLabel(status)}
    </span>
  );
}
