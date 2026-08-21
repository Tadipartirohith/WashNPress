import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

// Shared data-loading behaviour for the portals.

export interface Loader<T> {
  data: T | null;
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setData: (next: T | null) => void;
}

// Loads once and on demand. Guards against a slow response from an earlier load
// overwriting a newer one, which is what makes a refreshed screen flicker back to
// stale data.
export function useLoader<T>(load: () => Promise<T>, deps: unknown[] = []): Loader<T> {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await load();
      if (mine === generation.current && mounted.current) setData(next);
    } catch (e) {
      if (mine === generation.current && mounted.current) setError((e as Error).message);
    } finally {
      if (mine === generation.current && mounted.current) setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);

  return { data, busy, error, reload, setData };
}

// Re-runs an effect on an interval while the app is in the foreground, and once
// more the moment it comes back. An operator marking an order delivered shows up on
// the resident's tracking screen without them having to refresh the page, and a
// backgrounded app stops polling instead of burning battery.
export function usePolling(run: () => void | Promise<void>, intervalMs: number, enabled = true): void {
  const saved = useRef(run);
  saved.current = run;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => { void saved.current(); }, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") { void saved.current(); start(); }
      else stop();
    });

    return () => { stop(); subscription.remove(); };
  }, [intervalMs, enabled]);
}

// How often each screen refreshes itself. Order tracking is the one the
// specification calls out, so it polls fastest.
export const POLL = {
  tracking: 10_000,
  dashboard: 30_000,
  worklist: 20_000,
};

// Holds a value still until the user stops typing. A search field that fires a
// request per keystroke races with itself: a slow earlier response lands after a
// newer one and the list appears not to react to what was typed.
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
