import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Washer } from "@/components/brand/illustrations";

const toneText: Record<string, string> = {
  muted: "text-muted-foreground",
  danger: "text-danger",
};
const toneIconBg: Record<string, string> = {
  muted: "bg-foreground/5 text-muted-foreground",
  danger: "bg-danger/10 text-danger",
};

// An empty table or a failed fetch should always say what happened and what to do
// next — never just render nothing. `action` is the one next step, not a menu.
// A plain empty list shows the still washer; an error, or a caller's own icon, keeps
// the icon so it does not read as "nothing here yet".
export function EmptyState({
  icon,
  title,
  description,
  tone = "muted",
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  tone?: "muted" | "danger";
  action?: { label: string; onClick: () => void };
}) {
  const Icon = icon ?? Inbox;
  return (
    <div className="rounded-2xl glass p-8 text-center">
      {!icon && tone === "muted" ? (
        <Washer className="mx-auto w-20" />
      ) : (
        <span className={cn("mx-auto grid size-11 place-items-center rounded-xl", toneIconBg[tone])}>
          <Icon className="size-5" />
        </span>
      )}
      <p className="mt-3 text-sm font-semibold">{title}</p>
      {description && <p className={cn("mx-auto mt-1 max-w-sm text-sm", toneText[tone])}>{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-full glass px-4 py-2 text-xs font-medium hover:ring-1 hover:ring-primary/40"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
