import { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { SupportTicket } from "../api/types";
import { theme } from "../theme";

export function SupportScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [description, setDescription] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = async () => setTickets((await api.listTickets(token)).tickets);
  useEffect(() => { load().catch((e) => setNote((e as Error).message)); }, [token]);

  const create = async () => {
    if (!description) return;
    setNote(null);
    try { await api.createTicket("general", description, undefined, token); setDescription(""); await load(); setNote("Ticket created"); }
    catch (e) { setNote((e as Error).message); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>Back</Text></TouchableOpacity>
      <Text style={styles.h1}>Support</Text>
      <Text style={styles.label}>Describe your issue</Text>
      <TextInput style={styles.input} value={description} onChangeText={setDescription} multiline placeholder="What went wrong" />
      <TouchableOpacity style={styles.button} onPress={create}><Text style={styles.buttonText}>Raise a ticket</Text></TouchableOpacity>

      <Text style={styles.h2}>My tickets</Text>
      {tickets.map((t) => (
        <View key={t.id} style={styles.ticket}>
          <Text style={styles.ticketDesc}>{t.description}</Text>
          <Text style={styles.ticketMeta}>{t.category} | {t.status}</Text>
        </View>
      ))}
      {tickets.length === 0 && <Text style={styles.hint}>No tickets yet.</Text>}
      {note && <Text style={styles.note}>{note}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  back: { color: theme.aqua, fontSize: 16, marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "800", color: theme.deepTeal },
  h2: { fontSize: 18, fontWeight: "700", color: theme.slate, marginTop: 22, marginBottom: 8 },
  label: { fontSize: 13, color: theme.slate, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: "#fff", borderRadius: 10, padding: 14, fontSize: 16, borderWidth: 1, borderColor: "#ddd", minHeight: 80 },
  button: { backgroundColor: theme.aqua, borderRadius: 10, padding: 16, marginTop: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700" },
  ticket: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#eee" },
  ticketDesc: { color: theme.deepTeal, fontWeight: "600" },
  ticketMeta: { color: theme.slate, fontSize: 12, marginTop: 4 },
  hint: { color: theme.slate },
  note: { marginTop: 16, color: theme.slate },
});
