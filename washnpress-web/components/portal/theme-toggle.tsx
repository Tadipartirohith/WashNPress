"use client";

import * as React from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

// I-78: a single Light/Dark toggle used across every portal. Light is the default —
// the app opens in light mode unless the viewer has previously chosen dark, which is
// remembered in localStorage under "wnp_theme". The class is applied to <html> (the
// no-FOUC script in the root layout does the same on first paint) and the CSS token
// system in globals.css supplies both palettes.
const KEY = "wnp_theme";

export function applyTheme(theme: "light" | "dark") {
  const el = document.documentElement;
  if (theme === "dark") el.classList.add("dark");
  else el.classList.remove("dark");
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
}

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(
        "grid size-9 place-items-center rounded-full glass text-muted-foreground transition-colors hover:text-foreground hover:ring-1 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
