import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";

export const metadata: Metadata = {
  title: "Vendor dashboard",
  description: "The WashNPress operations dashboard — revenue, live orders, rider shifts and satisfaction at a glance.",
};

export default function AdminPage() {
  return <AdminDashboard />;
}
