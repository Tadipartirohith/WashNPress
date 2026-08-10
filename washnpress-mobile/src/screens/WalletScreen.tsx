import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { WalletTransaction } from "../api/types";
import { theme } from "../theme";

const AMOUNTS = [20000, 50000, 100000];

export function WalletScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [balance, setBalance] = useState("...");
  const [txns, setTxns] = useState<WalletTransaction[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    const [w, t] = await Promise.all([api.getWallet(token), api.walletTransactions(token)]);
    setBalance(w.balanceFormatted); setTxns(t.transactions);
  };
  useEffect(() => { load().catch((e) => setNote((e as Error).message)); }, [token]);

  const topUp = async (amount: number) => {
    setNote(null);
    try {
      const r = await api.startTopUp(amount, token);
      setNote("Payment order created: " + r.paymentOrder.providerOrderId + ". Complete payment in the gateway. The wallet updates when the payment is confirmed.");
    } catch (e) { setNote((e as Error).message); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>Back</Text></TouchableOpacity>
      <Text style={styles.h1}>Wallet</Text>
      <View style={styles.balanceCard}><Text style={styles.balanceLabel}>Balance</Text><Text style={styles.balanceValue}>{balance}</Text></View>

      <Text style={styles.h2}>Add money</Text>
      <View style={styles.amounts}>
        {AMOUNTS.map((a) => (
          <TouchableOpacity key={a} style={styles.amount} onPress={() => topUp(a)}>
            <Text style={styles.amountText}>Rs {(a / 100).toFixed(0)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.h2}>Transactions</Text>
      {txns.map((t, i) => (
        <View key={i} style={styles.txn}>
          <Text style={styles.txnRef}>{t.reference}</Text>
          <Text style={[styles.txnAmt, { color: t.direction === "credit" ? theme.aqua : "#B3261E" }]}>
            {t.direction === "credit" ? "+" : "-"}Rs {(t.amountPaise / 100).toFixed(2)}
          </Text>
        </View>
      ))}
      {txns.length === 0 && <Text style={styles.hint}>No transactions yet.</Text>}
      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  h2: { fontSize: 18, fontWeight: "700", color: theme.slate, marginTop: 22, marginBottom: 8 },
  balanceCard: { backgroundColor: theme.deepTeal, borderRadius: 14, padding: 18, marginTop: 14 },
  balanceLabel: { color: theme.ice, fontSize: 13 },
  balanceValue: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 },
  amounts: { flexDirection: "row" },
  amount: { backgroundColor: theme.ice, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, marginRight: 10 },
  amountText: { color: theme.deepTeal, fontWeight: "700" },
  txn: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#eee" },
  txnRef: { color: theme.slate, fontSize: 13, flex: 1 },
  txnAmt: { fontWeight: "700" },
  hint: { color: theme.slate },
  note: { marginTop: 16, color: theme.slate },
});
