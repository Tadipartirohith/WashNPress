import type { Metadata } from "next";
import { SupervisorPortal } from "@/components/supervisor/supervisor-portal";

export const metadata: Metadata = {
  title: "Supervisor portal",
  description: "Run your area — societies, operators, slots, orders and support — from the web.",
};

export default function SupervisorPage() {
  return <SupervisorPortal />;
}
