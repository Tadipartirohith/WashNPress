import type { DeviceToken } from "../domain/models";
import type { DataStore } from "../ports/repositories";

// The handsets a notification can actually reach.
//
// Push was fanned out to a *user id*, which is not something any push service can
// address: the outbox handed "user-res" to Firebase and Firebase had nowhere to
// send it. A person has devices; a device has a token; this is the register of
// them.
//
// The token is the record's id, which makes three awkward cases fall out for free:
// an app that registers on every start overwrites its own row rather than growing
// a new one each time, a handset passed to the operator covering the shift simply
// changes hands, and a token that comes back from the push service as dead can be
// stood down by the one thing the push service actually told us — the token.

export type DevicePlatform = DeviceToken["platform"];
export type DeviceApp = DeviceToken["app"];

export class DeviceService {
  constructor(private readonly store: DataStore) {}

  // Registering is idempotent by design. The app calls this on every sign-in and
  // every start, because a push token is not permanent: the operating system
  // rotates it, and an app that only registered once would quietly stop being
  // reachable some weeks later with nothing to show for it.
  async register(input: {
    userId: string;
    token: string;
    platform: DevicePlatform;
    app: DeviceApp;
  }): Promise<DeviceToken> {
    const now = new Date().toISOString();
    const existing = await this.store.deviceTokens.get(input.token);
    return this.store.deviceTokens.put({
      id: input.token,
      userId: input.userId,
      platform: input.platform,
      app: input.app,
      active: true,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      revokedAt: null,
      revokedReason: null,
    });
  }

  // Signing out. The account stays; this handset stops being one of the places it
  // is reachable, which matters most on a shared device — the next person to sign
  // in should not be handed the last person's notifications.
  async revoke(token: string, reason = "signed out"): Promise<DeviceToken | null> {
    const found = await this.store.deviceTokens.get(token);
    if (!found || !found.active) return found;
    return this.store.deviceTokens.put({
      ...found, active: false, revokedAt: new Date().toISOString(), revokedReason: reason,
    });
  }

  // Every handset one person is currently reachable on. More than one is ordinary:
  // a phone and a tablet, or a personal phone and the one kept at the counter.
  async forUser(userId: string): Promise<DeviceToken[]> {
    return this.store.deviceTokens.find((d) => d.userId === userId && d.active);
  }

  async listForUser(userId: string): Promise<DeviceToken[]> {
    const all = await this.store.deviceTokens.find((d) => d.userId === userId);
    return all.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}

// A push service refusing a token because the token itself is finished — the app
// was uninstalled, or the token was rotated and this is the old one. That is not a
// delivery failure to retry, it is a device to stop writing to.
const DEAD_TOKEN = /notregistered|invalidregistration|unregistered|invalid_?token|deviceNotRegistered/i;

export function tokenIsDead(error: unknown): boolean {
  return DEAD_TOKEN.test(error instanceof Error ? error.message : String(error));
}
