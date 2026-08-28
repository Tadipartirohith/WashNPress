import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { api } from "./api/client";
import { APP_VARIANT } from "./variant";

// Telling the backend where this handset is.
//
// This runs on every sign-in and every start, not once on install. A push token is
// not permanent — the operating system rotates it, and reinstalling produces a new
// one — so an app that registered once would go quietly unreachable some weeks
// later with nothing on screen to say so. Registration is idempotent on the server:
// the token is the record's identity, so the same handset overwrites its own row.
//
// Everything here fails softly. Push is a convenience on top of a notification feed
// the app already fetches; a refused permission, a simulator with no push support
// or a backend that has not been updated must never stop somebody using the app.

// A notification that arrives while the app is open should still be seen. Without
// this, the operating system hands it to a handler that shows nothing, and an
// operator with the app open is the person most likely to need it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // A banner over whatever is on screen, and a row in the notification list so it
    // can be found again after it has gone. Kept apart since SDK 53, because they
    // are two different things: an operator who missed the banner still needs the
    // pickup in the list.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function platform(): "ios" | "android" | "web" {
  return Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
}

// The Expo project this build belongs to. Getting a push token needs it, and a
// build made before `eas init` has none — which is a reason to skip push, not to
// fail.
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

export async function registerForPush(sessionToken: string): Promise<string | null> {
  try {
    // A simulator has no push service behind it, and asking produces an error
    // rather than a token.
    if (!Device.isDevice) return null;
    if (Platform.OS === "web") return null;
    const id = projectId();
    if (!id) return null;

    const existing = await Notifications.getPermissionsAsync();
    // Asked once. Somebody who has already said no is not asked again on every
    // start, which is how an app teaches people to dismiss its prompts.
    const granted = existing.granted
      ? true
      : existing.canAskAgain
        ? (await Notifications.requestPermissionsAsync()).granted
        : false;
    if (!granted) return null;

    // Android puts every notification in a channel, and one that does not exist
    // means a notification that arrives silently and invisibly.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Order updates",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#00A8A8",
      });
    }

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api.registerDevice({ token: pushToken, platform: platform(), app: APP_VARIANT }, sessionToken);
    return pushToken;
  } catch {
    // Push is the convenience, not the product.
    return null;
  }
}

// Signing out. On a shared handset — the tablet at the counter — the next person
// to sign in must not be handed the last person's notifications.
export async function unregisterPush(sessionToken: string, pushToken: string | null): Promise<void> {
  if (!pushToken) return;
  try { await api.unregisterDevice(pushToken, sessionToken); } catch { /* the session is ending regardless */ }
}
