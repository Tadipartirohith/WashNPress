import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Portal } from "./api/types";

// The session is persisted so a browser refresh, or closing and reopening the app,
// does not throw the user back to the login screen. AsyncStorage is backed by
// localStorage on web and by the native store on a device, so one implementation
// covers every platform the app runs on.
//
// Only the token, the portal and who the token belongs to are kept. Everything else
// about the user is re-fetched from the backend on restore, so a role or area change
// made while the app was closed takes effect immediately rather than being remembered
// wrongly.

const KEY = "wnp.session.v1";

export interface StoredSession {
  token: string;
  portal: Portal;
  // Who this session is. Not for display — the name and role come from the backend
  // on every start — but because the offline action queue is kept per person, and
  // after a restart the stored session is the only thing on the device that says
  // whose queue to open. Without it, work operator A logged with no signal drained
  // under whoever signed in next.
  //
  // Optional: a session stored before this existed has no id, and being signed out by
  // an app upgrade would be a worse answer than an anonymous queue.
  userId?: string;
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed?.token || !parsed?.portal) return null;
    return { token: parsed.token, portal: parsed.portal, userId: parsed.userId };
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
