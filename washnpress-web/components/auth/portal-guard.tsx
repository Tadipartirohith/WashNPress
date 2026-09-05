"use client";

import { Loader2, ShieldAlert, ShieldX, Hourglass } from "lucide-react";
import { PortalLogin } from "./portal-login";
import { EmptyState } from "@/components/portal/empty-state";
import { useRequireRole } from "@/lib/auth";
import { setToken } from "@/lib/api-client";

// Gates a whole staff portal page. `bootstrap` should be that portal's own
// dashboard call (e.g. supervisorApi.dashboard) — the guard learns whether the
// session is signed-in, wrong-role, unverified or good from the same endpoint the
// screen would call anyway, rather than a separate "am I allowed" check that could
// drift from what the backend actually enforces.
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

  if (status === "pending") {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-4">
        <div className="w-full max-w-sm">
          <EmptyState
            icon={Hourglass}
            tone="muted"
            title="Pending verification"
            description={message ?? "Your account is pending verification."}
            action={{ label: "Check again", onClick: recheck }}
          />
        </div>
      </div>
    );
  }

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
