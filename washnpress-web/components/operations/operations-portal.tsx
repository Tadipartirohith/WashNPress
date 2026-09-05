"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LayoutDashboard, PackagePlus, Layers3, Users2, History as HistoryIcon,
  Sparkles, MessageCircleWarning, UserCircle2,
} from "lucide-react";
import { PortalGuard } from "@/components/auth/portal-guard";
import { PortalShell, type NavItem } from "@/components/portal/portal-shell";
import { ToastProvider } from "@/components/portal/toast";
import { useAsync } from "@/lib/use-async";
import { operationsApi } from "@/lib/api/operations";
import { setToken } from "@/lib/api-client";
import { DashboardTab } from "./dashboard-tab";
import { PickupsTab } from "./pickups-tab";
import { ActiveTab } from "./active-tab";
import { QueueTab } from "./queue-tab";
import { HistoryTab } from "./history-tab";
import { ServicesTab } from "./services-tab";
import { IssuesTab } from "./issues-tab";
import { ProfileTab } from "./profile-tab";

type TabId = "dashboard" | "pickups" | "active" | "queue" | "history" | "services" | "issues" | "profile";

function initials(name: string | null | undefined): string {
  if (!name) return "OP";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const value = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return value ? value.toUpperCase() : "OP";
}

// The whole portal is one page with tab-style navigation, mirroring
// washnpress-mobile/src/portals/OperationsPortal.tsx rather than a route per
// section. `bump` is a light shared signal: any tab that changes something the
// dashboard or nav badges care about (a claim, a delivery, a QC result) calls
// `onActivity` and the counts that feed the sidebar refetch.
function OperationsWorkspace() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [bump, setBump] = useState(0);
  const onActivity = useCallback(() => setBump((n) => n + 1), []);

  const dashboard = useAsync(() => operationsApi.dashboard(), [bump]);
  const profile = useAsync(() => operationsApi.profile(), []);
  const queue = useAsync(() => operationsApi.queue(), [bump]);

  const nav: NavItem<TabId>[] = useMemo(
    () => [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "pickups", label: "Pickups", icon: PackagePlus, badge: dashboard.data?.pickups.pending },
      { id: "active", label: "Active", icon: Layers3, badge: dashboard.data?.orders.active },
      { id: "queue", label: "Claimable", icon: Users2, badge: queue.data?.orders.length },
      { id: "history", label: "History", icon: HistoryIcon },
      { id: "services", label: "Services", icon: Sparkles },
      { id: "issues", label: "Issues", icon: MessageCircleWarning, badge: dashboard.data?.issues.pending },
      { id: "profile", label: "Profile", icon: UserCircle2 },
    ],
    [dashboard.data, queue.data],
  );

  return (
    <PortalShell
      title="Operations"
      subtitle={profile.data?.profile.societyName ? `Covering ${profile.data.profile.societyName}` : "Pickups, processing and delivery"}
      nav={nav}
      activeTab={tab}
      onSelectTab={setTab}
      userLabel={profile.data?.profile.fullName ?? "Operator"}
      userInitials={initials(profile.data?.profile.fullName)}
      onLogout={() => { setToken(null); window.location.reload(); }}
    >
      {tab === "dashboard" && (
        <DashboardTab
          dashboard={dashboard.data}
          loading={dashboard.loading}
          error={dashboard.error}
          onRetry={dashboard.reload}
          onGo={setTab}
        />
      )}
      {tab === "pickups" && <PickupsTab onActivity={onActivity} />}
      {tab === "active" && <ActiveTab onActivity={onActivity} />}
      {tab === "queue" && <QueueTab onActivity={onActivity} />}
      {tab === "history" && <HistoryTab />}
      {tab === "services" && <ServicesTab />}
      {tab === "issues" && <IssuesTab onActivity={onActivity} />}
      {tab === "profile" && <ProfileTab />}
    </PortalShell>
  );
}

export function OperationsPortal() {
  return (
    <ToastProvider>
      <PortalGuard
        title="Operations"
        loginDescription="Sign in with your operations phone number to manage pickups, processing and delivery."
        demoPhone="9876500002"
        bootstrap={() => operationsApi.dashboard()}
      >
        <OperationsWorkspace />
      </PortalGuard>
    </ToastProvider>
  );
}
