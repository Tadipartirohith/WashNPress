"use client";

import * as React from "react";
import { CalendarClock, Shirt, Layers, Tag, History, ChevronRight, ChevronLeft } from "lucide-react";
import { SlotsSchedulingConfig } from "./config/slots-scheduling";
import { GarmentServicesConfig } from "./config/garment-services";
import { SubscriptionPlansConfig } from "./config/subscription-plans";
import { AdditionalChargesConfig } from "./config/additional-charges";

type ConfigView = "hub" | "slots" | "garments" | "plans" | "charges";

// A card row on the hub: an icon, the module name, one line about it, and a chevron.
// The whole row is the tap target, so it works the same on a phone and a desktop.
function ConfigCard({ icon: Icon, title, description, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-2xl glass p-4 text-left transition-colors hover:ring-1 hover:ring-primary/30"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

// The System Configuration hub. A pure navigation surface — no forms, no duplicated
// settings — that routes to a dedicated page per module. "Audit Logs" deep-links to
// the existing top-level Audit section rather than a second copy inside Config.
export function ConfigSection({ onNavigateTab }: { onNavigateTab?: (tab: string) => void }) {
  const [view, setView] = React.useState<ConfigView>("hub");

  if (view !== "hub") {
    const titles: Record<Exclude<ConfigView, "hub">, string> = {
      slots: "Slots & Scheduling",
      garments: "Garment Services & Pricing",
      plans: "Subscription Plans",
      charges: "Additional Charges",
    };
    return (
      <div className="space-y-5">
        <button onClick={() => setView("hub")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> System Configuration
        </button>
        <div>
          <h2 className="font-display text-xl font-bold">{titles[view]}</h2>
        </div>
        {view === "slots" && <SlotsSchedulingConfig />}
        {view === "garments" && <GarmentServicesConfig />}
        {view === "plans" && <SubscriptionPlansConfig />}
        {view === "charges" && <AdditionalChargesConfig />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold">System Configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage operational settings, services, pricing and configuration history for Wash N Press.
        </p>
      </div>

      <Group label="Operations">
        <ConfigCard icon={CalendarClock} title="Slots & Scheduling"
          description="Manage pickup and delivery slots, capacity and scheduling rules."
          onClick={() => setView("slots")} />
      </Group>

      <Group label="Services & Pricing">
        <ConfigCard icon={Shirt} title="Garment Services & Pricing"
          description="Manage laundry services, garment categories and pricing."
          onClick={() => setView("garments")} />
        <ConfigCard icon={Layers} title="Subscription Plans"
          description="Create and manage subscription plans using configured services."
          onClick={() => setView("plans")} />
        <ConfigCard icon={Tag} title="Additional Charges"
          description="Manage extra charges applicable to bookings."
          onClick={() => setView("charges")} />
      </Group>

      <Group label="Data & Logs">
        <ConfigCard icon={History} title="Audit Logs"
          description="View the history of all configuration changes."
          onClick={() => onNavigateTab?.("audit")} />
      </Group>
    </div>
  );
}
