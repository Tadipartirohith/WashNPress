import { useEffect, useState } from "react";
import { themed } from "../components/themed";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { api } from "../api/client";
import type { Portal } from "../api/types";
import { font, theme } from "../theme";
import { Button, Field, ErrorText, Notice, LegalLinks } from "../components/ui";
import { APP_VARIANT, APP_NAMES, type AppVariant } from "../variant";
import { isPhone, phoneProblem } from "../contact-rules";
import { isConnectivityFailure } from "../api/request-rules";

// The seeded demo accounts, so the portals can be opened without setting up data
// by hand. Only the ones this application actually serves: offering the admin
// account in the resident app would be offering a sign-in that lands on "you are
// in the wrong app".
//
// Behind `__DEV__`, and that is not a nicety. These shipped in every build,
// rendered as tap-to-login buttons, with the platform administrator's number among
// them — so anybody who installed the staff app tapped Admin, tapped Verify, and
// was an administrator. The backend hands `otpForTesting` back in local mode, so
// the second tap needed nothing either.
//
// `__DEV__` is a build-time constant that Metro folds and the minifier eliminates,
// so in a release bundle this is the empty branch and the numbers are not in the
// binary at all — which is the difference between a hidden button and an absent
// one. The same guard covers the OTP prefill below.
const DEMO_ACCOUNTS: Record<AppVariant, { label: string; phone: string }[]> = __DEV__
  ? {
    resident: [
      { label: "Resident (Anusha)", phone: "9876543210" },
    ],
    staff: [
      { label: "Operations (Operator 01)", phone: "9876500002" },
      { label: "Supervisor (My Home Bhooja)", phone: "9876500011" },
      { label: "Admin", phone: "9876500001" },
    ],
  }
  : { resident: [], staff: [] };

export function LoginScreen({ onLoggedIn }: {
  // The user id goes up with the token: the app keeps the offline action queue per
  // person, and this is the only moment the backend says who the token belongs to.
  onLoggedIn: (token: string, portal: Portal, needsOnboarding: boolean, userId: string) => void;
}) {
  // Prefilled with a demo account this application can actually open, so the first
  // tap on a development build lands somewhere rather than on "wrong app". Empty in
  // a release build, where there are no demo accounts to prefill from.
  const [phone, setPhone] = useState(DEMO_ACCOUNTS[APP_VARIANT][0]?.phone ?? "");
  // Signing up and signing in are the same proof of a number; a number nobody has
  // seen goes on to the sign-up details either way. What differs is what a new
  // resident is told to expect, and that the demo number is not offered to them.
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What failed, so the retry link repeats the step that failed rather than
  // whichever one the screen happens to be showing now.
  const [retry, setRetry] = useState<(() => void) | null>(null);
  // Seconds until the backend will accept another send. It reports its own cooldown,
  // so the control is never offered at a moment it would be refused.
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const send = async (withPhone = phone) => {
    setBusy(true); setError(null); setRetry(null);
    try {
      const r = await api.sendOtp(withPhone);
      setPhone(withPhone);
      setStage("otp");
      setResendIn(r.resendAfterSeconds ?? 30);
      // The backend still returns this against a local instance. Showing it, and
      // filling the box with it, is a development convenience; carrying it into a
      // release build would turn any account whose number is known into a one-tap
      // sign-in.
      if (__DEV__ && r.otpForTesting) { setHint(r.otpForTesting); setOtp(r.otpForTesting); }
    } catch (e) {
      setError((e as Error).message);
      // Signing in is the step an operator cannot go around. A connectivity failure
      // here is the one the field reported, and it is almost always cured by asking
      // again a moment later.
      if (isConnectivityFailure(e)) setRetry(() => () => void send(withPhone));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError(null); setRetry(null);
    try {
      const r = await api.verifyOtp(phone, otp);
      onLoggedIn(r.token, r.portal, r.needsOnboarding, r.user.id);
    } catch (e) {
      setError((e as Error).message);
      if (isConnectivityFailure(e)) setRetry(() => () => void verify());
    } finally { setBusy(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
      <Text style={styles.brand}>{APP_NAMES[APP_VARIANT]}</Text>
      <Text style={styles.subtitle}>
        {APP_VARIANT === "staff"
          ? "Collections, processing and quality checks."
          : mode === "signup"
            ? "Create your account. Verify your number, then add your name, email, date of birth and flat."
            : "Clean. Close. Conscious."}
      </Text>

      {stage === "phone" ? (
        <>
          <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(0, 10))} keyboardType="phone-pad" />
          {/* Ten characters was the whole gate, so a number that could never receive
              an OTP cost a round trip to find out. */}
          {phoneProblem(phone) ? <Notice tone="warn" text={phoneProblem(phone)!} /> : null}
          <Button label="Send OTP" onPress={() => send()} disabled={busy || !isPhone(phone)} />
          {/* Residents sign themselves up; staff accounts are made by an admin, so the
              staff app has nothing to offer here. */}
          {APP_VARIANT === "resident" ? (
            <Button
              label={mode === "signup" ? "I already have an account" : "Create an account"}
              variant="secondary"
              onPress={() => {
                const next = mode === "signup" ? "signin" : "signup";
                setMode(next);
                setPhone(next === "signup" ? "" : DEMO_ACCOUNTS[APP_VARIANT][0]?.phone ?? "");
                setError(null);
              }}
            />
          ) : null}
          {mode === "signin" && DEMO_ACCOUNTS[APP_VARIANT].length ? (
            <>
              <Text style={styles.demoHeading}>Demo accounts</Text>
              {DEMO_ACCOUNTS[APP_VARIANT].map((account) => (
                <Button key={account.phone} label={account.label} variant="secondary" onPress={() => send(account.phone)} />
              ))}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Field label="Enter OTP" value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" />
          {hint ? <Notice text={`Development OTP: ${hint}`} /> : null}
          <Button label="Verify and continue" onPress={verify} disabled={busy || otp.length < 6} />
          {/* An SMS that never arrives is the commonest way to be stranded on this
              screen, and there was no way to ask for another code. */}
          <Button
            label={resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            variant="secondary"
            disabled={busy || resendIn > 0}
            onPress={() => send()}
          />
          <Button label="Use a different number" variant="secondary" onPress={() => { setStage("phone"); setOtp(""); setHint(null); setResendIn(0); }} />
        </>
      )}
      <ErrorText error={error} onRetry={retry ?? undefined} />
      {/* Reachable without an account, which is the only way a store reviewer
          looking for them will find them. */}
      <LegalLinks />
    </ScrollView>
  );
}

const styles = themed((theme) => ({
  container: { flex: 1, backgroundColor: theme.bg },
  brand: { fontSize: 34, fontFamily: font.black, color: theme.deepTeal, textAlign: "center" },
  subtitle: { fontSize: 14, color: theme.slate, textAlign: "center", marginBottom: 24 },
  demoHeading: { fontSize: 12, color: theme.muted, marginTop: 28, marginBottom: 4, textAlign: "center" },
}));
