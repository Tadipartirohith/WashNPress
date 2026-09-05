import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Admin",
  description: "The WashNPress admin console — societies, staff, orders, catalogue and platform health, all wired to live data.",
};

export default function AdminPage() {
  return <AdminDashboard />;
}
