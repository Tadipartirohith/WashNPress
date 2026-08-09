import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { api } from "../api/client";
import type { OperatorOrder } from "../api/types";
import { theme } from "../theme";

export function OperatorHomeScreen({ token, pendingSync, offline, onSync, onOpen }: {
  token: string; pendingSync: number; offline: boolean; onSync: () => void; onOpen: (order: OperatorOrder) => void;
}) {
  const [orders, setOrders] = useState<OperatorOrder[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true); setError(null);
    try { const r = await api.getBookings(token); setOrders(r.orders); }
    catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      {offline && <View style={styles.offline}><Text style={styles.offlineText}>Offline. Actions are queued and will sync automatically.</Text></View>}
      <View style={styles.header}>
        <Text style={styles.h1}>Today's bookings</Text>
        <TouchableOpacity style={styles.syncBtn} onPress={onSync}>
          <Text style={styles.syncText}>Sync{pendingSync > 0 ? ` (${pendingSync})` : ""}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}>
        {orders.map((o) => (
          <TouchableOpacity key={o.id} style={styles.card} onPress={() => onOpen(o)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.code}>{o.orderCode}</Text>
              <Text style={styles.state}>{o.state}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        ))}
        {!refreshing && orders.length === 0 && <Text style={styles.empty}>No bookings waiting.</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  offline: { backgroundColor: theme.amber, padding: 10 },
  offlineText: { color: "#3a2a00", fontWeight: "600", textAlign: "center", fontSize: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingBottom: 4 },
  h1: { fontSize: 22, fontWeight: "800", color: theme.deepTeal },
  syncBtn: { backgroundColor: theme.aqua, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  syncText: { color: "#fff", fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#eee" },
  code: { fontSize: 16, fontWeight: "700", color: theme.deepTeal },
  state: { fontSize: 13, color: theme.slate, marginTop: 2 },
  chev: { fontSize: 24, color: theme.aqua },
  empty: { color: theme.slate, marginTop: 20, textAlign: "center" },
  error: { color: "#B3261E", marginTop: 16 },
});
