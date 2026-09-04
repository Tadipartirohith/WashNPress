"use client";

import * as React from "react";
import { Minus, Plus, Check, Clock, MapPin, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookableServices, timeSlots, addresses } from "@/lib/app-data";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AppBooking() {
  const [serviceId, setServiceId] = React.useState(bookableServices[0].id);
  const [qty, setQty] = React.useState(6);
  const [slotId, setSlotId] = React.useState(timeSlots[1].id);
  const [addressId, setAddressId] = React.useState(addresses[0].id);
  const [placed, setPlaced] = React.useState(false);

  const service = bookableServices.find((s) => s.id === serviceId)!;
  const total = qty * service.ratePaise;

  if (placed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-success/15 text-success ring-1 ring-success/30">
          <CheckCircle2 className="size-8" />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold">Booking confirmed</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A rider will collect your {service.name.toLowerCase()} in the {timeSlots.find((s) => s.id === slotId)?.label} window.
          </p>
        </div>
        <Button variant="glass" onClick={() => setPlaced(false)}>Book another</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-3">
      <h1 className="font-display text-xl font-semibold">Book a pickup</h1>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Choose a service</h2>
        <div className="grid grid-cols-2 gap-2">
          {bookableServices.map((s) => (
            <button
              key={s.id}
              onClick={() => setServiceId(s.id)}
              className={cn(
                "flex items-center gap-2 rounded-2xl p-3 text-left ring-1 transition-colors",
                serviceId === s.id ? "bg-primary/10 ring-primary/50" : "glass ring-transparent",
              )}
            >
              <span className={cn("grid size-9 place-items-center rounded-xl", serviceId === s.id ? "bg-primary/20 text-primary" : "bg-foreground/5 text-muted-foreground")}>
                <s.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{s.name}</span>
                <span className="block text-[11px] text-muted-foreground">{rupees(s.ratePaise)}/{s.unit}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Quantity <span className="text-foreground/50">({service.unit})</span>
        </h2>
        <div className="flex items-center justify-between rounded-2xl p-2 glass">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="grid size-11 place-items-center rounded-xl bg-foreground/5 active:scale-95"
            aria-label="Decrease quantity"
          >
            <Minus className="size-4" />
          </button>
          <span className="font-display text-2xl font-semibold tabular-nums">{qty}</span>
          <button
            onClick={() => setQty((q) => Math.min(99, q + 1))}
            className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground active:scale-95"
            aria-label="Increase quantity"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Clock className="size-4" /> Pickup window
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {timeSlots.map((s) => (
            <button
              key={s.id}
              onClick={() => setSlotId(s.id)}
              className={cn(
                "rounded-2xl p-3 text-left ring-1 transition-colors",
                slotId === s.id ? "bg-primary/10 ring-primary/50" : "glass ring-transparent",
              )}
            >
              <span className="block text-sm font-medium">{s.label}</span>
              {s.note && <span className="text-[11px] text-accent">{s.note}</span>}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <MapPin className="size-4" /> Pickup address
        </h2>
        <div className="flex flex-col gap-2">
          {addresses.map((a) => (
            <button
              key={a.id}
              onClick={() => setAddressId(a.id)}
              className={cn(
                "flex items-center gap-3 rounded-2xl p-3 text-left ring-1 transition-colors",
                addressId === a.id ? "bg-primary/10 ring-primary/50" : "glass ring-transparent",
              )}
            >
              <span className={cn("grid size-5 place-items-center rounded-full ring-1", addressId === a.id ? "bg-primary text-primary-foreground ring-primary" : "ring-border")}>
                {addressId === a.id && <Check className="size-3" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{a.label}</span>
                <span className="block text-xs text-muted-foreground">{a.line}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Summary. */}
      <section className="rounded-2xl p-4 glass-strong">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{qty} {service.unit} · {service.name}</span>
          <span>{rupees(total)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Pickup &amp; delivery</span>
          <span className="text-success">Free</span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-medium">Estimated total</span>
          <span className="font-display text-lg font-semibold">{rupees(total)}</span>
        </div>
        <Button className="mt-4 w-full" size="lg" onClick={() => setPlaced(true)}>
          Confirm booking
        </Button>
      </section>
    </div>
  );
}
