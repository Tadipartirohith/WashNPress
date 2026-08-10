import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Plan, Subscription } from "../api/types";
import { theme } from "../theme";

export function SubscriptionScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [p, s] = await Promise.all([api.getPlans(), api.getSubscription(token)]);
    setPlans(p.plans); setSub(s.subscription);
  };
  useEffect(() => { load().catch((e) => setNote((e as Error).message)); }, [token]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote(null);
    try { await fn(); await load(); setNote(ok); }
    catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>Back</Text></TouchableOpacity>
      <Text style={styles.h1}>Subscription</Text>
      {sub ? (
        <View style={styles.card}>
          <Text style={styles.line}>Status: {sub.status}</Text>
          <Text style={styles.line}>Cycle: {sub.cycle}</Text>
          <Text style={styles.line}>Garments used: {sub.garmentsUsed}</Text>
          {sub.pendingPlanId ? <Text style={styles.pending}>Next cycle plan: {sub.pendingPlanId}</Text> : null}
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => run(() => api.pauseSubscription(new Date(Date.now() + 7 * 864e5).toISOString(), token), "Paused")}>
              <Text style={styles.secondaryText}>Pause 7 days</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} disabled={busy} onPress={() => run(() => api.cancelSubscription("User requested", token), "Cancelled")}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>No active subscription. Choose a plan below.</Text>
      )}

      <Text style={styles.h2}>Plans</Text>
      {plans.map((p) => (
        <View key={p.id} style={styles.plan}>
          <View style={{ flex: 1 }}>
            <Text style={styles.planTier}>{p.tier}</Text>
            <Text style={styles.planMeta}>{p.garmentCap} garments, {p.turnaroundHours} hours</Text>
          </View>
          <TouchableOpacity style={styles.pick} disabled={busy}
            onPress={() => run(() => sub ? api.changePlan(p.id, token) : api.subscribe(p.id, "monthly", token), sub ? "Change scheduled for next cycle" : "Subscribed")}>
            <Text style={styles.pickText}>{sub ? "Switch" : "Choose"}</Text>
          </TouchableOpacity>
        </View>
      ))}
      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  h2: { fontSize: 18, fontWeight: "700", color: theme.slate, marginTop: 22, marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginTop: 14, borderWidth: 1, borderColor: "#eee" },
  line: { fontSize: 14, color: theme.slate, marginBottom: 4 },
  pending: { fontSize: 13, color: theme.amber, marginTop: 4 },
  row: { flexDirection: "row", marginTop: 12 },
  secondary: { borderColor: theme.aqua, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginRight: 10 },
  secondaryText: { color: theme.deepTeal, fontWeight: "700" },
  hint: { color: theme.slate, marginTop: 12 },
  plan: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#eee" },
  planTier: { fontSize: 16, fontWeight: "700", color: theme.deepTeal },
  planMeta: { fontSize: 12, color: theme.slate, marginTop: 2 },
  pick: { backgroundColor: theme.aqua, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  pickText: { color: "#fff", fontWeight: "700" },
  note: { marginTop: 16, color: theme.slate, textAlign: "center" },
});
