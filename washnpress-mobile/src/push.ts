import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { api } from "./api/client";
import { APP_VARIANT } from "./variant";
import { theme } from "./theme";
import { canRegisterForPush, pushReasonFor } from "./push-rules";

// `expo-notifications` is loaded on demand rather than imported at the top.
//
// Expo Go dropped remote push with SDK 53, so in Expo Go the module cannot do the
// one thing this file wants from it — and merely importing it prints two warnings
// saying so, on every start, to a developer who cannot act on them from inside
// Expo Go anyway. Loading it only where it can work means the warnings appear
// only where they mean something.
type NotificationsModule = typeof import("expo-notifications");
let notificationsPromise: Promise<NotificationsModule> | null = null;
async function notifications(): Promise<NotificationsModule> {
  if (!notificationsPromise) {
    notificationsPromise = import("expo-notifications").then(async (module) => {
      // A notification that arrives while the app is open should still be seen.
      // Without this the operating system hands it to a handler that shows
      // nothing, and an operator with the app open is the person most likely to
      // need it.
      module.setNotificationHandler({
        handleNotification: async () => ({
          // A banner over whatever is on screen, and a row in the notification
          // list so it can be found again after it has gone. Kept apart since SDK
          // 53, because they are two different things: an operator who missed the
          // banner still needs the pickup in the list.
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      return module;
    });
  }
  return notificationsPromise;
}

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

// Why push is not available here, in a sentence somebody can act on — or null
// when it is available.
//
// Expo Go is the one worth naming. Since SDK 53 it cannot receive remote push on
// Android at all, so a tester running the app through Expo Go sees no
// notifications and nothing to explain it: the app looks broken when the app is
// fine and the container is the limitation. A development build fixes it, and
// this says so rather than leaving somebody to find the changelog.
export function pushUnavailableReason(): string | null {
  return pushReasonFor({
    platform: Platform.OS,
    inExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    isDevice: Device.isDevice,
    hasProjectId: Boolean(projectId()),
  });
}

export async function registerForPush(sessionToken: string): Promise<string | null> {
  try {
    // Each of these is a reason there can be no push token, and none of them is an
    // error: asking anyway is what produced a stack of warnings on every start.
    if (!canRegisterForPush({
      platform: Platform.OS,
      inExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
      isDevice: Device.isDevice,
      hasProjectId: Boolean(projectId()),
    })) return null;
    const id = projectId()!;

    const Notifications = await notifications();
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
        lightColor: theme.brand.solid,
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
  // No token means nothing was ever registered — including every case where push
  // is unavailable — so this never has to load the notifications module.
  if (!pushToken) return;
  try { await api.unregisterDevice(pushToken, sessionToken); } catch { /* the session is ending regardless */ }
}
