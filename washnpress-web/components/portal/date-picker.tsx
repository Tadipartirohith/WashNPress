"use client";

import * as React from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

// A calendar date picker used everywhere the admin filters or sets a date, in place
// of the browser's native `<input type="date">`. It works in plain yyyy-mm-dd strings
// so there is no timezone shift, shows the date the readable way ("08 Sep 2026"), and
// takes optional `min`/`max` so a filter can look at past days while slot creation
// cannot pick one that has already gone.
//
// I-81: the calendar is not a popover anchored to the field — it opens as a single
// WNP calendar centered in the viewport over a dimmed backdrop, closes on an outside
// click or Escape, and reads the same in every portal (resident, admin, supervisor,
// operator) and on mobile. Only the business rules (min/max) differ between callers.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function readable(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function DatePicker({
  value, onChange, min, max, placeholder = "Any date", clearable = true, disabled, className, ariaLabel,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // The month on screen: the selected date's month, or the current one.
  const initial = value ?? todayIso();
  const [view, setView] = React.useState(() => { const [y, m] = initial.split("-").map(Number); return { y, m: m - 1 }; });
  const ref = React.useRef<HTMLDivElement>(null);
  const today = todayIso();

  React.useEffect(() => {
    if (!open) return;
    const [y, m] = (value ?? today).split("-").map(Number);
    setView({ y, m: m - 1 });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the calendar is open it is a centered modal: Escape closes it, an outside
  // click on the backdrop closes it (handled on the overlay below), and the page
  // behind must not scroll away under it.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [open]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const disabledDay = (dayIso: string) => (min && dayIso < min) || (max && dayIso > max);

  const step = (delta: number) => setView((v) => {
    const m = v.m + delta;
    if (m < 0) return { y: v.y - 1, m: 11 };
    if (m > 11) return { y: v.y + 1, m: 0 };
    return { y: v.y, m };
  });

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-background/60 px-3.5 py-2.5 text-left text-sm outline-none transition-colors hover:border-primary/40 focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Calendar className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>{value ? readable(value) : placeholder}</span>
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(null); } }}
            className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel ?? "Choose a date"}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[120] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
        >
        <div onClick={(e) => e.stopPropagation()} className="w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card p-4 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"><ChevronLeft className="size-4" /></button>
            <span className="text-sm font-semibold">{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => step(1)} aria-label="Next month" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"><ChevronRight className="size-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => <span key={w} className="py-1 text-[11px] font-medium text-muted-foreground">{w}</span>)}
            {Array.from({ length: firstWeekday }).map((_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayIso = iso(view.y, view.m, day);
              const isSelected = value === dayIso;
              const isToday = today === dayIso;
              const off = disabledDay(dayIso);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!!off}
                  onClick={() => { onChange(dayIso); setOpen(false); }}
                  className={cn(
                    "grid size-8 place-items-center rounded-lg text-sm tabular-nums transition-colors",
                    off && "cursor-not-allowed text-muted-foreground/40",
                    !off && !isSelected && "hover:bg-primary/10",
                    isSelected && "bg-primary font-semibold text-primary-foreground",
                    !isSelected && isToday && "ring-1 ring-primary/50",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
            {clearable
              ? <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>
              : <span />}
            <button
              type="button"
              onClick={() => { if (!disabledDay(today)) { onChange(today); setOpen(false); } }}
              disabled={!!disabledDay(today)}
              className="text-xs font-medium text-primary disabled:opacity-40"
            >
              Today
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
