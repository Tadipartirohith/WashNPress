import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAppearance, DEFAULT_APPEARANCE, type Appearance } from "./appearance-rules";

// Where the appearance choice is kept, and who to tell when it changes.
//
// Separate from the session on purpose: it is a preference about this handset rather
// than about the person, so signing out must not reset it. Somebody who set the app
// dark and then handed the phone to a colleague to log in should not have it flash
// white at them.
//
// AsyncStorage is localStorage on the web and the native store on a device, which is
// the same arrangement the session uses.

const KEY = "wnp.appearance.v1";

// The web reads it before the first paint.
//
// AsyncStorage is asynchronous everywhere, but on the web it is localStorage
// underneath and writes this exact key with no prefix — which means the value can be
// had synchronously, at module load, before React renders anything. That is the
// difference between a person who chose dark seeing their app come up dark and
// seeing it come up light and correct itself.
//
// On a device there is no synchronous store, so this returns null and the async read
// below fills it in. It lands within a frame, long before the fonts the app is
// already waiting on, and `App` holds the first paint until it has.
function readSynchronously(): Appearance | null {
  try {
    const store = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage;
    const raw = store?.getItem(KEY) ?? null;
    return isAppearance(raw) ? raw : null;
  } catch {
    // A browser with site data blocked throws on access rather than returning null.
    return null;
  }
}

const synchronous = readSynchronously();

let current: Appearance = synchronous ?? DEFAULT_APPEARANCE;
// Whether the stored value is known. False only on a device, and only until the
// first read returns.
let settled = synchronous !== null;
const listeners = new Set<(choice: Appearance) => void>();

export function appearanceSettled(): boolean {
  return settled;
}

export function appearanceChoice(): Appearance {
  return current;
}

// Read once at startup. Failing to read is not an error worth surfacing — a person
// with no stored preference and a person whose storage is unavailable both want the
// same thing, which is the light default.
export async function loadAppearance(): Promise<Appearance> {
  if (settled) return current;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (isAppearance(raw)) current = raw;
  } catch {
    current = DEFAULT_APPEARANCE;
  }
  settled = true;
  return current;
}

// Applied immediately and written afterwards. A toggle that waits on the disk before
// the screen changes reads as a toggle that did not work.
export function setAppearance(choice: Appearance): void {
  current = choice;
  settled = true;
  for (const listener of listeners) listener(choice);
  void AsyncStorage.setItem(KEY, choice).catch(() => undefined);
}

export function onAppearanceChange(listener: (choice: Appearance) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export * from "./appearance-rules";
