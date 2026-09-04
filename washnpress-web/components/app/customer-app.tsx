"use client";

import * as React from "react";
import { Home, ClipboardList, CalendarPlus, User, Signal, Wifi, BatteryFull } from "lucide-react";
import { AppHome } from "./app-home";
import { AppOrders } from "./app-orders";
import { AppBooking } from "./app-booking";
import { AppProfile } from "./app-profile";
import { cn } from "@/lib/utils";

type Tab = "home" | "orders" | "book" | "profile";

const tabs: { key: Tab; label: string; icon: typeof Home }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "orders", label: "Orders", icon: ClipboardList },
  { key: "book", label: "Book", icon: CalendarPlus },
  { key: "profile", label: "Profile", icon: User },
];

export function CustomerApp() {
  const [tab, setTab] = React.useState<Tab>("home");

  return (
    <>
      {/* Status bar. */}
      <div className="flex items-center justify-between px-6 pb-1 pt-2.5 text-xs font-medium text-foreground">
        <span className="tabular-nums">9:41</span>
        <span className="flex items-center gap-1.5">
          <Signal className="size-3.5" />
          <Wifi className="size-3.5" />
          <BatteryFull className="size-4" />
        </span>
      </div>

      {/* Scrollable screen. */}
      <div className="flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tab === "home" && <AppHome onTrack={() => setTab("orders")} onBook={() => setTab("book")} />}
        {tab === "orders" && <AppOrders />}
        {tab === "book" && <AppBooking />}
        {tab === "profile" && <AppProfile />}
      </div>

      {/* Bottom tab bar. */}
      <nav aria-label="App sections" className="border-t border-white/10 bg-background/80 px-2 pb-4 pt-2 backdrop-blur-xl">
        <ul className="flex items-center justify-around">
          {tabs.map((t) => {
            const active = tab === t.key;
            const isBook = t.key === "book";
            return (
              <li key={t.key}>
                <button
                  onClick={() => setTab(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-medium transition-colors",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 place-items-center rounded-xl transition-all",
                      isBook && "bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-glow",
                      !isBook && active && "bg-primary/15",
                    )}
                  >
                    <t.icon className="size-5" />
                  </span>
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
