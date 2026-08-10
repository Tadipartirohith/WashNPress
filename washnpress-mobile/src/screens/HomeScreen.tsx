import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { Plan } from "../api/types";
import { theme } from "../theme";

export function HomeScreen({ token, onBook, onSubscription, onWallet, onSupport }: { token: string; onBook: () => void; onSubscription: () => void; onWallet: () => void; onSupport: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [wallet, setWallet] = useState<string>("...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPlans().then((r) => setPlans(r.plans)).catch((e) => setError((e as Error).message));
    api.getWallet(token).then((r) => setWallet(r.balanceFormatted)).catch(() => setWallet("N/A"));
  }, [token]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.h1}>Welcome back</Text>
      <View style={styles.walletCard}><Text style={styles.walletLabel}>Wallet balance</Text><Text style={styles.walletValue}>{wallet}</Text></View>

      <TouchableOpacity style={styles.cta} onPress={onBook}><Text style={styles.ctaText}>Schedule a pickup</Text></TouchableOpacity>

      <View style={styles.links}>
        <TouchableOpacity style={styles.link} onPress={onSubscription}><Text style={styles.linkText}>Subscription</Text></TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={onWallet}><Text style={styles.linkText}>Wallet</Text></TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={onSupport}><Text style={styles.linkText}>Support</Text></TouchableOpacity>
      </View>

      <Text style={styles.h2}>Plans</Text>
      {plans.map((p) => (
        <View key={p.id} style={styles.planCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.planTier}>{p.tier}</Text>
            <Text style={styles.planMeta}>{p.garmentCap} garments · {p.turnaroundHours}h turnaround</Text>
          </View>
          <Text style={styles.planPrice}>₹{(p.monthlyPaise / 100).toFixed(0)}<Text style={styles.perMonth}>/mo</Text></Text>
        </View>
      ))}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  h2: { fontSize: 18, fontWeight: "700", color: theme.slate, marginTop: 24, marginBottom: 8 },
  walletCard: { backgroundColor: theme.deepTeal, borderRadius: 14, padding: 18, marginTop: 16 },
  walletLabel: { color: theme.ice, fontSize: 13 },
  walletValue: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 },
  cta: { backgroundColor: theme.aqua, borderRadius: 12, padding: 18, marginTop: 16, alignItems: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  planCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#eee" },
  planTier: { fontSize: 16, fontWeight: "700", color: theme.deepTeal },
  planMeta: { fontSize: 12, color: theme.slate, marginTop: 2 },
  planPrice: { fontSize: 20, fontWeight: "800", color: theme.aqua },
  perMonth: { fontSize: 12, color: theme.slate, fontWeight: "400" },
  links: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  link: { flex: 1, backgroundColor: theme.ice, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginHorizontal: 4 },
  linkText: { color: theme.deepTeal, fontWeight: "700" },
  error: { color: "#B3261E", marginTop: 16 },
});
