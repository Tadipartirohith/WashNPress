"use client";

import * as React from "react";
import {
  LayoutDashboard, Users, Building2, PackageSearch, ShoppingBag,
  CalendarClock, BarChart3, LifeBuoy, Plug, ScrollText, LogOut, Sparkles,
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
import { ServicesSection } from "./sections/services-section";
import { SlotsSection } from "./sections/slots-section";
import { ReportsSection } from "./sections/reports-section";
import { IssuesSection } from "./sections/issues-section";
import { IntegrationsSection } from "./sections/integrations-section";
import { AuditSection } from "./sections/audit-section";

type TabId =
  | "dashboard" | "people" | "societies" | "orders" | "catalogue"
  | "services" | "slots" | "reports" | "issues" | "integrations" | "audit";

// I-105: a dashboard card is only useful if it takes you to the thing it counted,
// already narrowed to it. A card therefore says which section to open *and* how that
// section should be filtered when it gets there; the section reads its slice of this
// as its initial filter state. Choosing a section from the left nav passes nothing,
// so the nav keeps meaning "show me everything here".
export interface AdminFocus {
  people?: { tab: "supervisors" | "operators" | "users"; unassigned?: boolean };
  orders?: { tab?: "orders" | "subscriptions"; state?: string; delayed?: boolean; subscriptionStatus?: string };
  issues?: { status?: string; priority?: string };
  reports?: { tab: "overview" | "subscriptions" | "revenue" | "operations" };
}
export type AdminNavigate = (tab: TabId, focus?: AdminFocus) => void;

const NAV: NavItem<TabId>[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "people", label: "People", icon: Users },
  { id: "societies", label: "Societies", icon: Building2 },
  { id: "orders", label: "Orders & subscriptions", icon: PackageSearch },
  { id: "catalogue", label: "Catalogue", icon: ShoppingBag },
  { id: "services", label: "Additional Services", icon: Sparkles },
  { id: "slots", label: "Slots", icon: CalendarClock },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "issues", label: "Issues", icon: LifeBuoy },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "audit", label: "Audit log", icon: ScrollText },
];

function AdminShell() {
  const [tab, setTab] = React.useState<TabId>("dashboard");
  const [focus, setFocus] = React.useState<AdminFocus>({});
  const go: AdminNavigate = (next, nextFocus = {}) => { setTab(next); setFocus(nextFocus); };

  return (
    <PortalShell<TabId>
      title="Admin"
      subtitle="WashNPress, platform wide"
      nav={NAV}
      activeTab={tab}
      onSelectTab={(next) => go(next)}
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
      {tab === "dashboard" && <DashboardSection onNavigate={go} />}
      {tab === "people" && <PeopleSection focus={focus.people} />}
      {tab === "societies" && <SocietiesSection />}
      {tab === "orders" && <OrdersSection focus={focus.orders} />}
      {tab === "catalogue" && <CatalogueSection />}
      {tab === "services" && <ServicesSection />}
      {tab === "slots" && <SlotsSection />}
      {tab === "reports" && <ReportsSection onViewOrders={() => go("orders")} focus={focus.reports} />}
      {tab === "issues" && <IssuesSection focus={focus.issues} />}
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
