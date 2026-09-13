"use client";

// Shared OTP auth for the three staff portals (admin/supervisor/operations). The
// resident app keeps its own inline login in app/app/page.tsx; this is the same
// backend flow, typed against the fuller /v1/auth/otp/verify response so a portal
// guard can tell "wrong role" apart from "not verified yet" apart from "not signed in".

import { useCallback, useEffect, useState } from "react";
import { req, getToken, setToken, setSessionExpiredHandler, ApiError, SESSION_EXPIRED_MESSAGE } from "@/lib/api-client";

export type Portal = "admin" | "supervisor" | "operations" | "resident";
export type StaffPortal = Exclude<Portal, "resident">;

// Where each portal lives, so somebody who opened a portal that is not theirs can be
// sent to the one that is.
export const PORTAL_ROUTE: Record<Portal, string> = {
  admin: "/admin", supervisor: "/supervisor", operations: "/operations", resident: "/app",
};

// The one role that opens each staff portal (ST1-I150). Admin used to open all three,
// because the backend let admin stand in for any role; it no longer does, and the
// portal says so before rendering rather than after its first request is refused.
const PORTAL_ROLE: Record<StaffPortal, string> = {
  admin: "admin", supervisor: "supervisor", operations: "operator",
};

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
    req<{ sent: boolean; otpForTesting?: string; resendAfterSeconds?: number }>("/v1/auth/otp/send", { method: "POST", body: { phone }, auth: false }),
  verifyOtp: (phone: string, otp: string) =>
    req<VerifyOtpResult>("/v1/auth/otp/verify", { method: "POST", body: { phone, otp }, auth: false }),
  me: () => req<{ roles: string[]; portal: Portal }>("/v1/auth/me"),
  logout: () => req("/v1/auth/logout", { method: "POST" }).catch(() => ({})),
};

// Signing out of a staff portal (ST1-I139).
//
// The operations portal only cleared its own token, so the session stayed alive on
// the server and anybody holding the token could go on using it. The server is told
// first, so the token stops working everywhere; whatever it answers — an error, a
// 401 because the token had already died, or nothing at all — the local session is
// cleared anyway, because a failed request is no reason to leave somebody signed in on
// a shared screen. The page is then replaced rather than reloaded, which throws away
// every tab's loaded data along with it.
export async function signOut(): Promise<void> {
  await authApi.logout();
  setToken(null);
  window.location.replace(window.location.pathname);
}

export type GuardStatus = "checking" | "signed-out" | "wrong-role" | "pending" | "rejected" | "error" | "ready";

// Signing in only proves who somebody is, not that this portal will have them.
//
// The role is read from /v1/auth/me first, so an account is turned away from a portal
// that is not its own before anything in it renders, whatever URL was typed. Then
// `bootstrap`, a real call into the portal's own API (its dashboard, typically),
// confirms the backend agrees: a supervisor/operator session can be the right role
// and still 403 with verification_rejected (src/app/guards.ts).
export function useRequireRole(portal: StaffPortal, bootstrap: () => Promise<unknown>) {
  const [status, setStatus] = useState<GuardStatus>("checking");
  const [message, setMessage] = useState<string | null>(null);
  // Where this account belongs, when it opened a portal that is not its own.
  const [home, setHome] = useState<string | null>(null);
  // Why the sign-in form is showing, when it is because a session ended rather than
  // because nobody had signed in yet.
  const [notice, setNotice] = useState<string | null>(null);

  const check = useCallback(() => {
    const token = getToken();
    if (!token) {
      setStatus("signed-out");
      return;
    }
    setStatus("checking");
    setNotice(null);
    authApi.me()
      .then((me) => {
        if (!me.roles.includes(PORTAL_ROLE[portal])) {
          // Still signed in, just not here: the token is kept, because it is good
          // for the portal this person does belong to.
          setHome(PORTAL_ROUTE[me.portal] ?? null);
          setStatus("wrong-role");
          return;
        }
        return bootstrap().then(() => setStatus("ready"));
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError) {
          if (e.status === 401) {
            setToken(null);
            setNotice(SESSION_EXPIRED_MESSAGE);
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
            setHome(null);
            setStatus("wrong-role");
            return;
          }
        }
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Something went wrong");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // A 401 on any request in the portal, or the token being cleared in another tab,
    // lands here (ST1-I136, ST1-I141): the portal unmounts, taking its loaded data
    // with it, and the sign-in form says why it is back.
    setSessionExpiredHandler(() => {
      setNotice(SESSION_EXPIRED_MESSAGE);
      setStatus("signed-out");
    });
    // Back after signing out can restore this page from the browser's memory exactly
    // as it was, portal and all, without running any of it again. `pageshow` fires on
    // that restore, and a tab brought back into view is checked the same way.
    const recheckToken = () => { if (!getToken()) setStatus("signed-out"); };
    const onVisibility = () => { if (document.visibilityState === "visible") recheckToken(); };
    window.addEventListener("pageshow", recheckToken);
    document.addEventListener("visibilitychange", onVisibility);
    check();
    return () => {
      setSessionExpiredHandler(null);
      window.removeEventListener("pageshow", recheckToken);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  return { status, message, notice, home, recheck: check };
}
