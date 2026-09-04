import { ArrowRight, Bell, MapPin, Truck, Wallet } from "lucide-react";
import { customer, quickActions, activeOrder } from "@/lib/app-data";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

// The app's front door: who you are, what you can start, and the order in flight.
export function AppHome({ onTrack, onBook }: { onTrack: () => void; onBook: () => void }) {
  const pct = Math.round((customer.planAllowanceUsed / customer.planAllowanceTotal) * 100);
  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-3">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Good morning</p>
          <p className="font-display text-xl font-semibold">Hi, {customer.name} 👋</p>
        </div>
        <button className="relative grid size-10 place-items-center rounded-full glass" aria-label="Notifications">
          <Bell className="size-4" />
          <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-accent ring-2 ring-background" />
        </button>
      </header>

      {/* Plan / wallet card. */}
      <div className="rounded-2xl p-4 glass">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Your plan</p>
            <p className="font-display text-lg font-semibold">{customer.plan}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1.5 text-sm text-primary ring-1 ring-primary/30">
            <Wallet className="size-4" /> {rupees(customer.walletPaise)}
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Allowance used</span>
            <span>{customer.planAllowanceUsed}/{customer.planAllowanceTotal} garments</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Quick actions. */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Start a service</h2>
        <div className="grid grid-cols-4 gap-2">
          {quickActions.map((a) => (
            <button
              key={a.label}
              onClick={onBook}
              className="flex flex-col items-center gap-2 rounded-2xl p-3 glass transition-transform active:scale-95"
            >
              <span
                className={cn(
                  "grid size-10 place-items-center rounded-xl ring-1",
                  a.tint === "primary"
                    ? "bg-primary/15 text-primary ring-primary/30"
                    : "bg-accent/15 text-accent ring-accent/30",
                )}
              >
                <a.icon className="size-5" />
              </span>
              <span className="text-[11px] text-foreground/90">{a.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Active order. */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Active order</h2>
        <button onClick={onTrack} className="w-full rounded-2xl p-4 text-left glass-strong transition-transform active:scale-[0.99]">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
              <Truck className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="font-medium">{activeOrder.code}</p>
                <ArrowRight className="size-4 text-muted-foreground" />
              </div>
              <p className="truncate text-xs text-muted-foreground">{activeOrder.service}</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-primary to-accent" />
          </div>
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
            <MapPin className="size-3.5" /> {activeOrder.etaLabel}
          </p>
        </button>
      </section>
    </div>
  );
}
