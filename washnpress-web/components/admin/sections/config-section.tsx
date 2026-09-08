"use client";

import * as React from "react";
import { CalendarClock, History, ChevronRight, ChevronLeft } from "lucide-react";
import { SlotsSchedulingConfig } from "./config/slots-scheduling";

type ConfigView = "hub" | "slots";

// A card row on the hub: an icon, the module name, one line about it, and a chevron.
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

// The System Configuration hub. Services, garment categories, subscription plans and
// additional charges now live under the Catalogue tab (I-60 / I-66), so this hub
// keeps only the operational scheduling rules and a deep link to the Audit log.
export function ConfigSection({ onNavigateTab }: { onNavigateTab?: (tab: string) => void }) {
  const [view, setView] = React.useState<ConfigView>("hub");

  if (view !== "hub") {
    return (
      <div className="space-y-5">
        <button onClick={() => setView("hub")} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> System Configuration
        </button>
        <div>
          <h2 className="font-display text-xl font-bold">Slots &amp; Scheduling</h2>
        </div>
        <SlotsSchedulingConfig />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold">System Configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational scheduling rules for Wash N Press. Services, garment categories, plans and charges are managed under Catalogue.
        </p>
      </div>

      <Group label="Operations">
        <ConfigCard icon={CalendarClock} title="Slots & Scheduling"
          description="Working hours, slot duration, advance booking and cancellation rules."
          onClick={() => setView("slots")} />
      </Group>

      <Group label="Data & Logs">
        <ConfigCard icon={History} title="Audit Logs"
          description="View the history of all configuration changes."
          onClick={() => onNavigateTab?.("audit")} />
      </Group>
    </div>
  );
}
