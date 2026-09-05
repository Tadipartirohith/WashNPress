"use client";

import { useCallback, useEffect, useState } from "react";

// Shared by every staff portal screen: run an async fetch on mount (and whenever
// `deps` changes), and expose loading/error/reload the same way everywhere. The
// resident app (app/app/page.tsx) has its own copy predating this file — left as is
// since it works and touching it isn't part of this change.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, loading, error, reload: run, setData };
}

// For an action a user triggers (a form submit, a status change) rather than data
// that loads on mount. Tracks in-flight + error, and never auto-runs.
export function useAction<Args extends unknown[], T>(fn: (...args: Args) => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: Args) => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, setError };
}
