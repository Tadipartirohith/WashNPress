import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { api } from "../api/client";
import type { Slot } from "../api/types";
import { theme } from "../theme";

export function BookPickupScreen({ token, onBooked, onBack }: { token: string; onBooked: (orderId: string) => void; onBack: () => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    api.getSlots(today, token).then((r) => setSlots(r.slots)).catch((e) => setError((e as Error).message));
  }, [token]);

  const book = async (slotId: string) => {
    setBusy(true); setError(null);
    try { const r = await api.bookPickup(slotId, token); onBooked(r.order.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
      <Text style={styles.h1}>Choose a slot</Text>
      <Text style={styles.sub}>Available today ({today})</Text>
      {busy && <ActivityIndicator color={theme.aqua} style={{ marginTop: 20 }} />}
      {slots.map((s) => (
        <TouchableOpacity key={s.id} style={styles.slot} onPress={() => book(s.id)} disabled={busy}>
          <View><Text style={styles.slotWindow}>{s.window}</Text><Text style={styles.slotTime}>{s.startTime} – {s.endTime}</Text></View>
          <Text style={styles.slotCap}>{s.capacityRemaining} left</Text>
        </TouchableOpacity>
      ))}
      {!busy && slots.length === 0 && <Text style={styles.sub}>No slots available today.</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  sub: { fontSize: 13, color: theme.slate, marginTop: 4 },
  slot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: "#eee" },
  slotWindow: { fontSize: 16, fontWeight: "700", color: theme.deepTeal },
  slotTime: { fontSize: 13, color: theme.slate, marginTop: 2 },
  slotCap: { fontSize: 13, color: theme.aqua, fontWeight: "700" },
  error: { color: "#B3261E", marginTop: 16 },
});
