import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Portal } from "./api/types";

// The session is persisted so a browser refresh, or closing and reopening the app,
// does not throw the user back to the login screen. AsyncStorage is backed by
// localStorage on web and by the native store on a device, so one implementation
// covers every platform the app runs on.
//
// Only the token and the portal are kept. Everything else about the user is
// re-fetched from the backend on restore, so a role or area change made while the
// app was closed takes effect immediately rather than being remembered wrongly.

const KEY = "wnp.session.v1";

export interface StoredSession {
  token: string;
  portal: Portal;
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed?.token || !parsed?.portal) return null;
    return { token: parsed.token, portal: parsed.portal };
  } catch {
    // A corrupt or unreadable entry is treated as no session rather than crashing
    // the app on start.
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Persistence is a convenience. If the store refuses, the session still works
    // for this run and the user simply signs in again next time.
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do; the in memory session is dropped by the caller anyway.
  }
}
