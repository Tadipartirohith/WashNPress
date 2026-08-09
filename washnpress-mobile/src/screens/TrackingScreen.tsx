import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Tracking } from "../api/types";
import { theme } from "../theme";

const LABELS: Record<string, string> = {
  scheduled: "Pickup scheduled", picked_up: "Garments collected", in_wash: "In wash",
  ironing: "Ironing", qc: "Quality check", qc_hold: "Quality check in progress",
  ready_for_delivery: "Ready for delivery", out_for_delivery: "On the way", delivered: "Delivered",
};

export function TrackingScreen({ token, orderId, onBack }: { token: string; orderId: string; onBack: () => void }) {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.getTracking(orderId, token).then(setTracking).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, [orderId]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Home</Text></TouchableOpacity>
      <Text style={styles.h1}>Order {tracking?.orderCode ?? ""}</Text>
      <Text style={styles.state}>{tracking ? (LABELS[tracking.state] ?? tracking.state) : "Loading..."}</Text>
      <TouchableOpacity style={styles.refresh} onPress={load}><Text style={styles.refreshText}>Refresh</Text></TouchableOpacity>

      <Text style={styles.h2}>Timeline</Text>
      {tracking?.timeline.map((t, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.dot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{LABELS[t.state] ?? t.state}</Text>
            <Text style={styles.rowTime}>{new Date(t.at).toLocaleString()}</Text>
            {t.note ? <Text style={styles.rowNote}>{t.note}</Text> : null}
          </View>
        </View>
      ))}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  state: { fontSize: 16, color: theme.aqua, fontWeight: "700", marginTop: 6 },
  refresh: { alignSelf: "flex-start", marginTop: 12, backgroundColor: theme.ice, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  refreshText: { color: theme.deepTeal, fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "700", color: theme.slate, marginTop: 24, marginBottom: 8 },
  row: { flexDirection: "row", marginBottom: 14 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.aqua, marginTop: 4, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: "600", color: theme.deepTeal },
  rowTime: { fontSize: 12, color: theme.slate },
  rowNote: { fontSize: 12, color: theme.amber, marginTop: 2 },
  error: { color: "#B3261E", marginTop: 16 },
});
