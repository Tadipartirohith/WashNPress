import { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { api } from "../api/client";
import type { Portal } from "../api/types";
import { font, theme } from "../theme";
import { Button, Field, ErrorText, Notice } from "../components/ui";
import { APP_VARIANT, APP_NAMES, type AppVariant } from "../variant";

// The seeded demo accounts, so the portals can be opened without setting up data
// by hand. Only the ones this application actually serves: offering the admin
// account in the resident app would be offering a sign-in that lands on "you are
// in the wrong app".
const DEMO_ACCOUNTS: Record<AppVariant, { label: string; phone: string }[]> = {
  resident: [
    { label: "Resident (Anusha)", phone: "9876543210" },
  ],
  staff: [
    { label: "Operations (Operator 01)", phone: "9876500002" },
    { label: "Supervisor (My Home Bhooja)", phone: "9876500011" },
    { label: "Admin", phone: "9876500001" },
  ],
};

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (token: string, portal: Portal, needsOnboarding: boolean) => void }) {
  // Prefilled with a demo account this application can actually open, so the first
  // tap on a development build lands somewhere rather than on "wrong app".
  const [phone, setPhone] = useState(DEMO_ACCOUNTS[APP_VARIANT][0]?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (withPhone = phone) => {
    setBusy(true); setError(null);
    try {
      const r = await api.sendOtp(withPhone);
      setPhone(withPhone);
      setStage("otp");
      if (r.otpForTesting) { setHint(r.otpForTesting); setOtp(r.otpForTesting); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.verifyOtp(phone, otp);
      onLoggedIn(r.token, r.portal, r.needsOnboarding);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
      <Text style={styles.brand}>{APP_NAMES[APP_VARIANT]}</Text>
      <Text style={styles.subtitle}>
        {APP_VARIANT === "staff" ? "Collections, processing and quality checks." : "Clean. Close. Conscious."}
      </Text>

      {stage === "phone" ? (
        <>
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Button label="Send OTP" onPress={() => send()} disabled={busy || phone.length !== 10} />
          <Text style={styles.demoHeading}>Demo accounts</Text>
          {DEMO_ACCOUNTS[APP_VARIANT].map((account) => (
            <Button key={account.phone} label={account.label} variant="secondary" onPress={() => send(account.phone)} />
          ))}
        </>
      ) : (
        <>
          <Field label="Enter OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" />
          {hint ? <Notice text={`Development OTP: ${hint}`} /> : null}
          <Button label="Verify and continue" onPress={verify} disabled={busy || otp.length < 4} />
          <Button label="Use a different number" variant="secondary" onPress={() => { setStage("phone"); setOtp(""); setHint(null); }} />
        </>
      )}
      <ErrorText error={error} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  brand: { fontSize: 34, fontFamily: font.black, color: theme.deepTeal, textAlign: "center" },
  subtitle: { fontSize: 14, color: theme.slate, textAlign: "center", marginBottom: 24 },
  demoHeading: { fontSize: 12, color: theme.muted, marginTop: 28, marginBottom: 4, textAlign: "center" },
});
