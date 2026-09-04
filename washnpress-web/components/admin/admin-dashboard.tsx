"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, PanelLeftClose, PanelLeft, Search, Bell, ChevronDown, ArrowUpRight, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { RevenueChart } from "./revenue-chart";
import { RiderPanel } from "./rider-panel";
import { OrdersTable } from "./orders-table";
import { kpis, adminNav, trend } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

const tintText: Record<string, string> = {
  primary: "bg-primary/15 text-primary ring-primary/30",
  accent: "bg-accent/15 text-accent ring-accent/30",
  success: "bg-success/15 text-success ring-success/30",
};

export function AdminDashboard() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Mobile overlay. */}
      {mobileOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar. */}
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
          <button
            onClick={() => setMobileOpen(false)}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground lg:hidden"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav aria-label="Dashboard" className="mt-2 flex flex-col gap-1">
          {adminNav.map((item) => (
            <button
              key={item.label}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                item.active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                collapsed && "lg:justify-center lg:px-2",
              )}
            >
              <item.icon className="size-5 shrink-0" />
              <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto hidden lg:block">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            {collapsed ? <PanelLeft className="size-5" /> : <PanelLeftClose className="size-5" />}
            <span className={cn(collapsed && "hidden")}>Collapse</span>
          </button>
        </div>
      </aside>

      {/* Main column. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar. */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid size-9 place-items-center rounded-lg text-foreground lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          <div className="hidden min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-sm text-muted-foreground sm:flex sm:max-w-sm">
            <Search className="size-4 shrink-0" />
            <input
              type="search"
              placeholder="Search orders, riders, customers"
              aria-label="Search"
              className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button className="relative grid size-9 place-items-center rounded-lg glass" aria-label="Notifications">
              <Bell className="size-4" />
              <span className="absolute right-2 top-2 size-2 rounded-full bg-accent ring-2 ring-background" />
            </button>
            <button className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 glass">
              <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">
                SV
              </span>
              <span className="hidden text-sm font-medium sm:inline">Sadia V.</span>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:inline" />
            </button>
          </div>
        </header>

        {/* Content. */}
        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">Overview</h1>
              <p className="text-sm text-muted-foreground">Thursday, live across every community</p>
            </div>
            <Link
              href="/app"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-transform hover:-translate-y-0.5"
            >
              Open customer app <ArrowUpRight className="size-4" />
            </Link>
          </div>

          {/* KPI cards. */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => {
              const up = k.delta >= 0;
              const Trend = up ? trend.up : trend.down;
              return (
                <div key={k.label} className="rounded-2xl p-5 glass">
                  <div className="flex items-center justify-between">
                    <span className={cn("grid size-10 place-items-center rounded-xl ring-1", tintText[k.tint])}>
                      <k.icon className="size-5" />
                    </span>
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", up ? "text-success" : "text-danger")}>
                      <Trend className="size-3.5" />
                      {Math.abs(k.delta)}%
                    </span>
                  </div>
                  <p className="mt-4 font-display text-2xl font-bold tracking-tight">{k.value}</p>
                  <p className="text-sm text-muted-foreground">{k.label}</p>
                </div>
              );
            })}
          </div>

          {/* Chart + riders. */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueChart />
            </div>
            <RiderPanel />
          </div>

          {/* Orders table. */}
          <div className="mt-4">
            <OrdersTable />
          </div>
        </main>
      </div>
    </div>
  );
}
