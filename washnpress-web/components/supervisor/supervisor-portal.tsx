"use client";

import { useState } from "react";
import {
  LayoutDashboard, Building2, CalendarClock, Users, PackageSearch, LifeBuoy, ClipboardList,
} from "lucide-react";
import { PortalGuard } from "@/components/auth/portal-guard";
import { PortalShell, type NavItem } from "@/components/portal/portal-shell";
import { ToastProvider } from "@/components/portal/toast";
import { ConfirmProvider } from "@/components/portal/confirm-dialog";
import { setToken } from "@/lib/api-client";
import { supervisorApi } from "@/lib/api/supervisor";
import { authApi } from "@/lib/auth";
import { useAsync } from "@/lib/use-async";
import { OverviewTab } from "./overview-tab";
import { SocietyTab } from "./society-tab";
import { SlotsTab } from "./slots-tab";
import { OperatorsTab } from "./operators-tab";
import { OrdersTab } from "./orders-tab";
import { IssuesTab } from "./issues-tab";
import { PlansTab } from "./plans-tab";
import { SearchResultsPanel } from "./search-panel";
import type { TabId } from "./types";

function initialsOf(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function SupervisorShell() {
  const [tab, setTab] = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const profile = useAsync(() => supervisorApi.profile(), []);

  const nav: NavItem<TabId>[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "society", label: "Society", icon: Building2 },
    { id: "slots", label: "Slots", icon: CalendarClock },
    { id: "operators", label: "Operators", icon: Users },
    { id: "orders", label: "Orders & Pickups", icon: PackageSearch },
    { id: "issues", label: "Issues", icon: LifeBuoy },
    { id: "plans", label: "Plans", icon: ClipboardList },
  ];

  const name = profile.data?.profile.fullName ?? null;
  const societyName = profile.data?.profile.societyName ?? undefined;

  const logout = async () => {
    await authApi.logout();
    setToken(null);
    window.location.reload();
  };

  return (
    <PortalShell
      title="Supervisor"
      subtitle={societyName ? `Running ${societyName}` : "Your area, at a glance"}
      nav={nav}
      activeTab={tab}
      onSelectTab={setTab}
      userLabel={name ?? "Supervisor"}
      userInitials={initialsOf(name, "SV")}
      onLogout={logout}
      search={search}
      onSearchChange={setSearch}
    >
      {search.trim().length > 1 ? (
        <SearchResultsPanel
          query={search.trim()}
          onNavigate={(target) => { setTab(target); setSearch(""); }}
          onClear={() => setSearch("")}
        />
      ) : (
        <>
          {tab === "overview" && <OverviewTab onNavigate={setTab} />}
          {tab === "society" && <SocietyTab />}
          {tab === "slots" && <SlotsTab />}
          {tab === "operators" && <OperatorsTab />}
          {tab === "orders" && <OrdersTab />}
          {tab === "issues" && <IssuesTab />}
          {tab === "plans" && <PlansTab />}
        </>
      )}
    </PortalShell>
  );
}

// The Supervisor portal: one page, tab-switched, exactly like the mobile app's
// SupervisorPortal. The area boundary is never a UI concept here — every screen
// below calls a supervisor/* endpoint that derives scope from the session.
export function SupervisorPortal() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PortalGuard
          title="Supervisor"
          loginDescription="Sign in to run your area — societies, operators, slots, orders and support, all in one place."
          demoPhone="9876500011"
          bootstrap={() => supervisorApi.dashboard()}
        >
          <SupervisorShell />
        </PortalGuard>
      </ConfirmProvider>
    </ToastProvider>
  );
}
