"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/portal/theme-toggle";
import { authApi } from "@/lib/auth";
import { setToken, ApiError } from "@/lib/api-client";
import { isPhone, phoneProblem } from "@/lib/contact";

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
  // Seconds until the server will accept another send, as reported by the server,
  // so the button is never offered while it would be refused.
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await authApi.sendOtp(phone);
      setStage("otp");
      setResendIn(r.resendAfterSeconds ?? 30);
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
      <div className="fixed right-4 top-4 z-50"><ThemeToggle /></div>
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
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              inputMode="tel"
              maxLength={10}
              aria-invalid={Boolean(phoneProblem(phone))}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-ring"
            />
            {/* Ten characters was the whole gate, so "abcdefghij" reached the API. */}
            {phoneProblem(phone) && <p className="text-xs text-danger">{phoneProblem(phone)}</p>}
            <button onClick={send} disabled={busy || !isPhone(phone)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Send code"}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <label htmlFor="portal-otp" className="block text-xs text-muted-foreground">Enter the 6 digit code</label>
            {/* Digits only: inputMode asks a phone for a number pad, it does not stop
                a paste or a desktop keyboard. */}
            <input
              id="portal-otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-ring"
            />
            {hint && <p className="text-xs text-accent">Demo code: {hint}</p>}
            <button onClick={verify} disabled={busy || otp.length < 4} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-60">
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Verify and continue"}
            </button>
            {/* A code that never arrives is the commonest way to be stuck on this
                screen, and there was no way to ask for another one. */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button onClick={() => { setStage("phone"); setOtp(""); setHint(null); setError(null); setResendIn(0); }}
                className="text-xs text-muted-foreground hover:text-foreground">
                Use a different number
              </button>
              <button onClick={send} disabled={busy || resendIn > 0}
                className="text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      </motion.div>
    </div>
  );
}
