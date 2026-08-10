import { useMemo, useState, useCallback } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { BookPickupScreen } from "./src/screens/BookPickupScreen";
import { TrackingScreen } from "./src/screens/TrackingScreen";
import { SubscriptionScreen } from "./src/screens/SubscriptionScreen";
import { WalletScreen } from "./src/screens/WalletScreen";
import { SupportScreen } from "./src/screens/SupportScreen";
import { OperatorHomeScreen } from "./src/screens/OperatorHomeScreen";
import { OperatorOrderScreen } from "./src/screens/OperatorOrderScreen";
import { OfflineQueue, type QueuedAction } from "./src/offline/queue";
import { MemoryQueueStorage } from "./src/offline/memory-storage";
import { api } from "./src/api/client";
import type { OperatorOrder } from "./src/api/types";

type Screen = "login" | "home" | "book" | "tracking" | "subscription" | "wallet" | "support" | "op-home" | "op-order";

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [token, setToken] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [opOrder, setOpOrder] = useState<OperatorOrder | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [offline, setOffline] = useState(false);

  // The offline queue replays operator actions by kind when connectivity returns.
  const queue = useMemo(() => {
    const runner = async (a: QueuedAction) => {
      if (!token) throw new Error("no token");
      const p = a.payload as Record<string, never>;
      switch (a.kind) {
        case "markPickedUp": await api.markPickedUp(p["orderId"], p["items"], token); break;
        case "advanceStage": await api.advanceStage(p["orderId"], p["to"], token); break;
        case "qcPass": await api.submitQc(p["orderId"], true, undefined, token); break;
        case "qcFail": await api.submitQc(p["orderId"], false, p["reason"], token); break;
        case "outForDelivery": await api.outForDelivery(p["orderId"], token); break;
        case "deliver": await api.deliver(p["orderId"], p["deliveryCount"], p["discrepancyReason"], token); break;
      }
    };
    return new OfflineQueue(new MemoryQueueStorage(), runner);
  }, [token]);

  const refreshPending = useCallback(async () => setPendingSync(await queue.pendingCount()), [queue]);

  const doSync = useCallback(async () => {
    const r = await queue.sync();
    setOffline(r.failed > 0);
    await refreshPending();
  }, [queue, refreshPending]);

  const onLoggedIn = (t: string, roles: string[]) => {
    setToken(t);
    setScreen(roles.includes("operator") ? "op-home" : "home");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {screen === "login" && <LoginScreen onLoggedIn={onLoggedIn} />}

      {screen === "home" && token && (
        <HomeScreen token={token} onBook={() => setScreen("book")}
          onSubscription={() => setScreen("subscription")} onWallet={() => setScreen("wallet")} onSupport={() => setScreen("support")} />
      )}
      {screen === "subscription" && token && <SubscriptionScreen token={token} onBack={() => setScreen("home")} />}
      {screen === "wallet" && token && <WalletScreen token={token} onBack={() => setScreen("home")} />}
      {screen === "support" && token && <SupportScreen token={token} onBack={() => setScreen("home")} />}
      {screen === "book" && token && (
        <BookPickupScreen token={token} onBack={() => setScreen("home")} onBooked={(id) => { setOrderId(id); setScreen("tracking"); }} />
      )}
      {screen === "tracking" && token && orderId && (
        <TrackingScreen token={token} orderId={orderId} onBack={() => setScreen("home")} />
      )}

      {screen === "op-home" && token && (
        <OperatorHomeScreen token={token} pendingSync={pendingSync} offline={offline} onSync={doSync}
          onOpen={(o) => { setOpOrder(o); setScreen("op-order"); }} />
      )}
      {screen === "op-order" && token && opOrder && (
        <OperatorOrderScreen token={token} order={opOrder} queue={queue}
          onBack={() => setScreen("op-home")} onChanged={refreshPending} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#F3F5F5" } });
