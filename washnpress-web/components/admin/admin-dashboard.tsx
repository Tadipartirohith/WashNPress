"use client";

import * as React from "react";
import {
  LayoutDashboard, Users, Building2, PackageSearch, ShoppingBag,
  CalendarClock, BarChart3, LifeBuoy, Plug, ScrollText, LogOut,
} from "lucide-react";
import { PortalGuard } from "@/components/auth/portal-guard";
import { PortalShell, type NavItem } from "@/components/portal/portal-shell";
import { ToastProvider } from "@/components/portal/toast";
import { ConfirmProvider } from "@/components/portal/confirm-dialog";
import { adminApi } from "@/lib/api/admin";
import { authApi } from "@/lib/auth";
import { setToken } from "@/lib/api-client";

import { DashboardSection } from "./sections/dashboard-section";
import { PeopleSection } from "./sections/people-section";
import { SocietiesSection } from "./sections/societies-section";
import { OrdersSection } from "./sections/orders-section";
import { CatalogueSection } from "./sections/catalogue-section";
import { SlotsSection } from "./sections/slots-section";
import { ReportsSection } from "./sections/reports-section";
import { IssuesSection } from "./sections/issues-section";
import { IntegrationsSection } from "./sections/integrations-section";
import { AuditSection } from "./sections/audit-section";

type TabId =
  | "dashboard" | "people" | "societies" | "orders" | "catalogue"
  | "slots" | "reports" | "issues" | "integrations" | "audit";

const NAV: NavItem<TabId>[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "people", label: "People", icon: Users },
  { id: "societies", label: "Societies", icon: Building2 },
  { id: "orders", label: "Orders & subscriptions", icon: PackageSearch },
  { id: "catalogue", label: "Catalogue", icon: ShoppingBag },
  { id: "slots", label: "Slots", icon: CalendarClock },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "issues", label: "Issues", icon: LifeBuoy },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

function AdminShell() {
  const [tab, setTab] = React.useState<TabId>("dashboard");

  return (
    <PortalShell<TabId>
      title="Admin"
      subtitle="WashNPress, platform wide"
      nav={NAV}
      activeTab={tab}
      onSelectTab={setTab}
      userLabel="Admin"
      userInitials="AD"
      onLogout={async () => { await authApi.logout(); setToken(null); window.location.reload(); }}
      headerActions={
        <button
          onClick={async () => { await authApi.logout(); setToken(null); window.location.reload(); }}
          className="hidden items-center gap-1.5 rounded-full glass px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"
        >
          <LogOut className="size-3.5" /> Sign out
        </button>
      }
    >
      {tab === "dashboard" && <DashboardSection onNavigate={setTab} />}
      {tab === "people" && <PeopleSection />}
      {tab === "societies" && <SocietiesSection />}
      {tab === "orders" && <OrdersSection />}
      {tab === "catalogue" && <CatalogueSection />}
      {tab === "slots" && <SlotsSection />}
      {tab === "reports" && <ReportsSection />}
      {tab === "issues" && <IssuesSection />}
      {tab === "integrations" && <IntegrationsSection />}
      {tab === "audit" && <AuditSection />}
    </PortalShell>
  );
}

export function AdminDashboard() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <PortalGuard
          title="Admin"
          loginDescription="Sign in with your WashNPress admin number to manage societies, staff, orders and the platform."
          demoPhone="9876500001"
          bootstrap={() => adminApi.dashboard()}
        >
          <AdminShell />
        </PortalGuard>
      </ConfirmProvider>
    </ToastProvider>
  );
}
