import { riders, riderStatusMeta } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

const dot: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  accent: "bg-accent",
  muted: "bg-muted-foreground",
};

export function RiderPanel() {
  const onShift = riders.filter((r) => r.status !== "off").length;
  return (
    <div className="rounded-2xl p-5 glass sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Rider shifts</h2>
          <p className="text-xs text-muted-foreground">{onShift} on shift now</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {riders.map((r) => {
          const meta = riderStatusMeta[r.status];
          return (
            <li key={r.name} className="flex items-center gap-3 rounded-xl bg-foreground/[0.03] p-3">
              <span className="grid size-9 place-items-center rounded-full bg-primary/15 font-display text-xs font-semibold text-primary ring-1 ring-primary/30">
                {r.name.split(" ").map((n) => n[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.zone}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-2 rounded-full", dot[meta.tint])} />
                  {meta.label}
                </span>
                <p className="text-[11px] text-muted-foreground">{r.orders} orders</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
