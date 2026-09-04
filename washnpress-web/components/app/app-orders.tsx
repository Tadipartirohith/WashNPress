"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { orders, type AppOrder } from "@/lib/app-data";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AppOrders() {
  const [openId, setOpenId] = React.useState<string>(orders[0].id);
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-3">
      <h1 className="font-display text-xl font-semibold">Your orders</h1>
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? "" : o.id)} />
      ))}
    </div>
  );
}

function OrderCard({ order, open, onToggle }: { order: AppOrder; open: boolean; onToggle: () => void }) {
  const delivered = order.currentStep >= order.steps.length - 1;
  return (
    <div className="overflow-hidden rounded-2xl glass">
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{order.code}</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                delivered ? "bg-success/15 text-success" : "bg-primary/15 text-primary",
              )}
            >
              {delivered ? "Delivered" : "In progress"}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">{order.service} · {order.items}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{rupees(order.amountPaise)}</p>
          <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <ol className="relative ml-1">
            {order.steps.map((s, i) => {
              const done = i < order.currentStep;
              const current = i === order.currentStep;
              return (
                <li key={s.key} className="flex gap-3 pb-4 last:pb-0">
                  <div className="relative flex flex-col items-center">
                    <span
                      className={cn(
                        "grid size-7 place-items-center rounded-full ring-1 transition-colors",
                        done && "bg-primary text-primary-foreground ring-primary",
                        current && "bg-accent/20 text-accent ring-accent",
                        !done && !current && "bg-foreground/5 text-muted-foreground ring-border",
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                    </span>
                    {i < order.steps.length - 1 && (
                      <span className={cn("mt-1 w-px flex-1", i < order.currentStep ? "bg-primary/50" : "bg-border")} />
                    )}
                  </div>
                  <div className="pt-0.5">
                    <p className={cn("text-sm font-medium", !done && !current && "text-muted-foreground")}>
                      {s.label}
                      {current && <span className="ml-2 text-[10px] font-semibold text-accent">NOW</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.at ?? "Pending"}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
