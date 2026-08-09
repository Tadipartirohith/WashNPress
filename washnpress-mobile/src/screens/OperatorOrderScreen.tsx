import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView } from "react-native";
import { api } from "../api/client";
import type { OperatorOrder, GarmentItem } from "../api/types";
import type { OfflineQueue } from "../offline/queue";
import { theme } from "../theme";

const CATEGORIES = ["Shirts", "Trousers", "Bedsheets", "Other"];

export function OperatorOrderScreen({ token, order, queue, onBack, onChanged }: {
  token: string; order: OperatorOrder; queue: OfflineQueue; onBack: () => void; onChanged: () => void;
}) {
  const [current, setCurrent] = useState<OperatorOrder>(order);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [deliveryCount, setDeliveryCount] = useState("");
  const [discrepancy, setDiscrepancy] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Try the API immediately; if the network fails, queue the action for later sync.
  const perform = async (kind: string, run: () => Promise<{ order: OperatorOrder }>, payload: Record<string, unknown>) => {
    setBusy(true); setNote(null);
    try {
      const r = await run();
      setCurrent(r.order);
      onChanged();
      setNote("Saved");
    } catch (e) {
      const msg = (e as Error).message;
      const looksOffline = /network|failed to fetch|timeout/i.test(msg);
      if (looksOffline) { await queue.enqueue(kind, payload); setNote("Offline. Queued to sync."); }
      else { setNote(msg); }
    } finally { setBusy(false); }
  };

  const items: GarmentItem[] = CATEGORIES.filter((c) => (counts[c] ?? 0) > 0).map((c) => ({ category: c, quantity: counts[c] }));
  const bump = (c: string, d: number) => setCounts((s) => ({ ...s, [c]: Math.max(0, (s[c] ?? 0) + d) }));

  const s = current.state;
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Bookings</Text></TouchableOpacity>
      <Text style={styles.h1}>{current.orderCode}</Text>
      <Text style={styles.state}>Status: {s}</Text>
      {current.qrBatchCode ? <View style={styles.qr}><Text style={styles.qrLabel}>QR batch</Text><Text style={styles.qrCode}>{current.qrBatchCode}</Text></View> : null}

      {s === "scheduled" && (
        <View>
          <Text style={styles.h2}>Log garments</Text>
          {CATEGORIES.map((c) => (
            <View key={c} style={styles.counterRow}>
              <Text style={styles.counterLabel}>{c}</Text>
              <View style={styles.counter}>
                <TouchableOpacity style={styles.counterBtn} onPress={() => bump(c, -1)}><Text style={styles.counterBtnText}>−</Text></TouchableOpacity>
                <Text style={styles.counterValue}>{counts[c] ?? 0}</Text>
                <TouchableOpacity style={styles.counterBtn} onPress={() => bump(c, 1)}><Text style={styles.counterBtnText}>+</Text></TouchableOpacity>
              </View>
            </View>
          ))}
          <PrimaryButton label="Mark picked up" disabled={busy || items.length === 0}
            onPress={() => perform("markPickedUp", () => api.markPickedUp(current.id, items, token), { orderId: current.id, items })} />
        </View>
      )}

      {(s === "picked_up" || s === "in_wash" || s === "ironing") && (
        <PrimaryButton label={s === "picked_up" ? "Start wash" : s === "in_wash" ? "Move to ironing" : "Send to quality check"} disabled={busy}
          onPress={() => {
            const to = s === "picked_up" ? "in_wash" : s === "in_wash" ? "ironing" : "qc";
            return perform("advanceStage", () => api.advanceStage(current.id, to as "in_wash" | "ironing" | "qc", token), { orderId: current.id, to });
          }} />
      )}

      {s === "qc" && (
        <View>
          <PrimaryButton label="Quality check passed" disabled={busy}
            onPress={() => perform("qcPass", () => api.submitQc(current.id, true, undefined, token), { orderId: current.id, pass: true })} />
          <SecondaryButton label="Quality check failed" disabled={busy}
            onPress={() => perform("qcFail", () => api.submitQc(current.id, false, "Flagged at QC", token), { orderId: current.id, pass: false, reason: "Flagged at QC" })} />
        </View>
      )}

      {s === "ready_for_delivery" && (
        <PrimaryButton label="Out for delivery" disabled={busy}
          onPress={() => perform("outForDelivery", () => api.outForDelivery(current.id, token), { orderId: current.id })} />
      )}

      {s === "out_for_delivery" && (
        <View>
          <Text style={styles.h2}>Confirm delivery</Text>
          <Text style={styles.hint}>Picked up count: {current.pickupCount ?? "—"}</Text>
          <TextInput style={styles.input} placeholder="Delivered count" keyboardType="number-pad" value={deliveryCount} onChangeText={setDeliveryCount} />
          <TextInput style={styles.input} placeholder="Discrepancy reason (only if counts differ)" value={discrepancy} onChangeText={setDiscrepancy} />
          <PrimaryButton label="Mark delivered" disabled={busy || !deliveryCount}
            onPress={() => perform("deliver", () => api.deliver(current.id, Number(deliveryCount), discrepancy || undefined, token), { orderId: current.id, deliveryCount: Number(deliveryCount), discrepancyReason: discrepancy || undefined })} />
        </View>
      )}

      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <TouchableOpacity style={[styles.button, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
}
function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <TouchableOpacity style={[styles.buttonSecondary, disabled && styles.buttonDisabled]} onPress={onPress} disabled={disabled}><Text style={styles.buttonSecondaryText}>{label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  h2: { fontSize: 16, fontWeight: "700", color: theme.slate, marginTop: 22, marginBottom: 8 },
  state: { fontSize: 14, color: theme.aqua, fontWeight: "700", marginTop: 4 },
  qr: { backgroundColor: theme.deepTeal, borderRadius: 10, padding: 14, marginTop: 14 },
  qrLabel: { color: theme.ice, fontSize: 12 },
  qrCode: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: 2, marginTop: 2 },
  counterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#eee" },
  counterLabel: { fontSize: 15, color: theme.deepTeal, fontWeight: "600" },
  counter: { flexDirection: "row", alignItems: "center" },
  counterBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.ice, alignItems: "center", justifyContent: "center" },
  counterBtnText: { fontSize: 20, color: theme.deepTeal, fontWeight: "800" },
  counterValue: { width: 40, textAlign: "center", fontSize: 18, fontWeight: "700", color: theme.slate },
  input: { backgroundColor: "#fff", borderRadius: 10, padding: 14, fontSize: 16, borderWidth: 1, borderColor: "#ddd", marginTop: 10 },
  hint: { color: theme.slate, fontSize: 13, marginTop: 4 },
  button: { backgroundColor: theme.aqua, borderRadius: 12, padding: 16, marginTop: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  buttonSecondary: { borderColor: "#B3261E", borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 10, alignItems: "center" },
  buttonSecondaryText: { color: "#B3261E", fontWeight: "700", fontSize: 16 },
  note: { marginTop: 16, color: theme.slate, textAlign: "center" },
});
