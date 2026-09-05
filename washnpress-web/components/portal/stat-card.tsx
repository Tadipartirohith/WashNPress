import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const tintClass: Record<string, string> = {
  primary: "bg-primary/15 text-primary ring-primary/30",
  accent: "bg-accent/15 text-accent ring-accent/30",
  success: "bg-success/15 text-success ring-success/30",
  warning: "bg-warning/15 text-warning ring-warning/30",
  danger: "bg-danger/15 text-danger ring-danger/30",
};

// A KPI tile. `deltaPercent` is optional — most admin/supervisor numbers here are
// live counts with no prior-period comparison yet, and a fabricated trend arrow
// would be worse than none.
export function StatCard({
  icon: Icon,
  label,
  value,
  deltaPercent,
  tint = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  deltaPercent?: number;
  tint?: "primary" | "accent" | "success" | "warning" | "danger";
}) {
  const up = (deltaPercent ?? 0) >= 0;
  const Trend = up ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-2xl p-5 glass">
      <div className="flex items-center justify-between">
        <span className={cn("grid size-10 place-items-center rounded-xl ring-1", tintClass[tint])}>
          <Icon className="size-5" />
        </span>
        {deltaPercent !== undefined && (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-success" : "text-danger")}>
            <Trend className="size-3.5" />
            {Math.abs(deltaPercent)}%
          </span>
        )}
      </div>
      <p className="mt-4 font-display text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
