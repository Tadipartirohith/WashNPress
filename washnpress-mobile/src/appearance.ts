import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAppearance, type Appearance } from "./appearance-rules";

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

let current: Appearance = "system";
const listeners = new Set<(choice: Appearance) => void>();

export function appearanceChoice(): Appearance {
  return current;
}

// Read once at startup. Failing to read is not an error worth surfacing — a person
// with no stored preference and a person whose storage is unavailable both want the
// same thing, which is to follow their device.
export async function loadAppearance(): Promise<Appearance> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (isAppearance(raw)) current = raw;
  } catch {
    current = "system";
  }
  return current;
}

// Applied immediately and written afterwards. A toggle that waits on the disk before
// the screen changes reads as a toggle that did not work.
export function setAppearance(choice: Appearance): void {
  current = choice;
  for (const listener of listeners) listener(choice);
  void AsyncStorage.setItem(KEY, choice).catch(() => undefined);
}

export function onAppearanceChange(listener: (choice: Appearance) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export * from "./appearance-rules";
