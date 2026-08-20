import { useCallback, useEffect, useMemo, useState } from "react";
import { SafeAreaView, StyleSheet, View, Text, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { OnboardingScreen } from "./src/screens/OnboardingScreen";
import { ResidentPortal } from "./src/portals/ResidentPortal";
import { OperationsPortal } from "./src/portals/OperationsPortal";
import { SupervisorPortal } from "./src/portals/SupervisorPortal";
import { AdminPortal } from "./src/portals/AdminPortal";
import { OfflineQueue, type QueuedAction } from "./src/offline/queue";
import { MemoryQueueStorage } from "./src/offline/memory-storage";
import { api, ApiError } from "./src/api/client";
import type { Portal } from "./src/api/types";
import { theme } from "./src/theme";
import { clearSession, loadSession, saveSession } from "./src/session";

const PORTAL_TITLES: Record<Portal, string> = {
  admin: "Wash N Press · Admin",
  supervisor: "Wash N Press · Supervisor",
  operations: "Wash N Press · Operations",
  resident: "Wash N Press",
};

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [portal, setPortal] = useState<Portal>("resident");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
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
    return new OfflineQueue(new MemoryQueueStorage(), runner);
  }, [token]);

  const onLoggedIn = useCallback(async (nextToken: string, nextPortal: Portal, onboarding: boolean) => {
    setToken(nextToken);
    setPortal(nextPortal);
    setNeedsOnboarding(onboarding);
    await saveSession({ token: nextToken, portal: nextPortal });
  }, []);

  const logout = useCallback(async () => {
    if (token) { try { await api.logout(token); } catch { /* the session is dropped locally regardless */ } }
    await clearSession();
    setToken(null);
    setNeedsOnboarding(false);
  }, [token]);

  // Onboarding reissues the session, so the new token has to be stored too.
  const onOnboarded = useCallback(async (nextToken: string | null) => {
    if (nextToken) {
      setToken(nextToken);
      await saveSession({ token: nextToken, portal: "resident" });
    }
    setNeedsOnboarding(false);
  }, []);

  if (restoring) {
    return (
      <SafeAreaView style={[styles.safe, styles.centre]}>
        <StatusBar style="dark" />
        <ActivityIndicator color={theme.aqua} />
      </SafeAreaView>
    );
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <LoginScreen onLoggedIn={onLoggedIn} />
      </SafeAreaView>
    );
  }

  if (needsOnboarding) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <OnboardingScreen token={token} onComplete={onOnboarded} />
      </SafeAreaView>
    );
  }

  // The portal comes from the role on the session. The backend enforces the same
  // boundary independently, so this only decides what is worth showing.
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.appBar}><Text style={styles.appBarText}>{PORTAL_TITLES[portal]}</Text></View>
      {portal === "admin" && <AdminPortal token={token} onLogout={logout} />}
      {portal === "supervisor" && <SupervisorPortal token={token} onLogout={logout} />}
      {portal === "operations" && <OperationsPortal token={token} queue={queue} onLogout={logout} />}
      {portal === "resident" && <ResidentPortal token={token} onLogout={logout} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  centre: { alignItems: "center", justifyContent: "center" },
  appBar: { backgroundColor: theme.deepTeal, paddingVertical: 12, paddingHorizontal: 16 },
  appBarText: { color: theme.white, fontSize: 15, fontWeight: "800" },
});
