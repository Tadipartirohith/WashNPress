import { useCallback, useEffect, useMemo, useState } from "react";
import { themed } from "./src/components/themed";
import { StyleSheet, View, Text, ActivityIndicator, useColorScheme } from "react-native";
// React Native's own SafeAreaView is deprecated and, on Android, never did
// anything: it only ever inset for the iOS notch. This one reads the real insets
// on both platforms, which is what a full-bleed app bar and a sticky footer need
// in order not to sit under the system bars.
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_800ExtraBold,
} from "@expo-google-fonts/geist";
import { GeistMono_500Medium, GeistMono_600SemiBold } from "@expo-google-fonts/geist-mono";
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { AmbientBackground } from "./src/components/ambient-background";
import { AppearanceIcons } from "./src/components/appearance-setting";
import { LoginScreen } from "./src/screens/LoginScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { ResidentPortal } from "./src/portals/ResidentPortal";
import { OperationsPortal } from "./src/portals/OperationsPortal";
import { SupervisorPortal } from "./src/portals/SupervisorPortal";
import { AdminPortal } from "./src/portals/AdminPortal";
import { OfflineQueue, type QueuedAction } from "./src/offline/queue";
import { AsyncStorageQueue } from "./src/offline/async-storage";
import { api, ApiError } from "./src/api/client";
import type { Portal } from "./src/api/types";
import { theme, space, type, border, setColorScheme } from "./src/theme";
import { glass } from "./src/components/glass";
import { clearSession, loadSession, saveSession } from "./src/session";
import {
  appearanceChoice, appearanceSettled, loadAppearance, onAppearanceChange, resolveScheme,
  type Appearance,
} from "./src/appearance";
import { APP_VARIANT, APP_NAMES, servesPortal, wrongAppMessage } from "./src/variant";
import { registerForPush, unregisterPush } from "./src/push";
import { Button } from "./src/components/ui";

// The bar at the top of a signed-in app. The staff app carries three portals, so
// it says which; the resident app has one and says the product name.
const PORTAL_TITLES: Record<Portal, string> = {
  admin: `${APP_NAMES.staff} · Admin`,
  supervisor: `${APP_NAMES.staff} · Supervisor`,
  operations: `${APP_NAMES.staff} · Operations`,
  resident: APP_NAMES.resident,
};

// Everything is inside the provider, including the states that render before a
// session exists: an insets hook below it throws if the provider is not there,
// and "the app is still loading" is exactly when that would first be reached.
// The one place that knows there are two palettes.
//
// The theme and every stylesheet resolve their colours through a module-level letter
// rather than through React state, because they are read outside components and a
// hook cannot reach them. So the switch is two steps: tell the module, then re-render
// the tree so everything reads the new value.
//
// The second step is why this lives here rather than in a wrapper. A wrapper holding
// the state re-renders itself, but `children` arrives as the same element it was
// given, so React bails out and the tree below never re-reads a style. Keying that
// wrapper on the scheme does force it — by unmounting everything, which throws the
// reader back to the first tab and loses whatever they were part-way through. From
// here `<AppRoot />` is a new element on every change: same type in the same place,
// so React updates rather than remounts, the subtree re-renders, and every piece of
// state in it survives.
export default function App() {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const [choice, setChoice] = useState<Appearance>(appearanceChoice());

  // The stored preference, then every later change to it. Reading it is
  // deliberately not blocking: the app renders in the system mode for the first
  // frame and corrects itself, which is a flash only for somebody who chose to
  // override their device, and only on a cold start.
  // On the web the value was already read synchronously at module load, so this is
  // settled before the first render and there is nothing to wait for. On a device it
  // is not, and the read lands within a frame.
  const [settled, setSettled] = useState(appearanceSettled());

  useEffect(() => {
    let live = true;
    const stopListening = onAppearanceChange(setChoice);
    void loadAppearance().then((stored) => {
      if (!live) return;
      setChoice(stored);
      setSettled(true);
    });
    return () => { live = false; stopListening(); };
  }, []);

  const scheme = resolveScheme(choice, system);
  setColorScheme(scheme);

  // Nothing is painted until the mode is known.
  //
  // The app already waits on the typeface and on the stored session before it draws
  // anything, and it drew a spinner while it waited — in whichever palette it had
  // guessed. For somebody who overrode their device that spinner was the flash: a
  // light screen for a few frames before the app corrected itself to dark.
  //
  // Rendering nothing rather than a guessed-at ground is what makes it a pause
  // instead of a wrong answer. It costs a frame or two on a device and nothing at
  // all on the web, and it is over long before the fonts arrive.
  if (!settled) return null;

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {/* The aurora ground, painted once behind the whole app so every translucent
            pane above it has depth and colour to refract. */}
        <AmbientBackground />
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <AppRoot />
      </View>
    </SafeAreaProvider>
  );
}

function AppRoot() {
  // The typeface, before anything is drawn with it.
  //
  // Every text style in the token file names a Geist file by weight, because React
  // Native will not synthesise one for a custom family. Rendering a screen before
  // those files are registered draws it in the device's own font at the wrong
  // metrics and then reflows it, which is the flash every app that gets this wrong
  // has on every cold start.
  const [fontsReady] = useFonts({
    Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_800ExtraBold,
    GeistMono_500Medium, GeistMono_600SemiBold,
    // Space Grotesk carries the display type — page titles, section headings and the
    // big metric numbers — matching the showcase; Geist stays the body face.
    SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
  });
  const [token, setToken] = useState<string | null>(null);
  const [portal, setPortal] = useState<Portal>("resident");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // The handset's push token, kept so signing out can stand this device down as
  // well as the session. On a shared handset that is the difference between the
  // next person seeing their own alerts and seeing the last person's.
  const [pushToken, setPushToken] = useState<string | null>(null);
  // Until the stored session has been checked we show nothing, so a refresh does
  // not flash the login screen before restoring the user.
  const [restoring, setRestoring] = useState(true);

  // Restore a stored session on start. The token is re-validated against the
  // backend rather than trusted, so a session that expired or an account that was
  // deactivated while the app was closed lands on the login screen as it should.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (!stored) { if (!cancelled) setRestoring(false); return; }
      try {
        const me = await api.me(stored.token);
        if (cancelled) return;
        setToken(stored.token);
        setPortal((me.portal as Portal) ?? stored.portal);
        setNeedsOnboarding(Boolean(me.needsOnboarding));
      } catch (error) {
        // Only a rejected session clears the stored token. A network failure keeps
        // it, so being briefly offline does not sign the user out.
        if ((error as ApiError).status === 401) await clearSession();
        if (!cancelled) {
          const offline = !(error instanceof ApiError) || error.status !== 401;
          if (offline) { setToken(stored.token); setPortal(stored.portal); }
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Operator actions taken with no connectivity are queued locally and replayed
  // by kind when the network returns.
  const queue = useMemo(() => {
    const runner = async (action: QueuedAction) => {
      if (!token) throw new Error("no token");
      const p = action.payload as Record<string, never>;
      switch (action.kind) {
        case "markPickedUp": await api.markPickedUp(p["orderId"], p["items"], token); break;
        case "failPickup": await api.failPickup(p["orderId"], p["reason"], token); break;
        case "startWash": await api.startWash(p["orderId"], token); break;
        case "completeWash": await api.completeWash(p["orderId"], token); break;
        case "startIroning": await api.startIroning(p["orderId"], token); break;
        case "completeIroning": await api.completeIroning(p["orderId"], token); break;
        case "advanceStage": await api.advanceStage(p["orderId"], p["to"], token); break;
        case "qcPass": await api.submitQc(p["orderId"], true, undefined, token); break;
        case "qcFail": await api.submitQc(p["orderId"], false, p["reason"], token); break;
        case "reprocessWash": await api.reprocess(p["orderId"], "in_wash", token); break;
        case "reprocessIron": await api.reprocess(p["orderId"], "ironing", token); break;
        case "outForDelivery": await api.outForDelivery(p["orderId"], token); break;
        case "claim": await api.claimOrder(p["orderId"], token); break;
        case "deliver": await api.deliver(p["orderId"], p["deliveryCount"], p["discrepancyReason"], token); break;
      }
    };
    // Persisted on the device. Queued work used to live only in memory, so anything
    // logged offline was lost when the app was closed — which is the situation the
    // queue exists for.
    return new OfflineQueue(new AsyncStorageQueue(), runner);
  }, [token]);

  const onLoggedIn = useCallback(async (nextToken: string, nextPortal: Portal, onboarding: boolean) => {
    setToken(nextToken);
    setPortal(nextPortal);
    setNeedsOnboarding(onboarding);
    await saveSession({ token: nextToken, portal: nextPortal });
  }, []);

  // Registering the handset once there is a session to register it against, and
  // again whenever that session changes. Somebody who signs out and back in on a
  // borrowed phone has to end up on their own account, not the previous one.
  useEffect(() => {
    if (!token) { setPushToken(null); return; }
    let cancelled = false;
    (async () => {
      const registered = await registerForPush(token);
      if (!cancelled) setPushToken(registered);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const logout = useCallback(async () => {
    if (token) {
      await unregisterPush(token, pushToken);
      try { await api.logout(token, pushToken); } catch { /* the session is dropped locally regardless */ }
    }
    await clearSession();
    setToken(null);
    setPushToken(null);
    setNeedsOnboarding(false);
  }, [token, pushToken]);

  // Onboarding reissues the session, so the new token has to be stored too.
  const onOnboarded = useCallback(async (nextToken: string | null) => {
    if (nextToken) {
      setToken(nextToken);
      await saveSession({ token: nextToken, portal: "resident" });
    }
    setNeedsOnboarding(false);
  }, []);

  if (!fontsReady || restoring) {
    return (
      <SafeAreaView style={[styles.safe, styles.centre]}>
        <ActivityIndicator color={theme.brand.solid} />
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <LoginScreen onLoggedIn={onLoggedIn} />
      </SafeAreaView>
    );
  }

  if (needsOnboarding) {
    return (
      <SafeAreaView style={styles.safe}>
        <OnboardingScreen token={token} onComplete={onOnboarded} />
      </SafeAreaView>
    );
  }

  // Signed in, and holding the wrong application.
  //
  // Nothing has gone wrong: the credentials are right and the account is fine. It
  // is a resident who installed the staff app, or an operator who installed the
  // resident one, and the only useful thing to do is say so and name the app they
  // want. Showing a blank screen, or the login page again, would read as a fault
  // with their account.
  if (!servesPortal(APP_VARIANT, portal)) {
    return (
      <SafeAreaView style={[styles.safe, styles.centre]}>
        <View style={styles.wrongApp}>
          <Text style={styles.wrongAppTitle}>You are in the wrong app</Text>
          <Text style={styles.wrongAppBody}>{wrongAppMessage(APP_VARIANT, portal)}</Text>
          <Button label="Sign out" variant="secondary" onPress={logout} />
        </View>
      </SafeAreaView>
    );
  }

  // The portal comes from the role on the session. The backend enforces the same
  // boundary independently, so this only decides what is worth showing.
  return (
    <SafeAreaView style={styles.safe}>
      {/* The brand bar carries the light/dark toggle on the right, so switching mode
          is one tap from anywhere in the app rather than buried in a profile tab. */}
      <View style={styles.appBar}>
        <Text style={styles.appBarText}>{PORTAL_TITLES[portal]}</Text>
        <AppearanceIcons />
      </View>
      {portal === "admin" && <AdminPortal token={token} onLogout={logout} />}
      {portal === "supervisor" && <SupervisorPortal token={token} onLogout={logout} />}
      {portal === "operations" && <OperationsPortal token={token} queue={queue} onLogout={logout} />}
      {portal === "resident" && <ResidentPortal token={token} onLogout={logout} />}
    </SafeAreaView>
  );
}

const styles = themed((theme) => ({
  // The whole tree sits on this, so a mode change repaints the ground behind every
  // screen rather than leaving a light gutter under a dark page.
  root: { flex: 1, backgroundColor: theme.surface.page },
  // Transparent so the aurora ground painted behind the app shows through every
  // screen. The opaque base stays on `root` as the pre-paint fallback.
  safe: { flex: 1, backgroundColor: "transparent" },
  centre: { alignItems: "center", justifyContent: "center" },
  // The brand bar, as smoked glass: a translucent petrol over the aurora, blurred on
  // the web, with a lit lower edge. Dark enough that the light title stays legible.
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.surface.inverse,
    paddingVertical: space.snug,
    paddingHorizontal: space.page,
    borderBottomWidth: border.hairline,
    borderBottomColor: theme.line.glass,
    ...glass(),
  },
  appBarText: { ...type.subheading, color: theme.text.onInverse },
  wrongApp: { padding: space.section, maxWidth: 420 },
  wrongAppTitle: { ...type.title, color: theme.text.primary, marginBottom: space.snug, textAlign: "center" },
  wrongAppBody: { ...type.body, color: theme.text.secondary, marginBottom: space.section, textAlign: "center" },
}));
