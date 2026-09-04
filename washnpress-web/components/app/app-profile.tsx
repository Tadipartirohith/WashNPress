import { ChevronRight, Plus, Star } from "lucide-react";
import { customer, addresses, settings } from "@/lib/app-data";
import { cn } from "@/lib/utils";

export function AppProfile() {
  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-3">
      {/* Identity. */}
      <div className="flex items-center gap-4 rounded-2xl p-4 glass-strong">
        <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-primary to-accent font-display text-lg font-bold text-primary-foreground">
          {customer.fullName.split(" ").map((n) => n[0]).join("")}
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold">{customer.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{customer.unit}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
            <Star className="size-3 fill-accent" /> {customer.plan} member
          </span>
        </div>
      </div>

      {/* Addresses. */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Saved addresses</h2>
        <div className="flex flex-col gap-2">
          {addresses.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-2xl p-3 glass">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
                <a.icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {a.label}
                  {a.primary && <span className="ml-2 text-[10px] font-semibold text-accent">DEFAULT</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{a.line}</p>
              </div>
            </div>
          ))}
          <button className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <Plus className="size-4" /> Add an address
          </button>
        </div>
      </section>

      {/* Settings. */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Settings</h2>
        <div className="overflow-hidden rounded-2xl glass">
          {settings.map((s, i) => (
            <button
              key={s.label}
              className={cn(
                "flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-foreground/5",
                i > 0 && "border-t border-border",
              )}
            >
              <span className="grid size-9 place-items-center rounded-xl bg-foreground/5 text-foreground">
                <s.icon className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">{s.label}</span>
              {s.value && <span className="text-xs text-muted-foreground">{s.value}</span>}
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
