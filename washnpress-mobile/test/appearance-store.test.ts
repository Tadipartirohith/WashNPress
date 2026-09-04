import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// The cold-start flash, and why the fix is a synchronous read rather than a faster
// asynchronous one.
//
// Every store the app has is asynchronous, so the first paint happened before the
// stored preference arrived: somebody who had chosen dark watched their app come up
// light and correct itself. On the web that is avoidable outright — AsyncStorage is
// localStorage underneath and writes this exact key with no prefix, so the value can
// be had at module load, before React renders at all.
//
// These import the module fresh each time, because the synchronous read happens once
// when it loads and that is precisely the behaviour under test.

// Each test re-imports the appearance module fresh (the synchronous read under test
// happens once at module load). Recompiling that module graph can take a few seconds
// when the whole suite runs in parallel, so these get a generous timeout — the work
// is a slow transform, not slow logic.
vi.setConfig({ testTimeout: 20000 });

const KEY = "wnp.appearance.v1";

function withLocalStorage(value: string | null) {
  const store = new Map<string, string>();
  if (value !== null) store.set(KEY, value);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  });
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("reading the preference before the first paint", () => {
  it("has the stored choice at module load, with nothing awaited", async () => {
    withLocalStorage("dark");
    const mod = await import("../src/appearance");
    // The assertion that matters: correct *without* calling loadAppearance first.
    expect(mod.appearanceChoice()).toBe("dark");
    expect(mod.appearanceSettled()).toBe(true);
  });

  it("opens light when nothing was ever stored", async () => {
    withLocalStorage(null);
    const mod = await import("../src/appearance");
    expect(mod.appearanceChoice()).toBe("light");
  });

  it("ignores a value that is not one of the two", async () => {
    // Storage is shared with anything else on the origin and survives upgrades — an
    // older "system" preference among them, which now falls back to the light default.
    withLocalStorage("sepia");
    const mod = await import("../src/appearance");
    expect(mod.appearanceChoice()).toBe("light");
  });

  it("is not settled where there is no synchronous store", async () => {
    // A device. The async read fills it in, and the app holds its first paint until
    // it does rather than painting a guess.
    vi.stubGlobal("localStorage", undefined);
    const mod = await import("../src/appearance");
    expect(mod.appearanceSettled()).toBe(false);
    expect(mod.appearanceChoice()).toBe("light");
  });

  it("survives a browser that throws on storage rather than returning null", async () => {
    // Site data blocked, or a sandboxed frame. Throwing here would take the app down
    // at import, before anything could catch it.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("access denied"); },
    });
    const mod = await import("../src/appearance");
    expect(mod.appearanceChoice()).toBe("light");
    expect(mod.appearanceSettled()).toBe(false);
  });
});

describe("changing it", () => {
  it("settles immediately, so a device does not re-block after a choice", async () => {
    vi.stubGlobal("localStorage", undefined);
    const mod = await import("../src/appearance");
    expect(mod.appearanceSettled()).toBe(false);
    mod.setAppearance("dark");
    expect(mod.appearanceSettled()).toBe(true);
    expect(mod.appearanceChoice()).toBe("dark");
  });

  it("tells whoever is listening", async () => {
    withLocalStorage(null);
    const mod = await import("../src/appearance");
    const seen: string[] = [];
    const stop = mod.onAppearanceChange((c) => seen.push(c));
    mod.setAppearance("dark");
    mod.setAppearance("light");
    stop();
    mod.setAppearance("dark");
    expect(seen).toEqual(["dark", "light"]);
  });
});
