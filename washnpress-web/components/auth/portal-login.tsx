"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { authApi } from "@/lib/auth";
import { setToken, ApiError } from "@/lib/api-client";

const fade = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

// The same OTP flow as the resident app's login (app/app/page.tsx), full-screen and
// parameterized by portal so the admin/supervisor/operations sign-in pages don't
// each reimplement it. Verifying the OTP proves who somebody is, not that this
// portal will accept them — the caller's PortalGuard checks that next.
export function PortalLogin({
  title,
  description,
  demoPhone,
  onAuthed,
}: {
  title: string;
  description: string;
  demoPhone?: string;
  onAuthed: () => void;
}) {
  const [phone, setPhone] = useState(demoPhone ?? "");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await authApi.sendOtp(phone);
      setStage("otp");
      if (r.otpForTesting) { setHint(r.otpForTesting); setOtp(r.otpForTesting); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code");
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError(null);
    try {
      const r = await authApi.verifyOtp(phone, otp);
      setToken(r.token);
      onAuthed();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "That code did not work" : e instanceof Error ? e.message : "Sign in failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4">
      <motion.div initial={fade.initial} animate={fade.animate} className="w-full max-w-sm rounded-3xl glass-strong p-7">
        <Logo />
        <h1 className="mt-5 font-display text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {stage === "phone" ? (
          <div className="mt-6 space-y-3">
            <label htmlFor="portal-phone" className="block text-xs text-muted-foreground">Mobile number</label>
            <input
              id="portal-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              maxLength={10}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-ring"
            />
            <button onClick={send} disabled={busy || phone.length < 10} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <label htmlFor="portal-otp" className="block text-xs text-muted-foreground">Enter the 6 digit code</label>
            <input
              id="portal-otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-ring"
            />
            {hint && <p className="text-xs text-accent">Demo code: {hint}</p>}
            <button onClick={verify} disabled={busy || otp.length < 4} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify and continue"}
            </button>
            <button onClick={() => { setStage("phone"); setOtp(""); setError(null); }} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
              Use a different number
            </button>
          </div>
        )}
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </motion.div>
    </div>
  );
}
