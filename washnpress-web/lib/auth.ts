"use client";

// Shared OTP auth for the three staff portals (admin/supervisor/operations). The
// resident app keeps its own inline login in app/app/page.tsx; this is the same
// backend flow, typed against the fuller /v1/auth/otp/verify response so a portal
// guard can tell "wrong role" apart from "not verified yet" apart from "not signed in".

import { useCallback, useEffect, useState } from "react";
import { req, getToken, setToken, ApiError } from "@/lib/api-client";

export type Portal = "admin" | "supervisor" | "operations" | "resident";

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string | null;
  roles: string[];
  societyIds: string[];
}

export interface VerifyOtpResult {
  token: string;
  firstLogin: boolean;
  user: AuthUser;
  portal: Portal;
  needsOnboarding: boolean;
}

export const authApi = {
  sendOtp: (phone: string) =>
    req<{ sent: boolean; otpForTesting?: string }>("/v1/auth/otp/send", { method: "POST", body: { phone }, auth: false }),
  verifyOtp: (phone: string, otp: string) =>
    req<VerifyOtpResult>("/v1/auth/otp/verify", { method: "POST", body: { phone, otp }, auth: false }),
  logout: () => req("/v1/auth/logout", { method: "POST" }).catch(() => ({})),
};

export type GuardStatus = "checking" | "signed-out" | "wrong-role" | "pending" | "rejected" | "error" | "ready";

// Signing in only proves who somebody is, not that this portal will have them —
// a supervisor/operator session can be valid and still 403 with verification_pending
// or verification_rejected (src/app/guards.ts), and any session can be the wrong
// role for this portal. `bootstrap` is a real call into the portal's own API (its
// dashboard, typically) so the guard learns the true state from the same place the
// screen would anyway, rather than guessing from the login response alone.
export function useRequireRole(bootstrap: () => Promise<unknown>) {
  const [status, setStatus] = useState<GuardStatus>("checking");
  const [message, setMessage] = useState<string | null>(null);

  const check = useCallback(() => {
    const token = getToken();
    if (!token) {
      setStatus("signed-out");
      return;
    }
    setStatus("checking");
    bootstrap()
      .then(() => setStatus("ready"))
      .catch((e: unknown) => {
        if (e instanceof ApiError) {
          if (e.status === 401) {
            setToken(null);
            setStatus("signed-out");
            return;
          }
          if (e.status === 403) {
            const data = e.data as { error?: string; message?: string } | undefined;
            if (data?.error === "verification_pending") {
              setStatus("pending");
              setMessage(data.message ?? "Your account is pending verification.");
              return;
            }
            if (data?.error === "verification_rejected") {
              setToken(null);
              setStatus("rejected");
              setMessage(data.message ?? "Your account was not approved.");
              return;
            }
            setToken(null);
            setStatus("wrong-role");
            return;
          }
        }
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Something went wrong");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { check(); }, [check]);

  return { status, message, recheck: check };
}
