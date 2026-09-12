"use client";

import { Loader2, ShieldAlert, ShieldX } from "lucide-react";
import { PortalLogin } from "./portal-login";
import { EmptyState } from "@/components/portal/empty-state";
import { useRequireRole } from "@/lib/auth";
import { setToken } from "@/lib/api-client";

// Gates a whole staff portal page. `bootstrap` should be that portal's own
// dashboard call (e.g. supervisorApi.dashboard) — the guard learns whether the
// session is signed-in, wrong-role or good from the same endpoint the screen would
// call anyway, rather than a separate "am I allowed" check that could drift from
// what the backend actually enforces.
//
// I-108: waiting to be approved is no longer a state a portal holds anybody in. A
// newly created supervisor or operator used to land on a "Pending verification"
// screen with a Check again button and no way past it, so somebody who had proved
// who they were still could not start work; that screen and its button are gone and
// a session that authenticates goes straight to its portal.
//
// Two things deliberately stay. Role still decides which portal a number may open —
// that is the "wrong-role" branch, and it is a different question from verification.
// And an explicit *rejection* is somebody saying no on purpose, which the backend
// still enforces (see requireRole in washnpress-v2/src/app/guards.ts), so it keeps
// its own screen: bouncing a rejected person silently back to the sign-in form would
// leave them typing the same number forever with nothing telling them why.
export function PortalGuard({
  title,
  loginDescription,
  demoPhone,
  bootstrap,
  children,
}: {
  title: string;
  loginDescription: string;
  demoPhone?: string;
  bootstrap: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const { status, message, recheck } = useRequireRole(bootstrap);

  if (status === "checking") {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Checking session" />
      </div>
    );
  }

  if (status === "signed-out") {
    return <PortalLogin title={title} description={loginDescription} demoPhone={demoPhone} onAuthed={recheck} />;
  }

  // "pending" is not handled at all any more — it falls through to the portal below.
  if (status === "rejected") {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-4">
        <div className="w-full max-w-sm">
          <EmptyState
            icon={ShieldX}
            tone="danger"
            title="Access not approved"
            description={message ?? "Your account was not approved for this portal."}
            action={{ label: "Back to sign in", onClick: () => { setToken(null); recheck(); } }}
          />
        </div>
      </div>
    );
  }

  if (status === "wrong-role") {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-4">
        <div className="w-full max-w-sm">
          <EmptyState
            icon={ShieldAlert}
            tone="danger"
            title="Wrong account for this portal"
            description={`That number isn't set up for ${title}. Sign in with the right one.`}
            action={{ label: "Try another number", onClick: recheck }}
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-4">
        <div className="w-full max-w-sm">
          <EmptyState tone="danger" title="Couldn't reach WashNPress" description={message ?? undefined} action={{ label: "Try again", onClick: recheck }} />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
