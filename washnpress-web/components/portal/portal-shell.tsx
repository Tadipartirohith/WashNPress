"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Menu, PanelLeftClose, PanelLeft, Search, LogOut, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

export interface NavItem<TabId extends string> {
  id: TabId;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

// The sidebar+topbar shell shared by the admin, supervisor and operations portals.
// Each portal is a single page with tab-style navigation (mirroring the mobile
// app's architecture — see washnpress-mobile/App.tsx — rather than one Next.js
// route per section), so `nav` switches an internal view rather than routing.
export function PortalShell<TabId extends string>({
  title,
  subtitle,
  nav,
  activeTab,
  onSelectTab,
  userLabel,
  userInitials,
  onLogout,
  search,
  onSearchChange,
  headerActions,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: NavItem<TabId>[];
  activeTab: TabId;
  onSelectTab: (id: TabId) => void;
  userLabel: string;
  userInitials: string;
  onLogout: () => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      {mobileOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col gap-1 border-r border-white/10 bg-background/80 p-3 backdrop-blur-xl transition-all duration-300 lg:static lg:z-auto lg:translate-x-0",
          collapsed ? "lg:w-[76px]" : "lg:w-64",
          mobileOpen ? "w-64 translate-x-0" : "w-64 -translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-1 py-2">
          {!collapsed && <Logo />}
          {collapsed && <span className="mx-auto"><Logo textClassName="hidden" /></span>}
          <button onClick={() => setMobileOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted-foreground lg:hidden" aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>

        <nav aria-label={title} className="mt-2 flex flex-col gap-1 overflow-y-auto">
          {nav.map((item) => {
            const active = item.id === activeTab;
            return (
              <button
                key={item.id}
                onClick={() => { onSelectTab(item.id); setMobileOpen(false); }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  collapsed && "lg:justify-center lg:px-2",
                )}
              >
                <item.icon className="size-5 shrink-0" />
                <span className={cn("flex-1 text-left", collapsed && "lg:hidden")}>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={cn("rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent", collapsed && "lg:hidden")}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto hidden lg:block">
          <button onClick={() => setCollapsed((v) => !v)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
            {collapsed ? <PanelLeft className="size-5" /> : <PanelLeftClose className="size-5" />}
            <span className={cn(collapsed && "hidden")}>Collapse</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="grid size-9 place-items-center rounded-lg text-foreground lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>

          {onSearchChange && (
            <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:flex sm:max-w-sm">
              <Search className="size-4 shrink-0" />
              <input
                type="search"
                value={search ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search"
                aria-label="Search"
                className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {headerActions}
            <button onClick={onLogout} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 glass hover:ring-1 hover:ring-primary/30" aria-label="Sign out">
              <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">
                {userInitials}
              </span>
              <span className="hidden text-sm font-medium sm:inline">{userLabel}</span>
              <LogOut className="hidden size-4 text-muted-foreground sm:inline" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="mb-6">
            <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
