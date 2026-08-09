import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { api } from "../api/client";
import { theme } from "../theme";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (token: string, roles: string[]) => void }) {
  const [phone, setPhone] = useState("9876543210");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.sendOtp(phone);
      setStage("otp");
      if (r.otpForTesting) { setHint(r.otpForTesting); setOtp(r.otpForTesting); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setError(null);
    try { const r = await api.verifyOtp(phone, otp); onLoggedIn(r.token, r.user.roles); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Wash N Press</Text>
      <Text style={styles.subtitle}>Clean. Close. Conscious.</Text>
      {stage === "phone" ? (
        <>
          <Text style={styles.label}>Mobile number</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={10} />
          <TouchableOpacity style={styles.button} onPress={send} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send OTP</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Enter OTP</Text>
          <TextInput style={styles.input} value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} />
          {hint && <Text style={styles.hint}>Dev OTP: {hint}</Text>}
          <TouchableOpacity style={styles.button} onPress={verify} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify and continue</Text>}
          </TouchableOpacity>
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: theme.bg },
  brand: { fontSize: 34, fontWeight: "800", color: theme.deepTeal, textAlign: "center" },
  subtitle: { fontSize: 14, color: theme.slate, textAlign: "center", marginBottom: 32 },
  label: { fontSize: 13, color: theme.slate, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: "#fff", borderRadius: 10, padding: 14, fontSize: 18, borderWidth: 1, borderColor: "#ddd" },
  button: { backgroundColor: theme.aqua, borderRadius: 10, padding: 16, marginTop: 20, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  hint: { color: theme.amber, marginTop: 8 },
  error: { color: "#B3261E", marginTop: 16, textAlign: "center" },
});
